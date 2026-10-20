const LONGEST_SIDE = 1280;
const QUALITY = 0.82;

export function fittedSize(width: number, height: number, longest = LONGEST_SIDE): { width: number; height: number } {
  const scale = Math.min(1, longest / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function shrinkPhoto(file: Blob): Promise<Blob> {
  let picture: ImageBitmap;
  try {
    picture = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo could not be opened. Take it again, or choose a JPEG or PNG photo.');
  }
  const { width, height } = fittedSize(picture.width, picture.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    picture.close();
    throw new Error('This browser cannot prepare photos.');
  }
  context.drawImage(picture, 0, 0, width, height);
  picture.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This browser cannot prepare photos.'))),
      'image/jpeg',
      QUALITY,
    );
  });
}
