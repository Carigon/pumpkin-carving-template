import type { PhotoFile } from "../designRecord";

/** The long edge of the copy kept when a photo as chosen won't fit, in px (ADR 0002). */
const LONG_EDGE_PX = 2048;
/** JPEG quality of that copy: small, with no artefacts to trace over. */
const JPEG_QUALITY = 0.9;

/** `photo` as a JPEG shrunk to 2048 px on the long edge (re-encoded as it is when already smaller). */
export async function shrinkPhoto(photo: PhotoFile): Promise<PhotoFile> {
  const image = await createImageBitmap(new Blob([photo.bytes], { type: photo.type }));
  const scale = Math.min(1, LONG_EDGE_PX / Math.max(image.width, image.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const g = canvas.getContext("2d")!;
  // JPEG has no transparency: a transparent photo's background stays white, as it showed.
  g.fillStyle = "white";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return { name: photo.name, type: "image/jpeg", bytes: await blob.arrayBuffer() };
}
