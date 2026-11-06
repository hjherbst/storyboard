const MAX_BYTES = 120 * 1024;
const MAX_EDGE = 1600;

function loadBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

async function encodeWebp(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/webp", quality);
  });
}

/**
 * Resize and encode an image as WebP, targeting at most 120 KB.
 * Works for camera captures and media-library picks.
 */
export async function compressImageToWebp(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("unsupported_type");
  }

  const bitmap = await loadBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;

  if (width > MAX_EDGE || height > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("compress_failed");
  }

  let quality = 0.82;
  let blob: Blob | null = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    blob = await encodeWebp(canvas, quality);

    if (!blob) {
      bitmap.close();
      throw new Error("webp_unsupported");
    }
    if (blob.size <= MAX_BYTES) break;

    if (quality > 0.45) {
      quality -= 0.08;
    } else {
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
      quality = Math.max(0.4, quality);
    }
  }

  bitmap.close();

  if (!blob || blob.size > MAX_BYTES) {
    throw new Error("too_large");
  }

  return new File([blob], "scene.webp", {
    type: "image/webp",
    lastModified: Date.now(),
  });
}
