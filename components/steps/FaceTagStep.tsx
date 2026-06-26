"use client";

import { useEffect, useState } from "react";
import { IntakeFile, ScanResult, ClusterHashEntry } from "@/lib/types";
import { runFaceClustering } from "@/lib/faceCluster";
import { photoKey, setFaceTag, getFaceTags } from "@/lib/persistence";

interface FaceCluster {
  clusterId: number;
  memberIds: string[];
}

interface FaceTagStepProps {
  files: IntakeFile[];
  scanResults: Map<string, ScanResult>;
  thumbnailUrls: Map<string, string>;
  onBack: () => void;
  onContinue: () => void;
}

export default function FaceTagStep({ files, scanResults, thumbnailUrls, onBack, onContinue }: FaceTagStepProps) {
  const [clustering, setClustering] = useState(true);
  const [clusters, setClusters] = useState<FaceCluster[]>([]);
  const [labels, setLabels] = useState<Map<number, string>>(new Map());
  const [savedClusters, setSavedClusters] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (files.length === 0 || scanResults.size === 0) {
      setClusters([]);
      setClustering(false);
      return;
    }
    let cancelled = false;
    setClustering(true);

    const entries: ClusterHashEntry[] = files
      .filter((f) => scanResults.has(f.id))
      .map((f) => {
        const r = scanResults.get(f.id)!;
        return { id: f.id, hashHi: r.hashHi, hashLo: r.hashLo };
      });

    runFaceClustering(entries).then((res) => {
      if (cancelled) return;

      // Pre-fill any cluster whose first tagged member already has a saved
      // label from a previous session, so returning users aren't re-prompted.
      const tags = getFaceTags();
      const initialLabels = new Map<number, string>();
      const initialSaved = new Set<number>();
      for (const c of res.clusters) {
        for (const id of c.memberIds) {
          const scan = scanResults.get(id);
          if (!scan) continue;
          const existing = tags.get(photoKey(scan));
          if (existing) {
            initialLabels.set(c.clusterId, existing);
            initialSaved.add(c.clusterId);
            break;
          }
        }
      }

      setClusters(res.clusters);
      setLabels(initialLabels);
      setSavedClusters(initialSaved);
      setClustering(false);
    });

    return () => {
      cancelled = true;
    };
  }, [files, scanResults]);

  function updateLabel(clusterId: number, value: string) {
    setLabels((prev) => {
      const next = new Map(prev);
      next.set(clusterId, value);
      return next;
    });
    setSavedClusters((prev) => {
      if (!prev.has(clusterId)) return prev;
      const next = new Set(prev);
      next.delete(clusterId);
      return next;
    });
  }

  function saveLabel(cluster: FaceCluster) {
    const label = (labels.get(cluster.clusterId) ?? "").trim();
    if (!label) return;
    for (const id of cluster.memberIds) {
      const scan = scanResults.get(id);
      if (!scan) continue;
      setFaceTag(photoKey(scan), label);
    }
    setSavedClusters((prev) => new Set(prev).add(cluster.clusterId));
  }

  if (clustering) {
    return (
      <div>
        <h2>Tag Faces</h2>
        <div className="status-area">
          <div className="status-text">Grouping similar photos…</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Tag Faces</h2>
      <p className="hint">
        Photos are grouped by visual similarity as a placeholder for real face detection. Label
        each group once — the tag is saved and reused next time you upload the same photos.
      </p>

      {clusters.map((cluster) => (
        <div className="cluster-group" key={cluster.clusterId}>
          <div className="cluster-header">
            Who is this? ({cluster.memberIds.length} photo{cluster.memberIds.length === 1 ? "" : "s"})
          </div>
          <div className="thumb-grid">
            {cluster.memberIds.map((id) => {
              const url = thumbnailUrls.get(id);
              return (
                <div className="thumb-card selected" key={id}>
                  {url && <img src={url} alt="" loading="lazy" />}
                </div>
              );
            })}
          </div>
          <div className="tag-row">
            <input
              type="text"
              className="tag-input"
              placeholder="Name"
              value={labels.get(cluster.clusterId) ?? ""}
              onChange={(e) => updateLabel(cluster.clusterId, e.target.value)}
            />
            <button className="btn" onClick={() => saveLabel(cluster)}>
              Save
            </button>
            {savedClusters.has(cluster.clusterId) && <span className="hint">Saved</span>}
          </div>
        </div>
      ))}

      <div className="btn-row">
        <button className="btn" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onContinue} disabled={clustering}>
          Continue
        </button>
      </div>
    </div>
  );
}
