import { ScanResult, FaceTagEntry, GlarePref, FramePref, RotatePref, AlbumStatePayload } from "./types";

// localStorage key is content-derived (hash + dimensions), not IntakeFile.id
// — id is a fresh crypto.randomUUID() per upload (see lib/fileIntake.ts) and
// is never stable across sessions. dHash is a perceptual hash, so two
// genuinely different low-detail images can collide; folding width/height in
// shrinks that risk without eliminating it. This is a convenience feature
// (remember my tag/preference for "the same photo"), not a security boundary.
export function photoKey(scan: ScanResult): string {
  return `${scan.hashHi.toString(36)}_${scan.hashLo.toString(36)}_${scan.width}x${scan.height}`;
}

const KEYS = {
  faceTags: "pbp:faceTags:v1",
  glarePrefs: "pbp:glarePrefs:v1",
  framePrefs: "pbp:framePrefs:v1",
  rotatePrefs: "pbp:rotatePrefs:v1",
  learningLog: "pbp:learningLog:v1",
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or quota-exceeded — persistence is best-effort, the
    // app must keep working without it.
  }
}

export function getFaceTags(): Map<string, string> {
  const list = readJson<FaceTagEntry[]>(KEYS.faceTags, []);
  return new Map(list.map((e) => [e.photoKey, e.label]));
}

export function setFaceTag(key: string, label: string): void {
  const map = getFaceTags();
  map.set(key, label);
  const list: FaceTagEntry[] = Array.from(map.entries()).map(([photoKey, label]) => ({ photoKey, label }));
  writeJson(KEYS.faceTags, list);
}

export function getGlarePrefs(): Map<string, GlarePref> {
  const list = readJson<GlarePref[]>(KEYS.glarePrefs, []);
  return new Map(list.map((e) => [e.photoKey, e]));
}

export function setGlarePref(pref: GlarePref): void {
  const map = getGlarePrefs();
  map.set(pref.photoKey, pref);
  writeJson(KEYS.glarePrefs, Array.from(map.values()));
}

export function getFramePrefs(): Map<string, FramePref> {
  const list = readJson<FramePref[]>(KEYS.framePrefs, []);
  return new Map(list.map((e) => [e.photoKey, e]));
}

export function setFramePref(pref: FramePref): void {
  const map = getFramePrefs();
  map.set(pref.photoKey, pref);
  writeJson(KEYS.framePrefs, Array.from(map.values()));
}

export function getRotatePrefs(): Map<string, RotatePref> {
  const list = readJson<RotatePref[]>(KEYS.rotatePrefs, []);
  return new Map(list.map((e) => [e.photoKey, e]));
}

export function setRotatePref(pref: RotatePref): void {
  const map = getRotatePrefs();
  map.set(pref.photoKey, pref);
  writeJson(KEYS.rotatePrefs, Array.from(map.values()));
}

export function getLearningLogRaw(): unknown[] {
  return readJson<unknown[]>(KEYS.learningLog, []);
}

export function setLearningLogRaw(entries: unknown[]): void {
  writeJson(KEYS.learningLog, entries);
}

// Merges a decoded share-link payload into local persistence. Local
// preferences win on conflict — a share link should add context for photos
// the recipient hasn't seen before, not clobber choices they've already made.
export function mergeFromShareLink(payload: AlbumStatePayload): void {
  const tags = getFaceTags();
  for (const e of payload.faceTags) {
    if (!tags.has(e.photoKey)) tags.set(e.photoKey, e.label);
  }
  writeJson(KEYS.faceTags, Array.from(tags.entries()).map(([photoKey, label]) => ({ photoKey, label })));

  const glare = getGlarePrefs();
  for (const e of payload.glarePrefs) {
    if (!glare.has(e.photoKey)) glare.set(e.photoKey, e);
  }
  writeJson(KEYS.glarePrefs, Array.from(glare.values()));

  const frame = getFramePrefs();
  for (const e of payload.framePrefs) {
    if (!frame.has(e.photoKey)) frame.set(e.photoKey, e);
  }
  writeJson(KEYS.framePrefs, Array.from(frame.values()));

  const rotate = getRotatePrefs();
  for (const e of payload.rotatePrefs) {
    if (!rotate.has(e.photoKey)) rotate.set(e.photoKey, e);
  }
  writeJson(KEYS.rotatePrefs, Array.from(rotate.values()));
}
