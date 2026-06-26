import { FrameRectNorm } from "./types";

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Tuning knobs, exported so they're easy to adjust after a real stress test
// without hunting through the detection logic below.
export const MIN_INSET_FRAC = 0.03;
export const MAX_INSET_FRAC = 0.35;
export const EDGE_JUMP_THRESHOLD = 18; // luminance units on a 0-255 scale
export const MIN_INNER_FRACTION = 0.3; // inner content must keep >=30% of each dimension

function buildMeans(data: Uint8ClampedArray, w: number, h: number): { rowMeans: Float64Array; colMeans: Float64Array } {
  const rowSums = new Float64Array(h);
  const colSums = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      rowSums[y] += lum;
      colSums[x] += lum;
    }
  }
  const rowMeans = new Float64Array(h);
  for (let y = 0; y < h; y++) rowMeans[y] = rowSums[y] / w;
  const colMeans = new Float64Array(w);
  for (let x = 0; x < w; x++) colMeans[x] = colSums[x] / h;
  return { rowMeans, colMeans };
}

function smooth(arr: Float64Array): Float64Array {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const a = arr[Math.max(0, i - 1)];
    const b = arr[i];
    const c = arr[Math.min(arr.length - 1, i + 1)];
    out[i] = (a + b + c) / 3;
  }
  return out;
}

// Walks inward from index 0 looking for the first large smoothed jump
// within the allowed inset range — the boundary between a border and the
// photo content inside it.
function findEdgeFromStart(smoothed: Float64Array, length: number): number | null {
  const minInset = Math.max(1, Math.round(length * MIN_INSET_FRAC));
  const maxInset = Math.round(length * MAX_INSET_FRAC);
  for (let i = minInset; i < maxInset && i < length; i++) {
    if (Math.abs(smoothed[i] - smoothed[i - 1]) > EDGE_JUMP_THRESHOLD) return i;
  }
  return null;
}

function findEdgeFromEnd(smoothed: Float64Array, length: number): number | null {
  const minInset = Math.max(1, Math.round(length * MIN_INSET_FRAC));
  const maxInset = Math.round(length * MAX_INSET_FRAC);
  for (let i = length - 1 - minInset; i > length - 1 - maxInset && i >= 0; i--) {
    if (Math.abs(smoothed[i] - smoothed[i + 1]) > EDGE_JUMP_THRESHOLD) return length - 1 - i;
  }
  return null;
}

// Detects a large rectangular border (e.g. a scanned/photographed print with
// a mat or frame around it) via row/column luminance-projection edge
// detection. One getImageData pass, then four short 1D walks — cheaper and
// less outlier-sensitive than scanning along a single centerline. Returns
// null when no border is found on all four sides, or when the resulting
// inner rect isn't meaningfully smaller than the source.
export function detectFrameRect(ctx: Canvas2DContext, w: number, h: number): FrameRectNorm | null {
  if (w < 20 || h < 20) return null;
  const { data } = ctx.getImageData(0, 0, w, h);
  const { rowMeans, colMeans } = buildMeans(data, w, h);
  const rowSmooth = smooth(rowMeans);
  const colSmooth = smooth(colMeans);

  const top = findEdgeFromStart(rowSmooth, h);
  const bottom = findEdgeFromEnd(rowSmooth, h);
  const left = findEdgeFromStart(colSmooth, w);
  const right = findEdgeFromEnd(colSmooth, w);

  if (top == null || bottom == null || left == null || right == null) return null;

  const innerW = w - left - right;
  const innerH = h - top - bottom;
  if (innerW < w * MIN_INNER_FRACTION || innerH < h * MIN_INNER_FRACTION) return null;
  if (innerW >= w * 0.98 && innerH >= h * 0.98) return null;

  return { x: left / w, y: top / h, w: innerW / w, h: innerH / h };
}
