import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EngineInfo } from '@syntro/engine';
import type { EngineClient } from './client.ts';
import { HttpEngineClient } from './http-client.ts';
import { EmbeddedEngineClient } from './embedded-client.ts';
import { getEmbeddedEngine } from './embedded-engine.ts';

export type EnginePreference = { mode: 'auto' | 'embedded' | 'remote'; url: string };

const PREF_KEY = 'syntro.engine.pref.v1';

export function readPreference(): EnginePreference {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { mode: 'auto', url: '', ...(JSON.parse(raw) as Partial<EnginePreference>) };
  } catch {
    /* ignore */
  }
  return { mode: 'auto', url: '' };
}

export function writePreference(pref: EnginePreference): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(pref));
  } catch {
    /* ignore */
  }
}

interface EngineContextValue {
  client: EngineClient;
  info: EngineInfo | null;
  preference: EnginePreference;
  resolvedFrom: string;
  setPreference: (pref: EnginePreference) => void;
  reconnect: () => Promise<void>;
  embeddedWarning: string | null;
}

const EngineContext = createContext<EngineContextValue | null>(null);

async function probeRemote(url: string): Promise<EngineInfo | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${url}/v1/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: EngineInfo };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<EnginePreference>(() => readPreference());
  const [state, setState] = useState<{ client: EngineClient; info: EngineInfo | null; resolvedFrom: string } | null>(null);
  const [embeddedWarning, setEmbeddedWarning] = useState<string | null>(null);

  const resolve = useCallback(async (pref: EnginePreference) => {
    const sameOrigin = window.location.origin;
    const candidates = pref.mode === 'embedded' ? [] : pref.mode === 'remote' ? [pref.url || sameOrigin] : [sameOrigin];
    for (const url of candidates) {
      const info = await probeRemote(url);
      if (info) {
        setState({ client: new HttpEngineClient(url), info, resolvedFrom: `Connected to the Node engine at ${url}` });
        return;
      }
    }
    const embedded = getEmbeddedEngine();
    setEmbeddedWarning(embedded.persistenceWarning);
    const client = new EmbeddedEngineClient(embedded.service);
    const info = await client.info();
    setState({
      client,
      info,
      resolvedFrom: pref.mode === 'remote' ? `Could not reach ${pref.url || sameOrigin}; running the engine in this browser tab instead.` : 'Running the engine in this browser tab.',
    });
  }, []);

  useEffect(() => {
    void resolve(preference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<EngineContextValue | null>(() => {
    if (!state) return null;
    return {
      client: state.client,
      info: state.info,
      preference,
      resolvedFrom: state.resolvedFrom,
      embeddedWarning,
      setPreference: (pref) => {
        writePreference(pref);
        setPref(pref);
      },
      reconnect: () => resolve(readPreference()),
    };
  }, [state, preference, embeddedWarning, resolve]);

  if (!value) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <div className="h-10 w-10 rounded-xl bg-brand-gradient animate-pulse-soft" />
          <p className="text-sm">Connecting to the Syntro engine…</p>
        </div>
      </div>
    );
  }
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used inside EngineProvider');
  return ctx;
}
