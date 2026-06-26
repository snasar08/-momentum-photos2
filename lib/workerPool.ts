interface Identified {
  id: string;
}

// Bounded-concurrency pool — the real memory-safety mechanism. At most
// `size` full-resolution images are ever decoded simultaneously, regardless
// of whether the total batch is 50 or 5,000 files.
export class WorkerPool<TReq extends Identified, TRes extends Identified> {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private pending = new Map<string, { resolve: (res: TRes) => void; reject: (err: unknown) => void }>();
  private queue: Array<{ req: TReq; transfer: Transferable[] }> = [];

  constructor(factory: () => Worker, size: number) {
    for (let i = 0; i < size; i++) {
      const worker = factory();
      worker.onmessage = (ev: MessageEvent<TRes>) => this.handleMessage(worker, ev.data);
      worker.onerror = (ev: ErrorEvent) => this.handleWorkerError(worker, ev);
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  private handleMessage(worker: Worker, data: TRes): void {
    const entry = this.pending.get(data.id);
    this.pending.delete(data.id);
    this.idleWorkers.push(worker);
    this.drainQueue();
    if (entry) entry.resolve(data);
  }

  private handleWorkerError(worker: Worker, ev: ErrorEvent): void {
    // A fatal worker error has no associated task id to resolve directly —
    // surface it on the console and free the slot so the queue keeps moving
    // instead of stalling forever waiting on this worker.
    console.error("Worker error:", ev.message);
    this.idleWorkers.push(worker);
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.idleWorkers.length > 0 && this.queue.length > 0) {
      const worker = this.idleWorkers.pop()!;
      const item = this.queue.shift()!;
      worker.postMessage(item.req, item.transfer);
    }
  }

  run(req: TReq, transfer: Transferable[] = []): Promise<TRes> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      if (this.idleWorkers.length > 0) {
        const worker = this.idleWorkers.pop()!;
        worker.postMessage(req, transfer);
      } else {
        this.queue.push({ req, transfer });
      }
    });
  }

  terminate(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.idleWorkers = [];
    this.queue = [];
    this.pending.clear();
  }
}

// Explicit outer chunking on top of the pool: bounds how many in-flight
// promises exist at once and gives clean "chunk X of Y" progress points.
export async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  processItem: (item: T) => Promise<R>,
  onItemDone?: (item: T, result: R, completed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];
  let completed = 0;
  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        const result = await processItem(item);
        completed++;
        onItemDone?.(item, result, completed, items.length);
        return result;
      })
    );
    results.push(...chunkResults);
  }
  return results;
}
