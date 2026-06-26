type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Index 0 is always the untouched original. Shared between the review UI
// (lib/glare.ts consumers in EnhanceStep) and the export worker, so the
// filter actually baked into the exported photo always matches the preview.
export const GLARE_FILTER_VARIANTS: string[] = [
  "none",
  "brightness(0.82)",
  "contrast(1.15) brightness(0.85)",
  "saturate(1.3) brightness(0.88) contrast(1.05)",
];

const BRIGHT_CHANNEL_THRESHOLD = 235;
const SAMPLE_STRIDE_PX = 4;

// Fraction of sampled pixels with R, G, and B all blown out — a statistical
// estimate of glare coverage, not a precise count, so striding by 4 pixels
// is enough.
export function computeGlareScore(ctx: Canvas2DContext, w: number, h: number): number {
  const { data } = ctx.getImageData(0, 0, w, h);
  const strideBytes = SAMPLE_STRIDE_PX * 4;
  let brightCount = 0;
  let sampled = 0;
  for (let i = 0; i < data.length; i += strideBytes) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sampled++;
    if (r > BRIGHT_CHANNEL_THRESHOLD && g > BRIGHT_CHANNEL_THRESHOLD && b > BRIGHT_CHANNEL_THRESHOLD) {
      brightCount++;
    }
  }
  return sampled > 0 ? brightCount / sampled : 0;
}

// Photos scoring below this are left alone — not worth surfacing in review.
export const GLARE_REVIEW_THRESHOLD = 0.04;

// Renders `source` through `filterCss` into `ctx` (which the caller owns and
// sizes to w/h) and scores the result. Used to evaluate all 4 variants
// against the same source image.
export function scoreFilterVariant(
  ctx: Canvas2DContext,
  source: CanvasImageSource,
  w: number,
  h: number,
  filterCss: string
): number {
  ctx.save();
  ctx.filter = filterCss;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  ctx.restore();
  return computeGlareScore(ctx, w, h);
}
