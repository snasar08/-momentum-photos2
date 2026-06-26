// Loaded dynamically (not statically imported) because heic2any's module
// body touches `window` at evaluation time, which crashes Next's
// server-side prerender of this "use client" page's initial HTML — even
// though the function that uses it only ever runs in the browser.
let heic2anyModule: Promise<typeof import("heic2any")> | null = null;
function loadHeic2Any(): Promise<typeof import("heic2any")> {
  if (!heic2anyModule) heic2anyModule = import("heic2any");
  return heic2anyModule;
}

// heic2any requires window/DOM, so it cannot run inside our Worker pool —
// it manages its own internal worker for the actual WASM decode, so this
// main-thread call is mostly lightweight orchestration, not raw CPU burn.
// Bounded to 2 concurrent calls to avoid spawning too many simultaneous
// WASM module instances.
const MAX_CONCURRENT_HEIC = 2;

let activeCount = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeCount < MAX_CONCURRENT_HEIC) {
      activeCount++;
      resolve();
    } else {
      waiters.push(() => {
        activeCount++;
        resolve();
      });
    }
  });
}

function releaseSlot(): void {
  activeCount--;
  const next = waiters.shift();
  if (next) next();
}

// Each HEIC file is converted once and cached so the export phase reuses
// the same JPEG instead of re-running the WASM decode a second time.
const heicJpegCache = new Map<string, Blob>();

export async function convertHeicToJpeg(id: string, file: File | Blob): Promise<Blob> {
  const cached = heicJpegCache.get(id);
  if (cached) return cached;

  await acquireSlot();
  try {
    const { default: heic2any } = await loadHeic2Any();
    const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(result) ? result[0] : result;
    heicJpegCache.set(id, blob);
    return blob;
  } finally {
    releaseSlot();
  }
}

export function clearHeicCache(): void {
  heicJpegCache.clear();
}
