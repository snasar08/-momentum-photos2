// Hand-rolled JPEG EXIF orientation reader — no dependency, only the
// Orientation tag (TIFF tag 0x0112) is needed. Reads just the first 128KB of
// the file (EXIF lives in a single APP1 segment near the start), never a
// full decode.
const EXIF_SIGNATURE_LENGTH = 6; // "Exif\0\0"
const READ_BYTES = 131072;

// Of the 8 EXIF orientation values, only these three are pure rotations that
// real camera/phone hardware actually produces and that can be cleanly
// inverted for a UI preview. 2/4/5/7 (mirror/transpose) are essentially never
// seen from real cameras, so they're treated as "no rotation issue" rather
// than building a preview/override path that would never exercise in practice.
export const ROTATABLE_ORIENTATIONS = new Set([3, 6, 8]);

// CSS rotation that, applied to the already browser-corrected thumbnail,
// simulates what the raw/stored pixels looked like — the inverse of the
// correction createImageBitmap's `imageOrientation: "from-image"` already
// applies for these three cases.
export const ORIENTATION_PREVIEW_DEG: Record<number, number> = { 3: 180, 6: -90, 8: 90 };

// Walks JPEG markers from the SOI looking for the APP1 segment whose payload
// starts with the "Exif\0\0" signature, returning the byte offset of the TIFF
// header that follows it (or null if this isn't a JPEG / no Exif APP1 found
// before the scan data starts).
function findTiffHeaderOffset(view: DataView): number | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    // Markers with no length field: SOI, TEM, and the bare RST0-7 markers.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null; // SOS — scan data starts, no more APPn segments
    const segmentLength = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      const payloadStart = offset + 4;
      if (
        payloadStart + EXIF_SIGNATURE_LENGTH <= view.byteLength &&
        view.getUint8(payloadStart) === 0x45 && // E
        view.getUint8(payloadStart + 1) === 0x78 && // x
        view.getUint8(payloadStart + 2) === 0x69 && // i
        view.getUint8(payloadStart + 3) === 0x66 && // f
        view.getUint8(payloadStart + 4) === 0x00 &&
        view.getUint8(payloadStart + 5) === 0x00
      ) {
        return payloadStart + EXIF_SIGNATURE_LENGTH;
      }
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readOrientationFromTiff(view: DataView, tiffStart: number): number {
  if (tiffStart + 8 > view.byteLength) return 1;
  const byteOrderMark = view.getUint16(tiffStart);
  const littleEndian = byteOrderMark === 0x4949; // "II"
  if (!littleEndian && byteOrderMark !== 0x4d4d) return 1; // neither "II" nor "MM"
  const magic = view.getUint16(tiffStart + 2, littleEndian);
  if (magic !== 0x002a) return 1;
  const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, littleEndian);
  if (ifd0Offset + 2 > view.byteLength) return 1;
  const entryCount = view.getUint16(ifd0Offset, littleEndian);
  let entryOffset = ifd0Offset + 2;
  for (let i = 0; i < entryCount; i++, entryOffset += 12) {
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === 0x0112) {
      return view.getUint16(entryOffset + 8, littleEndian);
    }
  }
  return 1;
}

// Returns the EXIF Orientation tag value (1-8) for a JPEG blob, or 1
// (normal/no rotation) on any parse failure, non-JPEG signature, or missing
// tag. Best-effort UI hint — never throws.
export async function readExifOrientation(blob: Blob): Promise<number> {
  try {
    const buf = await blob.slice(0, READ_BYTES).arrayBuffer();
    const view = new DataView(buf);
    const tiffStart = findTiffHeaderOffset(view);
    if (tiffStart == null) return 1;
    return readOrientationFromTiff(view, tiffStart);
  } catch {
    return 1;
  }
}
