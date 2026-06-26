import { ExportRequest, ExportResponse } from "../lib/types";
import {
  computeCenterCropRect,
  computeOutputSize,
  scanHasAlpha,
  chooseOutputFormat,
  outputExtension,
} from "../lib/cropMath";
import { getWorkerSelf } from "../lib/workerGlobal";
import { ORIENTATION_PREVIEW_DEG } from "../lib/exifOrientation";

const workerSelf = getWorkerSelf();

workerSelf.onmessage = async (ev: MessageEvent<ExportRequest>) => {
  const {
    id,
    file,
    mime,
    originalName,
    aspectW,
    aspectH,
    maxDimension,
    quality,
    filterCss,
    frameRectNorm,
    applyAutoRotate,
    exifOrientation,
  } = ev.data;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    // createImageBitmap's `imageOrientation: "none"` is a documented no-op in
    // Chromium (it decodes identically to "from-image"), so an opt-out of
    // auto-rotation can't be done at decode time. Instead, always decode
    // upright, then re-apply the inverse of the EXIF correction on a canvas —
    // the same rotation values (ORIENTATION_PREVIEW_DEG) already used for the
    // Enhance step's CSS preview, since canvas and CSS rotation share the
    // same clockwise-positive convention.
    let source: ImageBitmap | OffscreenCanvas = bitmap;
    if (applyAutoRotate === false && exifOrientation != null) {
      const deg = ORIENTATION_PREVIEW_DEG[exifOrientation];
      if (deg != null) {
        const swapped = deg !== 180;
        const rw = swapped ? bitmap.height : bitmap.width;
        const rh = swapped ? bitmap.width : bitmap.height;
        const rotCanvas = new OffscreenCanvas(rw, rh);
        const rotCtx = rotCanvas.getContext("2d")!;
        rotCtx.translate(rw / 2, rh / 2);
        rotCtx.rotate((deg * Math.PI) / 180);
        rotCtx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
        source = rotCanvas;
      }
    }

    // frameRectNorm (when present) carves out a sub-rect of the original
    // bitmap first — e.g. the inner photo inside a detected border. The
    // aspect crop must then be computed *within* that sub-rect's own
    // coordinate space (computeCenterCropRect's returned x/y are relative to
    // whatever srcW/srcH it's given), then translated back into the
    // original bitmap's coordinates by adding the sub-rect's own offset.
    const frameRect = frameRectNorm
      ? {
          x: Math.round(frameRectNorm.x * source.width),
          y: Math.round(frameRectNorm.y * source.height),
          w: Math.round(frameRectNorm.w * source.width),
          h: Math.round(frameRectNorm.h * source.height),
        }
      : { x: 0, y: 0, w: source.width, h: source.height };

    const innerCrop = computeCenterCropRect(frameRect.w, frameRect.h, aspectW, aspectH);
    const cropRect = {
      x: frameRect.x + innerCrop.x,
      y: frameRect.y + innerCrop.y,
      w: innerCrop.w,
      h: innerCrop.h,
    };
    const outSize = computeOutputSize(cropRect.w, cropRect.h, maxDimension);

    const canvas = new OffscreenCanvas(outSize.w, outSize.h);
    const ctx = canvas.getContext("2d")!;
    if (filterCss && filterCss !== "none") ctx.filter = filterCss;
    ctx.drawImage(
      source,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      outSize.w,
      outSize.h
    );

    // JPEG/HEIC(->JPEG) sources are guaranteed opaque; only PNG/WebP pay
    // for the alpha scan.
    const hasAlpha = mime === "image/png" || mime === "image/webp" ? scanHasAlpha(ctx, outSize.w, outSize.h) : false;
    const format = chooseOutputFormat(mime, hasAlpha);
    const blob = await canvas.convertToBlob(
      format === "image/jpeg" ? { type: format, quality } : { type: format }
    );

    bitmap.close();

    const base = originalName.replace(/\.[a-z0-9]+$/i, "");
    const filename = `${base}.${outputExtension(format)}`;

    const response: ExportResponse = { id, ok: true, filename, blob };
    workerSelf.postMessage(response);
  } catch (err) {
    bitmap?.close();
    const response: ExportResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    workerSelf.postMessage(response);
  }
};
