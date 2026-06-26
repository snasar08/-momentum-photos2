"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IntakeFile, CropConfig } from "@/lib/types";
import { ASPECT_PRESETS, MAX_DIMENSION_OPTIONS, computeCenterCropRect } from "@/lib/cropMath";
import { decodeToBitmap } from "@/lib/imageDecode";

interface ConfigureCropStepProps {
  sampleFile: IntakeFile | null;
  cropConfig: CropConfig;
  onChange: (config: CropConfig) => void;
  onBack: () => void;
  onContinue: () => void;
}

export default function ConfigureCropStep({
  sampleFile,
  cropConfig,
  onChange,
  onBack,
  onContinue,
}: ConfigureCropStepProps) {
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Best-effort preview render — decode happens on the main thread (same
  // HEIC-aware path as everywhere else) but only ever for a single sample
  // photo, so it's cheap regardless of total batch size.
  useEffect(() => {
    if (!sampleFile) return;
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const bitmap = await decodeToBitmap(sampleFile.id, sampleFile.file, sampleFile.mime);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        if (cancelled) return;
        setNaturalSize({ w: canvas.width, h: canvas.height });
        canvas.toBlob((blob) => {
          if (!blob || cancelled) return;
          url = URL.createObjectURL(blob);
          setPreviewUrl(url);
        }, "image/jpeg", 0.85);
      } catch {
        // Preview is best-effort; configure step still works without it.
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sampleFile]);

  function measure() {
    if (imgRef.current) {
      setDisplaySize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
    }
  }

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const cropOverlayStyle = useMemo(() => {
    if (!naturalSize || !displaySize || cropConfig.aspectW == null || cropConfig.aspectH == null) return null;
    const rect = computeCenterCropRect(naturalSize.w, naturalSize.h, cropConfig.aspectW, cropConfig.aspectH);
    const scaleX = displaySize.w / naturalSize.w;
    const scaleY = displaySize.h / naturalSize.h;
    return {
      left: `${rect.x * scaleX}px`,
      top: `${rect.y * scaleY}px`,
      width: `${rect.w * scaleX}px`,
      height: `${rect.h * scaleY}px`,
    };
  }, [naturalSize, displaySize, cropConfig.aspectW, cropConfig.aspectH]);

  function selectPreset(w: number, h: number) {
    onChange({ ...cropConfig, aspectW: w, aspectH: h });
  }

  function applyCustom() {
    const w = parseFloat(customW);
    const h = parseFloat(customH);
    if (w > 0 && h > 0) {
      onChange({ ...cropConfig, aspectW: w, aspectH: h });
    }
  }

  const hasChosenAspect = cropConfig.aspectW != null && cropConfig.aspectH != null;

  return (
    <div>
      <h2>Configure Crop</h2>
      <p className="hint">Choose an aspect ratio to apply to every photo. This is required before continuing.</p>

      <div className="aspect-presets">
        {ASPECT_PRESETS.map((p) => (
          <button
            key={p.label}
            className={`aspect-btn ${cropConfig.aspectW === p.w && cropConfig.aspectH === p.h ? "active" : ""}`}
            onClick={() => selectPreset(p.w, p.h)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="custom-aspect">
        <span>Custom:</span>
        <input type="number" min={1} placeholder="W" value={customW} onChange={(e) => setCustomW(e.target.value)} />
        <span>:</span>
        <input type="number" min={1} placeholder="H" value={customH} onChange={(e) => setCustomH(e.target.value)} />
        <button className="btn" onClick={applyCustom}>
          Apply
        </button>
      </div>

      {previewUrl && (
        <div className="crop-preview-frame">
          <img ref={imgRef} src={previewUrl} className="crop-preview-img" alt="Crop preview" onLoad={measure} />
          {cropOverlayStyle && <div className="crop-overlay" style={cropOverlayStyle} />}
        </div>
      )}

      <div className="slider-row">
        <div className="slider-label">
          <span>Max output dimension (long edge)</span>
        </div>
        <select
          className="select-input"
          value={cropConfig.maxDimension}
          onChange={(e) => onChange({ ...cropConfig, maxDimension: Number(e.target.value) })}
        >
          {MAX_DIMENSION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "Original" : `${d}px`}
            </option>
          ))}
        </select>
      </div>

      <div className="slider-row">
        <div className="slider-label">
          <span>JPEG quality</span>
          <span>{cropConfig.quality.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={0.95}
          step={0.01}
          value={cropConfig.quality}
          onChange={(e) => onChange({ ...cropConfig, quality: Number(e.target.value) })}
        />
      </div>

      <div className="btn-row">
        <button className="btn" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onContinue} disabled={!hasChosenAspect}>
          Continue
        </button>
      </div>
    </div>
  );
}
