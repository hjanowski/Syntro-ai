import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { COLLECTION_NAMES, type CollectionName, type MemoryStore, type StoreSnapshot } from '@syntro/engine';

/**
 * JSON-file persistence for the Node host. One file per collection, written atomically and
 * debounced. Adequate for a self-contained prototype; PostgreSQL is the production path.
 */
export async function attachJsonPersistence(store: MemoryStore, dir: string, debounceMs = 400): Promise<{ flush: () => Promise<void>; dir: string }> {
  await mkdir(dir, { recursive: true });

  const snapshot: StoreSnapshot = {};
  for (const name of COLLECTION_NAMES) {
    const file = path.join(dir, `${name}.json`);
    if (!existsSync(file)) continue;
    try {
      const raw = await readFile(file, 'utf8');
      (snapshot as Record<string, unknown>)[name] = JSON.parse(raw);
    } catch (e) {
      console.warn(`[syntro] could not load ${file}: ${(e as Error).message}`);
    }
  }
  store.load(snapshot);

  const dirty = new Set<CollectionName>();
  let timer: NodeJS.Timeout | null = null;
  let writing: Promise<void> = Promise.resolve();

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const names = Array.from(dirty);
    dirty.clear();
    writing = writing.then(async () => {
      for (const name of names) {
        const file = path.join(dir, `${name}.json`);
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(store[name].list()), 'utf8');
        await rename(tmp, file);
      }
    });
    await writing;
  };

  store.onChange((name) => {
    dirty.add(name);
    if (!timer) timer = setTimeout(() => void flush().catch((e) => console.error('[syntro] persistence error', e)), debounceMs);
  });

  return { flush, dir };
}
