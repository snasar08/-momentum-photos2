"use client";

import { useEffect, useRef, useState } from "react";
import Stepper from "./Stepper";
import UploadStep from "./steps/UploadStep";
import ReviewDuplicatesStep from "./steps/ReviewDuplicatesStep";
import EnhanceStep from "./steps/EnhanceStep";
import FaceTagStep from "./steps/FaceTagStep";
import ConfigureCropStep from "./steps/ConfigureCropStep";
import ProcessExportStep from "./steps/ProcessExportStep";
import {
  IntakeFile,
  SkippedFile,
  CropConfig,
  Phase,
  ScanResult,
  ScanFailure,
  ScanRequest,
  ScanResponse,
} from "@/lib/types";
import { WorkerPool } from "@/lib/workerPool";
import { runScanPipeline } from "@/lib/scanPipeline";
import { defaultWorkerPoolSize } from "@/lib/capabilities";
import { ALBUM_PARAM, decodeAlbumState } from "@/lib/shareLink";
import { mergeFromShareLink } from "@/lib/persistence";

const DEFAULT_CROP: CropConfig = { aspectW: null, aspectH: null, maxDimension: 2048, quality: 0.8 };

export default function Wizard() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [acceptedFiles, setAcceptedFiles] = useState<IntakeFile[]>([]);
  const [, setSkippedFiles] = useState<SkippedFile[]>([]);
  const [filesToProcess, setFilesToProcess] = useState<IntakeFile[]>([]);
  const [cropConfig, setCropConfig] = useState<CropConfig>(DEFAULT_CROP);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ completed: 0, total: 0, currentName: "" });
  const [scanResults, setScanResults] = useState<Map<string, ScanResult>>(new Map());
  const [scanFailures, setScanFailures] = useState<ScanFailure[]>([]);
  const thumbUrlsRef = useRef<Map<string, string>>(new Map());
  const scannedForRef = useRef<IntakeFile[] | null>(null);
  const [shareBannerVisible, setShareBannerVisible] = useState(false);

  // One-time check for a shared-album link param on first mount. Decoding
  // is async (gzip via CompressionStream), so this can't run inline during
  // render — the param is stripped via replaceState once consumed so a
  // page refresh doesn't re-apply it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get(ALBUM_PARAM);
    if (!encoded) return;
    decodeAlbumState(encoded).then((payload) => {
      if (!payload) return;
      mergeFromShareLink(payload);
      setShareBannerVisible(true);
      params.delete(ALBUM_PARAM);
      const next = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (next ? `?${next}` : ""));
    });
  }, []);

  // Scanning (decode + hash + thumbnail) is the expensive step at 5,000-photo
  // scale, so it's run once per upload here in Wizard and cached — clicking
  // Back/Continue between Review and Configure must not re-trigger it.
  useEffect(() => {
    if (phase !== "review") return;
    if (scannedForRef.current === acceptedFiles) return;
    scannedForRef.current = acceptedFiles;

    for (const url of thumbUrlsRef.current.values()) URL.revokeObjectURL(url);
    thumbUrlsRef.current.clear();

    let cancelled = false;
    setScanning(true);
    setScanResults(new Map());
    setScanFailures([]);
    setScanProgress({ completed: 0, total: acceptedFiles.length, currentName: "" });

    const pool = new WorkerPool<ScanRequest, ScanResponse>(
      () => new Worker(new URL("../workers/scan.worker.ts", import.meta.url), { type: "module" }),
      defaultWorkerPoolSize()
    );

    (async () => {
      const { results, failures } = await runScanPipeline(acceptedFiles, pool, (completed, total, currentName) => {
        if (!cancelled) setScanProgress({ completed, total, currentName });
      });
      if (cancelled) return;
      const map = new Map<string, ScanResult>();
      for (const r of results) {
        map.set(r.id, r);
        thumbUrlsRef.current.set(r.id, URL.createObjectURL(r.thumbnailBlob));
      }
      setScanResults(map);
      setScanFailures(failures);
      setScanning(false);
    })();

    return () => {
      cancelled = true;
      pool.terminate();
    };
  }, [phase, acceptedFiles]);

  useEffect(() => {
    const urls = thumbUrlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, []);

  function handleUploadContinue(accepted: IntakeFile[], skipped: SkippedFile[]) {
    setAcceptedFiles(accepted);
    setSkippedFiles(skipped);
    setPhase("review");
  }

  function handleReviewContinue(files: IntakeFile[]) {
    setFilesToProcess(files);
    setPhase("enhance");
  }

  function handleRestart() {
    for (const url of thumbUrlsRef.current.values()) URL.revokeObjectURL(url);
    thumbUrlsRef.current.clear();
    scannedForRef.current = null;
    setAcceptedFiles([]);
    setSkippedFiles([]);
    setFilesToProcess([]);
    setCropConfig(DEFAULT_CROP);
    setScanResults(new Map());
    setScanFailures([]);
    setPhase("upload");
  }

  return (
    <>
      <Stepper current={phase} />
      {shareBannerVisible && (
        <div className="share-banner">Shared album link applied — tags and preferences were merged in.</div>
      )}
      {phase === "upload" && <UploadStep onContinue={handleUploadContinue} />}
      {phase === "review" && (
        <ReviewDuplicatesStep
          files={acceptedFiles}
          scanning={scanning}
          scanProgress={scanProgress}
          scanResults={scanResults}
          scanFailures={scanFailures}
          thumbnailUrls={thumbUrlsRef.current}
          onBack={() => setPhase("upload")}
          onContinue={handleReviewContinue}
        />
      )}
      {phase === "enhance" && (
        <EnhanceStep
          files={filesToProcess}
          scanResults={scanResults}
          thumbnailUrls={thumbUrlsRef.current}
          onBack={() => setPhase("review")}
          onContinue={() => setPhase("faces")}
        />
      )}
      {phase === "faces" && (
        <FaceTagStep
          files={filesToProcess}
          scanResults={scanResults}
          thumbnailUrls={thumbUrlsRef.current}
          onBack={() => setPhase("enhance")}
          onContinue={() => setPhase("configure")}
        />
      )}
      {phase === "configure" && (
        <ConfigureCropStep
          sampleFile={filesToProcess[0] ?? null}
          cropConfig={cropConfig}
          onChange={setCropConfig}
          onBack={() => setPhase("faces")}
          onContinue={() => setPhase("process")}
        />
      )}
      {phase === "process" && (
        <ProcessExportStep
          files={filesToProcess}
          cropConfig={cropConfig}
          scanResults={scanResults}
          onBack={() => setPhase("configure")}
          onRestart={handleRestart}
        />
      )}
    </>
  );
}
