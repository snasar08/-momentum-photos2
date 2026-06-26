import { SupportedMime } from "./types";
import { convertHeicToJpeg } from "./heic";

// Main-thread-only decode helper (used for things like the configure-step
// crop preview). Workers never call this — they receive already-converted
// JPEG blobs for HEIC sources from the main-thread orchestration layer.
export async function decodeToBitmap(
  id: string,
  file: File | Blob,
  mime: SupportedMime
): Promise<ImageBitmap> {
  let source: File | Blob = file;
  if (mime === "image/heic" || mime === "image/heif") {
    source = await convertHeicToJpeg(id, file);
  }
  return createImageBitmap(source, { imageOrientation: "from-image" });
}

// Workers never decode HEIC themselves (heic2any needs window/DOM). The
// orchestration layer calls this on the main thread before handing a file
// off to the scan/export worker pool, so workers only ever see formats
// createImageBitmap can decode directly.
export async function prepareSourceForWorker(
  id: string,
  file: File,
  mime: SupportedMime
): Promise<{ blob: Blob; mime: SupportedMime }> {
  if (mime === "image/heic" || mime === "image/heif") {
    const jpeg = await convertHeicToJpeg(id, file);
    return { blob: jpeg, mime: "image/jpeg" };
  }
  return { blob: file, mime };
}
