// Slice-based disc reader for Node tools. Some Windows Node versions truncate openAsBlob's
// reported size for files over 4 GiB. Positional reads also keep large padded ISOs off the heap.
import { open, stat } from 'node:fs/promises';
import type { DiscSource } from '../src/importer/disc';

export async function openDiscFile(path: string): Promise<DiscSource> {
  const { size } = await stat(path);
  return {
    slice(start = 0, end = size) {
      const normalize = (n: number) => Math.min(size, Math.max(0, n < 0 ? size + n : n));
      const offset = normalize(start), length = Math.max(0, normalize(end) - offset);
      return { async arrayBuffer() {
        const file = await open(path, 'r');
        try {
          const buffer = new Uint8Array(length);
          let read = 0;
          while (read < length) {
            const result = await file.read(buffer, read, length - read, offset + read);
            if (!result.bytesRead) throw new Error(`Unexpected end of disc at ${offset + read}`);
            read += result.bytesRead;
          }
          return buffer.buffer;
        } finally { await file.close(); }
      } };
    },
  };
}
