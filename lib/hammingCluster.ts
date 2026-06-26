const POPCOUNT_BYTE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = 0;
    let v = i;
    while (v) {
      c += v & 1;
      v >>>= 1;
    }
    table[i] = c;
  }
  return table;
})();

export function hammingDistance(aHi: number, aLo: number, bHi: number, bLo: number): number {
  const xorHi = (aHi ^ bHi) >>> 0;
  const xorLo = (aLo ^ bLo) >>> 0;
  return (
    POPCOUNT_BYTE[xorHi & 0xff] +
    POPCOUNT_BYTE[(xorHi >>> 8) & 0xff] +
    POPCOUNT_BYTE[(xorHi >>> 16) & 0xff] +
    POPCOUNT_BYTE[(xorHi >>> 24) & 0xff] +
    POPCOUNT_BYTE[xorLo & 0xff] +
    POPCOUNT_BYTE[(xorLo >>> 8) & 0xff] +
    POPCOUNT_BYTE[(xorLo >>> 16) & 0xff] +
    POPCOUNT_BYTE[(xorLo >>> 24) & 0xff]
  );
}

export interface ClusterableHash {
  id: string;
  hashHi: number;
  hashLo: number;
}

export interface RawCluster {
  clusterId: number;
  memberIds: string[];
}

// O(n^2) pairwise union-find. At n=5000 this is ~12.5M comparisons, each a
// few integer ops — fast enough to run in a dedicated worker without LSH/
// bucketing, but still kept off the main thread (see cluster.worker.ts).
export function clusterByHamming(entries: ClusterableHash[], thresholdBits: number): RawCluster[] {
  const n = entries.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    const ai = entries[i];
    for (let j = i + 1; j < n; j++) {
      const bj = entries[j];
      if (hammingDistance(ai.hashHi, ai.hashLo, bj.hashHi, bj.hashLo) <= thresholdBits) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let members = groups.get(root);
    if (!members) {
      members = [];
      groups.set(root, members);
    }
    members.push(entries[i].id);
  }

  let clusterId = 0;
  const result: RawCluster[] = [];
  for (const memberIds of groups.values()) {
    result.push({ clusterId: clusterId++, memberIds });
  }
  return result;
}

// Slider is 0-100 in the UI; the full 0-64 bit range is never useful for a
// "near duplicate" cutoff, so it's compressed to 0-20 bits.
export function sliderToThresholdBits(slider: number): number {
  const clamped = Math.max(0, Math.min(100, slider));
  return Math.round((clamped / 100) * 20);
}
