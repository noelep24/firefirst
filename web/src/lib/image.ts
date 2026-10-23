const MAX_SIDE = 512;
const MAX_BYTES = 480 * 1024; // The server takes up to 512 KB.

/**
 * Turn an uploaded image (any format the browser can open, SVG included) into a small PNG data URL, at most 512
 * pixels on its longest side. Falls back to WebP when a detailed photo makes the PNG too big.
 */
export async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth || MAX_SIDE, image.naturalHeight || MAX_SIDE));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((image.naturalWidth || MAX_SIDE) * scale);
    canvas.height = Math.round((image.naturalHeight || MAX_SIDE) * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    return bytes(png) <= MAX_BYTES ? png : canvas.toDataURL('image/webp', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function bytes(dataUrl: string) {
  return Math.ceil(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
}
