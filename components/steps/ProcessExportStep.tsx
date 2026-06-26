"use client";

import { useState } from "react";
import { IntakeFile, CropConfig, ExportRequest, ExportResponse, ScanResult } from "@/lib/types";
import { WorkerPool } from "@/lib/workerPool";
import { runExportPipeline } from "@/lib/exportPipeline";
import { exportZip } from "@/lib/zipExport";
import { defaultWorkerPoolSize } from "@/lib/capabilities";
import { buildAlbumPayloadForSession, encodeAlbumState, ALBUM_PARAM } from "@/lib/shareLink";

interface ProcessExportStepProps {
  files: IntakeFile[];
  cropConfig: CropConfig;
  scanResults: Map<string, ScanResult>;
  onBack: () => void;
  onRestart: () => void;
}

type RunState = "idle" | "running" | "done" | "error";
type ShareState = "idle" | "copied" | "error";

export default function ProcessExportStep({ files, cropConfig, scanResults, onBack, onRestart }: ProcessExportStepProps) {
  const [state, setState] = useState<RunState>("idle");
  const [progress, setProgress] = useState({ completed: 0, total: files.length, currentName: "" });
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [shareState, setShareState] = useState<ShareState>("idle");

  async function handleExport() {
    setState("running");
    setErrors([]);
    setFatalError(null);
    setProgress({ completed: 0, total: files.length, currentName: "" });

    const pool = new WorkerPool<ExportRequest, ExportResponse>(
      () => new Worker(new URL("../../workers/export.worker.ts", import.meta.url), { type: "module" }),
      defaultWorkerPoolSize()
    );

    const localErrors: { name: string; error: string }[] = [];
    // Built before exportZip() is called so the picker dialog (which must
    // happen as a direct result of this click) isn't delayed by any of the
    // chunked export work — the generator body doesn't run until pulled.
    const generator = runExportPipeline(
      files,
      cropConfig,
      scanResults,
      pool,
      (completed, total, currentName) => setProgress({ completed, total, currentName }),
      (name, error) => localErrors.push({ name, error })
    );

    try {
      await exportZip(generator, "photos.zip");
      setErrors(localErrors);
      setState("done");
    } catch (err) {
      setErrors(localErrors);
      if (err instanceof DOMException && err.name === "AbortError") {
        setState("idle");
      } else {
        setFatalError(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    } finally {
      pool.terminate();
    }
  }

  async function handleShare() {
    try {
      const payload = buildAlbumPayloadForSession(scanResults);
      const encoded = await encodeAlbumState(payload);
      const url = `${window.location.origin}${window.location.pathname}?${ALBUM_PARAM}=${encoded}`;
      await navigator.clipboard.writeText(url);
      setShareState("copied");
    } catch {
      setShareState("error");
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div>
      <h2>Process &amp; Export</h2>
      <p className="hint">
        {files.length.toLocaleString()} photo{files.length === 1 ? "" : "s"} will be cropped and packaged into a ZIP.
        This happens entirely in your browser.
      </p>

      {state === "running" && (
        <div className="status-area">
          <div className="status-text">
            Processing {progress.completed.toLocaleString()} / {progress.total.toLocaleString()}
            {progress.currentName ? ` — ${progress.currentName}` : ""}
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {state === "done" && (
        <div className="summary-counts">
          <div>
            <strong>{(progress.total - errors.length).toLocaleString()}</strong> exported successfully
          </div>
          {errors.length > 0 && (
            <div>
              <strong>{errors.length.toLocaleString()}</strong> failed during export
            </div>
          )}
          <div>Your download should have started — check your downloads folder.</div>
        </div>
      )}

      {state === "done" && (
        <div className="upload-actions">
          <button className="btn" onClick={handleShare}>
            Share Album
          </button>
          {shareState === "copied" && <span className="hint">Link copied to clipboard</span>}
          {shareState === "error" && <span className="hint">Couldn&apos;t copy link</span>}
        </div>
      )}

      {fatalError && <div className="error-text">Export failed: {fatalError}</div>}

      {errors.length > 0 && (
        <>
          <div className="skip-summary" onClick={() => setShowErrors((s) => !s)}>
            {showErrors ? "Hide" : "Show"} {errors.length} export error{errors.length === 1 ? "" : "s"}
          </div>
          {showErrors && (
            <div className="error-list">
              {errors.map((e, i) => (
                <div className="skip-item" key={`${e.name}-${i}`}>
                  <span>{e.name}</span>
                  <span className="skip-reason">{e.error}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="btn-row">
        <button className="btn" onClick={onBack} disabled={state === "running"}>
          Back
        </button>
        {state === "done" ? (
          <button className="btn btn-primary" onClick={onRestart}>
            Start Over
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleExport} disabled={state === "running"}>
            {state === "running" ? "Processing…" : "Export ZIP"}
          </button>
        )}
      </div>
    </div>
  );
}
