import { IntakeFile, ScanResult, ScanFailure, ScanRequest, ScanResponse } from "./types";
import { WorkerPool } from "./workerPool";
import { prepareSourceForWorker } from "./imageDecode";

export const THUMBNAIL_SIZE = 160;
export const SCAN_CHUNK_SIZE = 250;

// Chunked dispatch on top of the bounded WorkerPool — bounds in-flight
// promises and gives clean progress checkpoints at 5,000-file scale.
export async function runScanPipeline(
  files: IntakeFile[],
  pool: WorkerPool<ScanRequest, ScanResponse>,
  onProgress: (completed: number, total: number, currentName: string) => void
): Promise<{ results: ScanResult[]; failures: ScanFailure[] }> {
  const results: ScanResult[] = [];
  const failures: ScanFailure[] = [];
  let completed = 0;

  for (let start = 0; start < files.length; start += SCAN_CHUNK_SIZE) {
    const chunk = files.slice(start, start + SCAN_CHUNK_SIZE);
    const settled = await Promise.all(
      chunk.map(async (f): Promise<ScanResponse> => {
        try {
          const { blob, mime } = await prepareSourceForWorker(f.id, f.file, f.mime);
          const req: ScanRequest = { id: f.id, file: blob, mime, thumbnailSize: THUMBNAIL_SIZE };
          const res = await pool.run(req);
          completed++;
          onProgress(completed, files.length, f.relativePath);
          return res;
        } catch (err) {
          completed++;
          onProgress(completed, files.length, f.relativePath);
          return { id: f.id, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
    for (const res of settled) {
      if (res.ok) {
        results.push({
          id: res.id,
          hashHi: res.hashHi,
          hashLo: res.hashLo,
          width: res.width,
          height: res.height,
          thumbnailBlob: res.thumbnailBlob,
        });
      } else {
        failures.push({ id: res.id, error: res.error });
      }
    }
  }

  return { results, failures };
}
