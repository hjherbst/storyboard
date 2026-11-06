const MAX_BYTES = 120 * 1024;
/** Target display width for YouTube-oriented scene stills. */
const TARGET_WIDTH = 420;
const MIN_WIDTH = 160;

function loadBitmap(file: File): Promise<ImageBitmap> {
  // Honor EXIF orientation so phone photos are not sideways after encode.
  return createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
    createImageBitmap(file),
  );
}

function scaleToWidth(
  width: number,
  height: number,
  targetWidth: number,
): { width: number; height: number } {
  if (width <= targetWidth) {
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }
  const scale = targetWidth / width;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
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
 * Resize to ~420px width and encode as WebP under 120 KB.
 * At this size WebP fits the budget easily; quality and width are lowered only as fallback.
 */
export async function compressImageToWebp(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("unsupported_type");
  }

  const bitmap = await loadBitmap(file);
  let { width, height } = scaleToWidth(
    bitmap.width,
    bitmap.height,
    TARGET_WIDTH,
  );

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("compress_failed");
  }

  const qualities = [0.8, 0.7, 0.6, 0.5, 0.4, 0.32, 0.25];
  let blob: Blob | null = null;

  while (true) {
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (const quality of qualities) {
      blob = await encodeWebp(canvas, quality);
      if (!blob) {
        bitmap.close();
        throw new Error("webp_unsupported");
      }
      if (blob.size <= MAX_BYTES) {
        bitmap.close();
        return new File([blob], "scene.webp", {
          type: "image/webp",
          lastModified: Date.now(),
        });
      }
    }

    if (width <= MIN_WIDTH) {
      break;
    }

    const nextWidth = Math.max(MIN_WIDTH, Math.round(width * 0.75));
    const scale = nextWidth / width;
    width = nextWidth;
    height = Math.max(1, Math.round(height * scale));
  }

  bitmap.close();
  throw new Error("too_large");
}
