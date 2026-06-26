import { ScanRequest, ScanResponse } from "../lib/types";
import { computeDHash, HASH_W, HASH_H } from "../lib/hash";
import { getWorkerSelf } from "../lib/workerGlobal";

const workerSelf = getWorkerSelf();

// Reused across every file this worker instance handles — fixed 9x8 size,
// no need to reallocate per image.
const hashCanvas = new OffscreenCanvas(HASH_W, HASH_H);
const hashCtx = hashCanvas.getContext("2d", {
  willReadFrequently: true,
}) as OffscreenCanvasRenderingContext2D;

workerSelf.onmessage = async (ev: MessageEvent<ScanRequest>) => {
  const { id, file, thumbnailSize } = ev.data;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { hashHi, hashLo } = computeDHash(hashCtx, bitmap);

    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, thumbnailSize / longEdge);
    const thumbW = Math.max(1, Math.round(bitmap.width * scale));
    const thumbH = Math.max(1, Math.round(bitmap.height * scale));

    const thumbCanvas = new OffscreenCanvas(thumbW, thumbH);
    const thumbCtx = thumbCanvas.getContext("2d")!;
    thumbCtx.drawImage(bitmap, 0, 0, thumbW, thumbH);
    const thumbnailBlob = await thumbCanvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });

    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();

    const response: ScanResponse = { id, ok: true, hashHi, hashLo, width, height, thumbnailBlob };
    workerSelf.postMessage(response);
  } catch (err) {
    bitmap?.close();
    const response: ScanResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    workerSelf.postMessage(response);
  }
};
