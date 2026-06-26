import { ClusterHashEntry, ClusterRequest, ClusterResponse } from "./types";

// One-shot worker (not part of the bounded scan/export pool) — fed the
// small {id, hashHi, hashLo} array so the O(n^2) clustering pass never
// blocks the main thread, even for a second or two at 5,000 entries.
export function runClustering(entries: ClusterHashEntry[], thresholdBits: number): Promise<ClusterResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/cluster.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<ClusterResponse>) => {
      resolve(ev.data);
      worker.terminate();
    };
    worker.onerror = (ev: ErrorEvent) => {
      reject(new Error(ev.message));
      worker.terminate();
    };
    const req: ClusterRequest = { entries, thresholdBits };
    worker.postMessage(req);
  });
}
