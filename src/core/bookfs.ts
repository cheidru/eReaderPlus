import type { Platform } from '../platform/platform';

/** File access scoped to one book's folder. Paths are book-root-relative. */
export interface BookFs {
  files: string[];
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
}

export function platformBookFs(platform: Platform, bookId: string, files: string[]): BookFs {
  return {
    files,
    readText: (path) => platform.readText(bookId, path),
    readBinary: (path) => platform.readBinary(bookId, path),
    writeText: (path, text) => platform.writeText(bookId, path, text),
    writeBinary: (path, data) => platform.writeBinary(bookId, path, data),
  };
}

/** In-memory BookFs, used by tests. */
export function memoryBookFs(initial: Record<string, string | Uint8Array>): BookFs & { data: Map<string, string | Uint8Array> } {
  const data = new Map(Object.entries(initial));
  const get = (path: string) => {
    const value = data.get(path);
    if (value === undefined) throw new Error(`No such file: ${path}`);
    return value;
  };
  return {
    data,
    get files() {
      return [...data.keys()];
    },
    async readText(path) {
      const v = get(path);
      return typeof v === 'string' ? v : new TextDecoder().decode(v);
    },
    async readBinary(path) {
      const v = get(path);
      return typeof v === 'string' ? new TextEncoder().encode(v) : v;
    },
    async writeText(path, text) {
      data.set(path, text);
    },
    async writeBinary(path, bytes) {
      data.set(path, bytes);
    },
  };
}
