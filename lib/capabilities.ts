export function supportsOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== "undefined";
}

export function supportsWorkers(): boolean {
  return typeof Worker !== "undefined";
}

export function supportsFileSystemAccessWrite(): boolean {
  return typeof (window as any).showSaveFilePicker === "function";
}

export function defaultWorkerPoolSize(): number {
  const deviceMemory = (navigator as any).deviceMemory as number | undefined;
  const cores = navigator.hardwareConcurrency || 4;
  if (deviceMemory && deviceMemory <= 4) return 2;
  return Math.max(1, Math.min(4, cores));
}
