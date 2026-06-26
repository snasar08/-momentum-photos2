"use client";

import { useEffect, useRef, useState } from "react";
import { classifyFiles, filesFromDataTransfer, SOFT_CAP } from "@/lib/fileIntake";
import { IntakeFile, SkippedFile } from "@/lib/types";

interface UploadStepProps {
  onContinue: (accepted: IntakeFile[], skipped: SkippedFile[]) => void;
}

export default function UploadStep({ onContinue }: UploadStepProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const flatInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<IntakeFile[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);

  // webkitdirectory/directory aren't part of React's input attribute types,
  // so they're applied imperatively rather than as JSX props.
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "true");
      el.setAttribute("directory", "true");
    }
  }, []);

  function processFiles(files: File[]) {
    const result = classifyFiles(files);
    setAccepted(result.accepted);
    setSkipped(result.skipped);
  }

  function handleFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) processFiles(files);
    e.target.value = "";
  }

  function handleFlatChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) processFiles(files);
    e.target.value = "";
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    setBusy(true);
    try {
      const files = await filesFromDataTransfer(e.dataTransfer.items);
      processFiles(files);
    } finally {
      setBusy(false);
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  const totalCount = accepted.length + skipped.length;

  return (
    <div>
      <h2>Upload Photos</h2>
      <p className="hint">
        Drop a folder of photos here, or pick a folder/files below. Everything is processed
        entirely in your browser — nothing is uploaded anywhere. Supports JPEG, PNG, WebP, GIF,
        BMP, AVIF, and HEIC/HEIF, up to about {SOFT_CAP.toLocaleString()} photos per run.
      </p>

      <div
        className={`dropzone ${dragOver ? "dragover" : ""} ${busy ? "busy" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onClick={() => folderInputRef.current?.click()}
      >
        <div className="dropzone-label">
          {busy ? (
            "Reading folder…"
          ) : totalCount > 0 ? (
            <>
              {accepted.length.toLocaleString()} photo{accepted.length === 1 ? "" : "s"} ready
              <br />
              <span>
                {skipped.length > 0
                  ? `${skipped.length} skipped — click to choose a different folder`
                  : "Click to choose a different folder"}
              </span>
            </>
          ) : (
            <>
              Drop a folder here, or click to choose one
              <br />
              <span>Folders, drag-and-drop, or individual files all work</span>
            </>
          )}
        </div>
      </div>

      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFolderChange}
      />
      <input
        ref={flatInputRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif"
        style={{ display: "none" }}
        onChange={handleFlatChange}
      />

      <div className="upload-actions">
        <button className="btn" onClick={() => folderInputRef.current?.click()} disabled={busy}>
          Choose Folder
        </button>
        <button className="btn" onClick={() => flatInputRef.current?.click()} disabled={busy}>
          Choose Files
        </button>
      </div>

      {accepted.length > SOFT_CAP && (
        <p className="hint">
          {accepted.length.toLocaleString()} photos selected — this app is tuned for up to{" "}
          {SOFT_CAP.toLocaleString()}; a larger batch may be slower or use more memory.
        </p>
      )}

      {skipped.length > 0 && (
        <div className="skip-summary" onClick={() => setShowSkipped((s) => !s)}>
          {showSkipped ? "Hide" : "Show"} {skipped.length} skipped file{skipped.length === 1 ? "" : "s"}
        </div>
      )}
      {showSkipped && (
        <div className="skip-list">
          {skipped.map((s, i) => (
            <div className="skip-item" key={`${s.relativePath}-${i}`}>
              <span>{s.relativePath}</span>
              <span className="skip-reason">
                {s.reason}
                {s.detail ? ` (${s.detail})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="btn-row">
        <span />
        <button
          className="btn btn-primary"
          disabled={accepted.length === 0}
          onClick={() => onContinue(accepted, skipped)}
        >
          Continue ({accepted.length.toLocaleString()})
        </button>
      </div>
    </div>
  );
}
