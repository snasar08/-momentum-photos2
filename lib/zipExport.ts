import { downloadZip } from "client-zip";
import { supportsFileSystemAccessWrite } from "./capabilities";

export interface ZipEntryInput {
  name: string;
  input: Blob;
}

function nameDeduper(): (name: string) => string {
  const seen = new Map<string, number>();
  return (name: string) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dotIdx = name.lastIndexOf(".");
    return dotIdx <= 0
      ? `${name}-${count + 1}`
      : `${name.slice(0, dotIdx)}-${count + 1}${name.slice(dotIdx)}`;
  };
}

// Streams Blobs straight from the export pool into a zip stream — entries
// is an async generator yielding as each photo finishes, never a
// pre-built array, so client-zip can build the archive incrementally
// instead of materializing it in memory first.
export async function exportZip(
  entries: AsyncIterable<ZipEntryInput>,
  suggestedName: string
): Promise<void> {
  const resolveName = nameDeduper();

  async function* namedEntries(): AsyncGenerator<ZipEntryInput> {
    for await (const entry of entries) {
      yield { name: resolveName(entry.name), input: entry.input };
    }
  }

  const response = downloadZip(namedEntries());

  if (supportsFileSystemAccessWrite()) {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
    });
    const writable = await handle.createWritable();
    await response.body!.pipeTo(writable);
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
