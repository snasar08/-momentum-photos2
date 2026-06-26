// 64-bit dHash, encoded as two Uint32 halves (not bigint) so that the O(n^2)
// clustering pass over up to 5,000 hashes stays on fast native-number paths.
export interface DHash {
  hashHi: number;
  hashLo: number;
}

export const HASH_W = 9;
export const HASH_H = 8;

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ctx must already be sized to HASH_W x HASH_H. Reusing one ctx across many
// calls (typical in a worker loop) avoids re-allocating a canvas per image.
export function computeDHash(ctx: Canvas2DContext, source: ImageBitmap): DHash {
  ctx.drawImage(source, 0, 0, HASH_W, HASH_H);
  const { data } = ctx.getImageData(0, 0, HASH_W, HASH_H);

  const gray = new Float32Array(HASH_W * HASH_H);
  for (let i = 0; i < HASH_W * HASH_H; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  let hi = 0;
  let lo = 0;
  let bitIndex = 0;
  for (let row = 0; row < HASH_H; row++) {
    const rowOffset = row * HASH_W;
    for (let col = 0; col < HASH_W - 1; col++) {
      const bit = gray[rowOffset + col] > gray[rowOffset + col + 1] ? 1 : 0;
      if (bitIndex < 32) {
        hi |= bit << bitIndex;
      } else {
        lo |= bit << (bitIndex - 32);
      }
      bitIndex++;
    }
  }

  return { hashHi: hi >>> 0, hashLo: lo >>> 0 };
}
