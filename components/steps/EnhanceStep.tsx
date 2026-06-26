"use client";

import { useEffect, useState } from "react";
import { IntakeFile, ScanResult, FrameRectNorm } from "@/lib/types";
import { processInChunks } from "@/lib/workerPool";
import { GLARE_FILTER_VARIANTS, GLARE_REVIEW_THRESHOLD, computeGlareScore, scoreFilterVariant } from "@/lib/glare";
import { detectFrameRect } from "@/lib/frameCrop";
import { readExifOrientation, ROTATABLE_ORIENTATIONS, ORIENTATION_PREVIEW_DEG } from "@/lib/exifOrientation";
import { photoKey, setGlarePref, setFramePref, setRotatePref } from "@/lib/persistence";
import { logOverride, getSessionBias } from "@/lib/learning";

interface EnhanceItem {
  id: string;
  photoKey: string;
  glareScores: number[] | null;
  glareAutoIndex: number;
  frameRect: FrameRectNorm | null;
  exifOrientation: number | null;
}

interface EnhanceStepProps {
  files: IntakeFile[];
  scanResults: Map<string, ScanResult>;
  thumbnailUrls: Map<string, string>;
  onBack: () => void;
  onContinue: () => void;
}

const ANALYSIS_CHUNK_SIZE = 16;

async function analyzeFile(file: IntakeFile, scan: ScanResult): Promise<EnhanceItem | null> {
  const bitmap = await createImageBitmap(scan.thumbnailBlob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);

  const baseScore = computeGlareScore(ctx, w, h);
  let glareScores: number[] | null = null;
  let glareAutoIndex = 0;
  if (baseScore > GLARE_REVIEW_THRESHOLD) {
    glareScores = GLARE_FILTER_VARIANTS.map((variant, i) =>
      i === 0 ? baseScore : scoreFilterVariant(ctx, bitmap, w, h, variant)
    );
    // scoreFilterVariant leaves the last variant's filtered pixels painted —
    // restore the plain original before the frame-edge scan below.
    ctx.filter = "none";
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0);

    let best = 0;
    for (let i = 1; i < glareScores.length; i++) {
      if (glareScores[i] < glareScores[best]) best = i;
    }
    glareAutoIndex = best;
  }

  const frameRect = detectFrameRect(ctx, w, h);
  bitmap.close();

  // The canvas-encoded thumbnail never carries EXIF (it's a fresh JPEG
  // re-encode), so the orientation tag must come from the original upload.
  // Scoped to JPEG only — HEIC orientation lives in a different ISOBMFF box
  // structure that convertHeicToJpeg already resolves visually today.
  let exifOrientation: number | null = null;
  if (file.mime === "image/jpeg") {
    const raw = await readExifOrientation(file.file);
    if (ROTATABLE_ORIENTATIONS.has(raw)) exifOrientation = raw;
  }

  if (glareScores == null && frameRect == null && exifOrientation == null) return null;
  return { id: file.id, photoKey: photoKey(scan), glareScores, glareAutoIndex, frameRect, exifOrientation };
}

// Nudges the auto-pick toward whatever the user has chosen most often this
// session (frequency tally from lib/learning.ts), without ever overriding a
// large measured quality gap.
function applySessionBias(items: EnhanceItem[]): EnhanceItem[] {
  const bias = getSessionBias("glare");
  if (bias.size === 0) return items;
  return items.map((item) => {
    if (!item.glareScores) return item;
    let best = 0;
    let bestEffective = Infinity;
    for (let i = 0; i < item.glareScores.length; i++) {
      const biasCount = bias.get(String(i)) ?? 0;
      const effective = item.glareScores[i] * (1 - Math.min(biasCount, 5) * 0.08);
      if (effective < bestEffective) {
        bestEffective = effective;
        best = i;
      }
    }
    return { ...item, glareAutoIndex: best };
  });
}

// Mirrors applySessionBias for the binary auto-rotate/keep-original choice:
// if this session has chosen "original" more often than "auto", default new
// flagged photos to "original" too instead of always defaulting to auto.
function defaultApplyAutoRotate(bias: Map<string, number>): boolean {
  const original = bias.get("original") ?? 0;
  const auto = bias.get("auto") ?? 0;
  return !(original > auto);
}

