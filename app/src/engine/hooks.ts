import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

/** Minimal data hook: runs `fn` when deps change; optional polling interval in ms (0 = off). */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, opts: { poll?: number; enabled?: boolean } = {}): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabled = opts.enabled ?? true;

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  useEffect(() => {
    if (!opts.poll || !enabled) return;
    const id = window.setInterval(() => void reload(), opts.poll);
    return () => window.clearInterval(id);
  }, [opts.poll, reload, enabled]);

  return { data, error, loading, reload, setData: (u) => setData((prev) => (typeof u === 'function' ? (u as (p: T | null) => T | null)(prev) : u)) };
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set];
}
