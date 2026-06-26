import { EXT_TO_MIME, IntakeFile, SkippedFile } from "./types";

export const SOFT_CAP = 5000;

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function relativePathOf(file: File): string {
  const anyFile = file as File & { webkitRelativePath?: string };
  return anyFile.webkitRelativePath && anyFile.webkitRelativePath.length > 0
    ? anyFile.webkitRelativePath
    : file.name;
}

export function classifyFiles(files: File[]): {
  accepted: IntakeFile[];
  skipped: SkippedFile[];
} {
  const accepted: IntakeFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const relativePath = relativePathOf(file);
    const ext = extOf(file.name);
    const mime = EXT_TO_MIME[ext];

    if (!mime) {
      skipped.push({ relativePath, reason: "unsupported-type", detail: ext || "(no extension)" });
      continue;
    }
    if (file.size === 0) {
      skipped.push({ relativePath, reason: "empty-file" });
      continue;
    }
    // Chromium's canvas size cap is roughly 268M pixels / ~16384px per side.
    // A 200MB+ single file is almost certainly not going to decode usefully
    // even if it's nominally a supported extension — flag instead of hanging.
    if (file.size > 200 * 1024 * 1024) {
      skipped.push({ relativePath, reason: "too-large", detail: `${Math.round(file.size / 1024 / 1024)}MB` });
      continue;
    }

    accepted.push({
      id: crypto.randomUUID(),
      file,
      relativePath,
      mime,
    });
  }

  return { accepted, skipped };
}

// Recursively walks a dropped DataTransferItemList (folders give directory
// entries via webkitGetAsEntry, not a flat FileList) into a flat File[].
export async function filesFromDataTransfer(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = [];

  async function walk(entry: any, path: string): Promise<void> {
    if (entry.isFile) {
      const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
      // Patch a relativePath-like property since dropped-file entries don't
      // populate webkitRelativePath the way a directory <input> does.
      try {
        Object.defineProperty(file, "webkitRelativePath", {
          value: path + file.name,
          configurable: true,
        });
      } catch {
        // ignore if the browser won't let us redefine it
      }
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries: any[] = await new Promise((resolve, reject) => {
        const all: any[] = [];
        function readBatch() {
          reader.readEntries((batch: any[]) => {
            if (batch.length === 0) {
              resolve(all);
            } else {
              all.push(...batch);
              readBatch();
            }
          }, reject);
        }
        readBatch();
      });
      for (const child of entries) {
        await walk(child, path + entry.name + "/");
      }
    }
  }

  const roots: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }

  if (roots.length === 0) {
    // Fallback: plain file drop, no directory entries available at all.
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile?.();
      if (file) out.push(file);
    }
    return out;
  }

  for (const root of roots) {
    await walk(root, "");
  }
  return out;
}
