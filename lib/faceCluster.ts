import { ClusterHashEntry, ClusterResponse } from "./types";
import { runClustering } from "./clusterClient";

// Deliberately reuses the exact dedup perceptual-hash clustering algorithm
// (lib/hammingCluster.ts via lib/clusterClient.ts) at a much looser
// threshold, as a placeholder for real face detection/clustering — visually
// similar photos get grouped into one "who is this?" prompt. Unlike the
// duplicate-review step, singleton clusters are kept: every photo needs a
// tag, not just photos that look like another one.
export const FACE_THRESHOLD_BITS = 14;

export function runFaceClustering(entries: ClusterHashEntry[]): Promise<ClusterResponse> {
  return runClustering(entries, FACE_THRESHOLD_BITS);
}
