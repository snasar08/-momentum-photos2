import { IntakeFile, CropConfig, ExportRequest, ExportResponse, ScanResult } from "./types";
import { WorkerPool } from "./workerPool";
import { prepareSourceForWorker } from "./imageDecode";
import { ZipEntryInput } from "./zipExport";
import { photoKey, getGlarePrefs, getFramePrefs, getRotatePrefs } from "./persistence";
import { GLARE_FILTER_VARIANTS } from "./glare";

export const EXPORT_CHUNK_SIZE = 250;

interface SettledExport {
  ok: boolean;
  name: string;
  blob?: Blob;
  error?: string;
}

// Async generator so client-zip can stream entries into the archive as each
// chunk finishes, instead of buffering all encoded photos in memory first.
export async function* runExportPipeline(
  files: IntakeFile[],
  cropConfig: CropConfig,
  scanResults: Map<string, ScanResult>,
  pool: WorkerPool<ExportRequest, ExportResponse>,
  onProgress: (completed: number, total: number, currentName: string) => void,
  onError: (name: string, error: string) => void
): AsyncGenerator<ZipEntryInput> {
  let completed = 0;
  // Read persisted glare/frame preferences once, up front — they only
  // change via UI in earlier wizard steps, not mid-export.
  const glarePrefs = getGlarePrefs();
  const framePrefs = getFramePrefs();
  const rotatePrefs = getRotatePrefs();

  for (let start = 0; start < files.length; start += EXPORT_CHUNK_SIZE) {
    const chunk = files.slice(start, start + EXPORT_CHUNK_SIZE);
    const settled = await Promise.all(
      chunk.map(async (f): Promise<SettledExport> => {
        const baseName = f.relativePath.split("/").pop() || f.file.name;
        try {
          const { blob, mime } = await prepareSourceForWorker(f.id, f.file, f.mime);

          // Look up this photo's glare/frame preferences by content-derived
          // key. A file with no matching ScanResult (shouldn't happen post
          // review/enhance, but isn't worth crashing the export over) just
          // falls back to no filter / no frame crop.
          let filterCss: string | undefined;
          let frameRectNorm: ExportRequest["frameRectNorm"];
          let applyAutoRotate: boolean | undefined;
          let exifOrientation: number | undefined;
          const scan = scanResults.get(f.id);
          if (scan) {
            const key = photoKey(scan);
            const glarePref = glarePrefs.get(key);
            if (glarePref && glarePref.filterIndex > 0) {
              filterCss = GLARE_FILTER_VARIANTS[glarePref.filterIndex];
            }
            const framePref = framePrefs.get(key);
            if (framePref && framePref.enabled && framePref.frameRectNorm) {
              frameRectNorm = framePref.frameRectNorm;
            }
            const rotatePref = rotatePrefs.get(key);
            if (rotatePref && !rotatePref.applyAutoRotate) {
              applyAutoRotate = false;
              exifOrientation = rotatePref.exifOrientation;
              // The frame rect was detected against the thumbnail's
              // auto-rotated (width/height-swapped, for orientation 6/8)
              // dimensions. Opting out of auto-rotation for those two
              // orientations makes that rect invalid against the unrotated
              // bitmap, so drop it rather than export a misplaced crop.
              // Orientation 3 (180°) doesn't swap dimensions, so it's fine.
              if (rotatePref.exifOrientation === 6 || rotatePref.exifOrientation === 8) {
                frameRectNorm = undefined;
              }
            }
          }

          const req: ExportRequest = {
            id: f.id,
            file: blob,
            mime,
            originalName: baseName,
            aspectW: cropConfig.aspectW as number,
            aspectH: cropConfig.aspectH as number,
            maxDimension: cropConfig.maxDimension,
            quality: cropConfig.quality,
            filterCss,
            frameRectNorm,
            applyAutoRotate,
            exifOrientation,
          };
          const res = await pool.run(req);
          completed++;
          onProgress(completed, files.length, baseName);
          if (res.ok) return { ok: true, name: res.filename, blob: res.blob };
          return { ok: false, name: baseName, error: res.error };
        } catch (err) {
          completed++;
          onProgress(completed, files.length, baseName);
          return { ok: false, name: baseName, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );

    for (const item of settled) {
      if (item.ok && item.blob) {
        yield { name: item.name, input: item.blob };
      } else {
        onError(item.name, item.error ?? "unknown error");
      }
    }
  }
}