export default function EnhanceStep({ files, scanResults, thumbnailUrls, onBack, onContinue }: EnhanceStepProps) {
  const [analyzing, setAnalyzing] = useState(true);
  const [items, setItems] = useState<EnhanceItem[]>([]);
  const [glareSelected, setGlareSelected] = useState<Map<string, number>>(new Map());
  const [frameEnabled, setFrameEnabled] = useState<Map<string, boolean>>(new Map());
  const [rotateSelected, setRotateSelected] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (files.length === 0 || scanResults.size === 0) {
      setItems([]);
      setGlareSelected(new Map());
      setFrameEnabled(new Map());
      setRotateSelected(new Map());
      setAnalyzing(false);
      return;
    }
    let cancelled = false;
    setAnalyzing(true);

    const candidates = files
      .map((f) => ({ file: f, scan: scanResults.get(f.id) }))
      .filter((x): x is { file: IntakeFile; scan: ScanResult } => x.scan != null);

    processInChunks(candidates, ANALYSIS_CHUNK_SIZE, ({ file, scan }) => analyzeFile(file, scan)).then((raw) => {
      if (cancelled) return;
      const found = applySessionBias(raw.filter((r): r is EnhanceItem => r != null));

      const rotateBias = getSessionBias("rotate");
      const glareMap = new Map<string, number>();
      const frameMap = new Map<string, boolean>();
      const rotateMap = new Map<string, boolean>();
      for (const item of found) {
        if (item.glareScores) {
          glareMap.set(item.id, item.glareAutoIndex);
          setGlarePref({ photoKey: item.photoKey, filterIndex: item.glareAutoIndex });
        }
        if (item.frameRect) {
          frameMap.set(item.id, true);
          setFramePref({ photoKey: item.photoKey, frameRectNorm: item.frameRect, enabled: true });
        }
        if (item.exifOrientation != null) {
          const applyAutoRotate = defaultApplyAutoRotate(rotateBias);
          rotateMap.set(item.id, applyAutoRotate);
          setRotatePref({ photoKey: item.photoKey, exifOrientation: item.exifOrientation, applyAutoRotate });
        }
      }

      setItems(found);
      setGlareSelected(glareMap);
      setFrameEnabled(frameMap);
      setRotateSelected(rotateMap);
      setAnalyzing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [files, scanResults]);

  function chooseGlare(item: EnhanceItem, index: number) {
    setGlareSelected((prev) => {
      const next = new Map(prev);
      next.set(item.id, index);
      return next;
    });
    setGlarePref({ photoKey: item.photoKey, filterIndex: index });
    logOverride("glare", String(index), String(item.glareAutoIndex));
  }

  function toggleFrame(item: EnhanceItem, enabled: boolean) {
    setFrameEnabled((prev) => {
      const next = new Map(prev);
      next.set(item.id, enabled);
      return next;
    });
    setFramePref({ photoKey: item.photoKey, frameRectNorm: item.frameRect, enabled });
    logOverride("frame", enabled ? "cropped" : "original", "cropped");
  }

  function toggleRotate(item: EnhanceItem, applyAutoRotate: boolean) {
    if (item.exifOrientation == null) return;
    setRotateSelected((prev) => {
      const next = new Map(prev);
      next.set(item.id, applyAutoRotate);
      return next;
    });
    setRotatePref({ photoKey: item.photoKey, exifOrientation: item.exifOrientation, applyAutoRotate });
    logOverride("rotate", applyAutoRotate ? "auto" : "original", "auto");
  }

  if (analyzing) {
    return (
      <div>
        <h2>Enhance Photos</h2>
        <div className="status-area">
          <div className="status-text">Checking photos for glare, borders, and rotation…</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Enhance Photos</h2>
      <p className="hint">
        Photos with detected glare, an inner border, or a sideways/upside-down EXIF tag are shown
        below with a fix already applied. Click to choose a different version, or continue as-is —
        your choice is saved automatically.
      </p>

      {items.length === 0 && <p className="hint">No glare, borders, or rotation issues detected in this batch.</p>}

      {items.map((item) => {
        const thumbUrl = thumbnailUrls.get(item.id);
        const selectedGlare = glareSelected.get(item.id) ?? item.glareAutoIndex;
        const frameOn = frameEnabled.get(item.id) ?? true;
        const rotateOn = rotateSelected.get(item.id) ?? true;
        return (
          <div className="cluster-group" key={item.id}>
            {item.glareScores && (
              <>
                <div className="cluster-header">Glare detected — choose the best version</div>
                <div className="thumb-grid">
                  {GLARE_FILTER_VARIANTS.map((variant, i) => (
                    <div
                      key={i}
                      className={`thumb-card ${selectedGlare === i ? "selected" : ""}`}
                      onClick={() => chooseGlare(item, i)}
                    >
                      {thumbUrl && <img src={thumbUrl} alt="" style={{ filter: variant }} loading="lazy" />}
                      {selectedGlare === i && <span className="thumb-badge">Selected</span>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {item.frameRect && (
              <>
                <div className="cluster-header">Border detected — inner photo will be cropped</div>
                <div className="crop-preview-frame">
                  {thumbUrl && <img src={thumbUrl} className="crop-preview-img" alt="" />}
                  {frameOn && (
                    <div
                      className="crop-overlay"
                      style={{
                        left: `${item.frameRect.x * 100}%`,
                        top: `${item.frameRect.y * 100}%`,
                        width: `${item.frameRect.w * 100}%`,
                        height: `${item.frameRect.h * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="upload-actions">
                  <button className={`btn ${frameOn ? "btn-primary" : ""}`} onClick={() => toggleFrame(item, true)}>
                    Use Crop
                  </button>
                  <button className={`btn ${!frameOn ? "btn-primary" : ""}`} onClick={() => toggleFrame(item, false)}>
                    Keep Original
                  </button>
                </div>
              </>
            )}

            {item.exifOrientation != null && (
              <>
                <div className="cluster-header">Photo was auto-rotated from how it was stored</div>
                <div className="rotate-preview-row">
                  <div className="rotate-preview-box">
                    {thumbUrl && <img src={thumbUrl} alt="Auto-rotated" />}
                    <span className="rotate-preview-label">Auto-rotated (current)</span>
                  </div>
                  <div className={`rotate-preview-box ${item.exifOrientation !== 3 ? "swapped" : ""}`}>
                    {thumbUrl && (
                      <img
                        src={thumbUrl}
                        alt="Original orientation"
                        style={{ transform: `rotate(${ORIENTATION_PREVIEW_DEG[item.exifOrientation]}deg)` }}
                      />
                    )}
                    <span className="rotate-preview-label">Original orientation</span>
                  </div>
                </div>
                <div className="upload-actions">
                  <button className={`btn ${rotateOn ? "btn-primary" : ""}`} onClick={() => toggleRotate(item, true)}>
                    Keep Auto-Rotation
                  </button>
                  <button
                    className={`btn ${!rotateOn ? "btn-primary" : ""}`}
                    onClick={() => toggleRotate(item, false)}
                  >
                    Use Original Orientation
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}

      <div className="btn-row">
        <button className="btn" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onContinue} disabled={analyzing}>
          Continue
        </button>
      </div>
    </div>
  );
}
