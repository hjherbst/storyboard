/**
 * Client-side image resize + WebP compression.
 * Longest edge ≤ 420px, target size ≤ 70KB.
 */

const MAX_EDGE = 420;
const TARGET_BYTES = 70 * 1024;
const QUALITY_START = 0.82;
const QUALITY_FLOOR = 0.45;
const QUALITY_STEP = 0.07;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

function scaleDimensions(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function supportsWebP() {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

/**
 * Compress a File/Blob from the device library.
 * @param {File} file
 * @returns {Promise<{blob: Blob, filename: string, bytes: number}>}
 */
export async function compressImage(file) {
  const img = await loadImage(file);
  const { width, height } = scaleDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_EDGE);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const useWebP = supportsWebP();
  const mime = useWebP ? 'image/webp' : 'image/jpeg';
  const ext = useWebP ? 'webp' : 'jpg';

  let quality = QUALITY_START;
  let blob = await canvasToBlob(canvas, mime, quality);

  while (blob && blob.size > TARGET_BYTES && quality > QUALITY_FLOOR) {
    quality = Math.max(QUALITY_FLOOR, quality - QUALITY_STEP);
    blob = await canvasToBlob(canvas, mime, quality);
  }

  // Last resort: shrink further if still over target.
  if (blob && blob.size > TARGET_BYTES) {
    let edge = Math.floor(MAX_EDGE * 0.85);
    while (blob.size > TARGET_BYTES && edge >= 180) {
      const dims = scaleDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height, edge);
      canvas.width = dims.width;
      canvas.height = dims.height;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.drawImage(img, 0, 0, dims.width, dims.height);
      blob = await canvasToBlob(canvas, mime, QUALITY_FLOOR);
      edge = Math.floor(edge * 0.85);
    }
  }

  if (!blob) {
    throw new Error('Compression failed');
  }

  const base = (file.name || 'scene').replace(/\.[^.]+$/, '');
  return {
    blob,
    filename: `${base}.${ext}`,
    bytes: blob.size,
  };
}
