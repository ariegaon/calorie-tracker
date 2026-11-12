// Browser-only: shrinks a photo before upload, so it is quick to send on a phone connection
// and cheaper to analyse. Returns a JPEG data URL.

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.8;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image could not be read"));
    };
    image.src = url;
  });
}

export async function fileToResizedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  const image = await loadImage(file);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest === 0) throw new Error("empty image");
  const scale = Math.min(1, MAX_DIMENSION / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas is not available");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
