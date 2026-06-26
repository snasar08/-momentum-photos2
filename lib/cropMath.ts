export interface AspectPreset {
  label: string;
  w: number;
  h: number;
}

// All common presets, no default — the UI must force an explicit choice
// before the user can continue past the configure step.
export const ASPECT_PRESETS: AspectPreset[] = [
  { label: "1:1", w: 1, h: 1 },
  { label: "4:5", w: 4, h: 5 },
  { label: "9:16", w: 9, h: 16 },
  { label: "16:9", w: 16, h: 9 },
  { label: "3:2", w: 3, h: 2 },
  { label: "2:3", w: 2, h: 3 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:4", w: 3, h: 4 },
];

export const MAX_DIMENSION_OPTIONS = [1024, 1536, 2048, 3072, 4096, 0] as const;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropAnchor {
  x: number;
  y: number;
}

export function computeCenterCropRect(
  srcW: number,
  srcH: number,
  aspectW: number,
  aspectH: number,
  anchor: CropAnchor = { x: 0.5, y: 0.5 }
): CropRect {
  const targetRatio = aspectW / aspectH;
  const srcRatio = srcW / srcH;

  let cropW: number;
  let cropH: number;
  if (srcRatio > targetRatio) {
    cropH = srcH;
    cropW = Math.round(cropH * targetRatio);
  } else {
    cropW = srcW;
    cropH = Math.round(cropW / targetRatio);
  }

  cropW = Math.max(1, Math.min(cropW, srcW));
  cropH = Math.max(1, Math.min(cropH, srcH));

  const maxX = srcW - cropW;
  const maxY = srcH - cropH;
  const x = Math.round(maxX * anchor.x);
  const y = Math.round(maxY * anchor.y);

  return { x, y, w: cropW, h: cropH };
}

// Only ever scales down — never upscales past the crop's native resolution.
// maxDimension <= 0 means "original, no resize".
export function computeOutputSize(
  cropW: number,
  cropH: number,
  maxDimension: number
): { w: number; h: number } {
  if (maxDimension <= 0) return { w: cropW, h: cropH };
  const longEdge = Math.max(cropW, cropH);
  if (longEdge <= maxDimension) return { w: cropW, h: cropH };
  const scale = maxDimension / longEdge;
  return {
    w: Math.max(1, Math.round(cropW * scale)),
    h: Math.max(1, Math.round(cropH * scale)),
  };
}

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// JPEG/HEIC sources are guaranteed opaque — callers should skip this scan
// for those mimes entirely and only call it for PNG/WebP sources.
export function scanHasAlpha(ctx: Canvas2DContext, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export function chooseOutputFormat(
  mime: string,
  hasAlpha: boolean
): "image/jpeg" | "image/png" {
  if ((mime === "image/png" || mime === "image/webp") && hasAlpha) {
    return "image/png";
  }
  return "image/jpeg";
}

export function outputExtension(format: "image/jpeg" | "image/png"): string {
  return format === "image/png" ? "png" : "jpg";
}
