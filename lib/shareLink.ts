import { AlbumStatePayload, ScanResult } from "./types";
import { photoKey, getFaceTags, getGlarePrefs, getFramePrefs, getRotatePrefs } from "./persistence";

export const ALBUM_PARAM = "album";

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function gzipCompress(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(text) as BufferSource);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatBytes(chunks);
}

async function gzipDecompress(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes as BufferSource);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return new TextDecoder().decode(concatBytes(chunks));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Builds the payload to share, filtered to only the photos in the current
// session (by content-derived photoKey) — never the whole persisted history
// of every photo ever processed in this browser.
export function buildAlbumPayloadForSession(scanResults: Map<string, ScanResult>): AlbumStatePayload {
  const keys = new Set<string>();
  for (const scan of scanResults.values()) keys.add(photoKey(scan));

  const faceTags = Array.from(getFaceTags().entries())
    .filter(([key]) => keys.has(key))
    .map(([key, label]) => ({ photoKey: key, label }));
  const glarePrefs = Array.from(getGlarePrefs().values()).filter((p) => keys.has(p.photoKey));
  const framePrefs = Array.from(getFramePrefs().values()).filter((p) => keys.has(p.photoKey));
  const rotatePrefs = Array.from(getRotatePrefs().values()).filter((p) => keys.has(p.photoKey));

  return { faceTags, glarePrefs, framePrefs, rotatePrefs };
}

export async function encodeAlbumState(payload: AlbumStatePayload): Promise<string> {
  const compressed = await gzipCompress(JSON.stringify(payload));
  return bytesToBase64Url(compressed);
}

export async function decodeAlbumState(encoded: string): Promise<AlbumStatePayload | null> {
  try {
    const json = await gzipDecompress(base64UrlToBytes(encoded));
    return JSON.parse(json) as AlbumStatePayload;
  } catch {
    return null;
  }
}
