export type SupportedMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/bmp"
  | "image/avif"
  | "image/heic"
  | "image/heif";

export const EXT_TO_MIME: Record<string, SupportedMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

export interface IntakeFile {
  id: string;
  file: File;
  relativePath: string;
  mime: SupportedMime;
}

export type SkipReason =
  | "unsupported-type"
  | "decode-error"
  | "too-large"
  | "empty-file";

export interface SkippedFile {
  relativePath: string;
  reason: SkipReason;
  detail?: string;
}

export interface ScanResult {
  id: string;
  hashHi: number;
  hashLo: number;
  width: number;
  height: number;
  thumbnailBlob: Blob;
}

export interface ScanFailure {
  id: string;
  error: string;
}

export interface DuplicateCluster {
  clusterId: number;
  memberIds: string[];
  keptIds: Set<string>;
}

export interface CropConfig {
  aspectW: number | null;
  aspectH: number | null;
  maxDimension: number; // 0 means "original, no resize"
  quality: number;
}

export interface ExportProgress {
  completed: number;
  total: number;
  currentName: string;
}

export type Phase = "upload" | "review" | "enhance" | "faces" | "configure" | "process";

// ---- Worker message contracts ----

export interface ScanRequest {
  id: string;
  file: File | Blob;
  mime: SupportedMime;
  thumbnailSize: number;
}

export interface ScanResponseOk {
  id: string;
  ok: true;
  hashHi: number;
  hashLo: number;
  width: number;
  height: number;
  thumbnailBlob: Blob;
}

export interface ScanResponseErr {
  id: string;
  ok: false;
  error: string;
}

export type ScanResponse = ScanResponseOk | ScanResponseErr;

export interface FrameRectNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExportRequest {
  id: string;
  file: File | Blob;
  mime: SupportedMime;
  originalName: string;
  aspectW: number;
  aspectH: number;
  maxDimension: number;
  quality: number;
  filterCss?: string;
  frameRectNorm?: FrameRectNorm;
  applyAutoRotate?: boolean;
  exifOrientation?: number;
}

export interface ExportResponseOk {
  id: string;
  ok: true;
  filename: string;
  blob: Blob;
}

export interface ExportResponseErr {
  id: string;
  ok: false;
  error: string;
}

export type ExportResponse = ExportResponseOk | ExportResponseErr;

export interface ClusterHashEntry {
  id: string;
  hashHi: number;
  hashLo: number;
}

export interface ClusterRequest {
  entries: ClusterHashEntry[];
  thresholdBits: number;
}

export interface ClusterResponse {
  clusters: { clusterId: number; memberIds: string[] }[];
}

// ---- Persisted feature state (all keyed by content-derived photoKey, see
// lib/persistence.ts — IntakeFile.id is a fresh crypto.randomUUID() per
// upload and is never stable enough to persist against) ----

export interface FaceTagEntry {
  photoKey: string;
  label: string;
}

export interface GlarePref {
  photoKey: string;
  filterIndex: number;
}

export interface FramePref {
  photoKey: string;
  frameRectNorm: FrameRectNorm | null;
  enabled: boolean;
}

export interface RotatePref {
  photoKey: string;
  exifOrientation: number; // 3, 6, or 8 — the detected raw EXIF tag value
  applyAutoRotate: boolean; // true (default) = use the browser's auto-rotated orientation
}

export type OverrideFeature = "glare" | "frame" | "face" | "rotate";

export interface OverrideLogEntry {
  feature: OverrideFeature;
  chosen: string;
  auto: string;
  ts: number;
}

// Shared-album link payload — metadata only, never image bytes.
export interface AlbumStatePayload {
  faceTags: FaceTagEntry[];
  glarePrefs: GlarePref[];
  framePrefs: FramePref[];
  rotatePrefs: RotatePref[];
}
