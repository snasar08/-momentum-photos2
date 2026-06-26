"use client";

import { useEffect, useMemo, useState } from "react";
import { IntakeFile, ScanResult, ScanFailure, ClusterHashEntry } from "@/lib/types";
import { runClustering } from "@/lib/clusterClient";
import { sliderToThresholdBits } from "@/lib/hammingCluster";

interface UiCluster {
  clusterId: number;
  memberIds: string[];
}

interface ReviewDuplicatesStepProps {
  files: IntakeFile[];
  scanning: boolean;
  scanProgress: { completed: number; total: number; currentName: string };
  scanResults: Map<string, ScanResult>;
  scanFailures: ScanFailure[];
  thumbnailUrls: Map<string, string>;
  onBack: () => void;
  onContinue: (filesToProcess: IntakeFile[]) => void;
}

export default function ReviewDuplicatesStep({
  files,
  scanning,
  scanProgress,
  scanResults,
  scanFailures,
  thumbnailUrls,
  onBack,
  onContinue,
}: ReviewDuplicatesStepProps) {
  const [showFailures, setShowFailures] = useState(false);
  const [slider, setSlider] = useState(50);
  const [clusters, setClusters] = useState<UiCluster[]>([]);
  const [clustering, setClustering] = useState(false);
  const [keptByCluster, setKeptByCluster] = useState<Map<number, Set<string>>>(new Map());

  useEffect(() => {
    if (scanning || scanResults.size === 0) {
      setClusters([]);
      setKeptByCluster(new Map());
      return;
    }
    let cancelled = false;
    setClustering(true);
    const entries: ClusterHashEntry[] = Array.from(scanResults.values()).map((r) => ({
      id: r.id,
      hashHi: r.hashHi,
      hashLo: r.hashLo,
    }));
    const thresholdBits = sliderToThresholdBits(slider);
    runClustering(entries, thresholdBits).then((res) => {
      if (cancelled) return;
      const dupClusters = res.clusters.filter((c) => c.memberIds.length > 1);
      setClusters(dupClusters);
      const kept = new Map<number, Set<string>>();
      for (const c of dupClusters) kept.set(c.clusterId, new Set([c.memberIds[0]]));
      setKeptByCluster(kept);
      setClustering(false);
    });
    return () => {
      cancelled = true;
    };
  }, [scanning, scanResults, slider]);

  function toggleKeep(clusterId: number, id: string) {
    setKeptByCluster((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(clusterId) ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      next.set(clusterId, set);
      return next;
    });
  }

  const clusteredIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of clusters) for (const id of c.memberIds) s.add(id);
    return s;
  }, [clusters]);

  const singletonCount = scanResults.size - clusteredIds.size;

  const finalFiles = useMemo(() => {
    const keepSet = new Set<string>();
    for (const id of scanResults.keys()) {
      if (!clusteredIds.has(id)) keepSet.add(id);
    }
    for (const set of keptByCluster.values()) {
      for (const id of set) keepSet.add(id);
    }
    return files.filter((f) => keepSet.has(f.id));
  }, [files, scanResults, clusteredIds, keptByCluster]);

  if (scanning) {
    const pct = scanProgress.total > 0 ? Math.round((scanProgress.completed / scanProgress.total) * 100) : 0;
    return (
      <div>
        <h2>Review Duplicates</h2>
        <div className="status-area">
          <div className="status-text">
            Scanning {scanProgress.completed.toLocaleString()} / {scanProgress.total.toLocaleString()}
            {scanProgress.currentName ? ` — ${scanProgress.currentName}` : ""}
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Review Duplicates</h2>
      <p className="hint">
        Photos that look alike are grouped below. Click a thumbnail to keep or exclude it. Unique
        photos aren&apos;t shown individually.
      </p>

      <div className="summary-counts">
        <div>
          <strong>{scanResults.size.toLocaleString()}</strong> scanned successfully
        </div>
        <div>
          <strong>{clusters.length.toLocaleString()}</strong> duplicate group{clusters.length === 1 ? "" : "s"} (
          {clusteredIds.size.toLocaleString()} photos)
        </div>
        <div>
          <strong>{singletonCount.toLocaleString()}</strong> unique photo{singletonCount === 1 ? "" : "s"}
        </div>
        <div>
          <strong>{finalFiles.length.toLocaleString()}</strong> will be exported
        </div>
        {scanFailures.length > 0 && (
          <div>
            <strong>{scanFailures.length.toLocaleString()}</strong> failed to scan
          </div>
        )}
      </div>

      <div className="slider-row">
        <div className="slider-label">
          <span>Duplicate sensitivity</span>
          <span>{slider}</span>
        </div>
        <input type="range" min={0} max={100} value={slider} onChange={(e) => setSlider(Number(e.target.value))} />
      </div>

      {clustering && <p className="hint">Recalculating groups…</p>}

      {clusters.map((cluster) => {
        const kept = keptByCluster.get(cluster.clusterId) ?? new Set<string>();
        return (
          <div className="cluster-group" key={cluster.clusterId}>
            <div className="cluster-header">
              Group of {cluster.memberIds.length} — keeping {kept.size}
            </div>
            <div className="thumb-grid">
              {cluster.memberIds.map((id) => {
                const url = thumbnailUrls.get(id);
                const isKept = kept.has(id);
                return (
                  <div
                    key={id}
                    className={`thumb-card ${isKept ? "selected" : ""}`}
                    onClick={() => toggleKeep(cluster.clusterId, id)}
                  >
                    {url && <img src={url} alt="" loading="lazy" decoding="async" />}
                    {isKept && <span className="thumb-badge">Keep</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {scanFailures.length > 0 && (
        <>
          <div className="skip-summary" onClick={() => setShowFailures((s) => !s)}>
            {showFailures ? "Hide" : "Show"} {scanFailures.length} scan failure{scanFailures.length === 1 ? "" : "s"}
          </div>
          {showFailures && (
            <div className="error-list">
              {scanFailures.map((f) => {
                const file = files.find((x) => x.id === f.id);
                return (
                  <div className="skip-item" key={f.id}>
                    <span>{file?.relativePath ?? f.id}</span>
                    <span className="skip-reason">{f.error}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="btn-row">
        <button className="btn" onClick={onBack}>
          Back
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onContinue(finalFiles)}
          disabled={finalFiles.length === 0 || clustering}
        >
          Continue ({finalFiles.length.toLocaleString()})
        </button>
      </div>
    </div>
  );
}
