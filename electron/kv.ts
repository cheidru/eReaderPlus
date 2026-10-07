import { app } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Small JSON key-value store: one file per key in userData/kv. */
function fileFor(key: string): string {
  return path.join(app.getPath('userData'), 'kv', `${encodeURIComponent(key)}.json`);
}

/** Writes are serialized per key so a slow earlier write can never overwrite a newer one. */
const queues = new Map<string, Promise<void>>();
let tmpCounter = 0;

export async function kvGet(key: string): Promise<unknown> {
  await queues.get(key);
  try {
    return JSON.parse(await readFile(fileFor(key), 'utf8'));
  } catch {
    return null;
  }
}

export function kvSet(key: string, value: unknown): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => write(key, value));
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

async function write(key: string, value: unknown): Promise<void> {
  const file = fileFor(key);
  if (value === null || value === undefined) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await renameWithRetry(tmp, file);
}

/** On Windows, replacing a file that a scanner or reader briefly holds open fails with EPERM/EBUSY. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await rm(from, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}
