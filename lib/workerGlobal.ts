// tsconfig intentionally omits the "webworker" lib (it conflicts with "dom"),
// so DedicatedWorkerGlobalScope isn't declared. This minimal interface gives
// worker files just the surface they need, via a local cast on `self`.
export interface WorkerGlobal {
  postMessage(message: any, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => any) | null;
  onerror: ((ev: ErrorEvent) => any) | null;
}

export function getWorkerSelf(): WorkerGlobal {
  return self as unknown as WorkerGlobal;
}
