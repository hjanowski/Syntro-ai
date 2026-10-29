import { ChevronDown, ChevronUp, MonitorSmartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { browserHost, type LiveContext } from '@/engine/iframe-driver.ts';
import { useEngine } from '@/engine/provider.tsx';
import { cn } from './ui.tsx';

/**
 * Live synthetic browsers. In browser-hosted mode the iframe driver mounts one sandboxed frame per
 * synthetic customer into this dock, so the audience can watch real pages being driven. The host
 * element is created once and never re-parented (moving an iframe would reload it).
 */
export function LiveDock() {
  const { client } = useEngine();
  const hostRef = useRef<HTMLDivElement>(null);
  const [contexts, setContexts] = useState<LiveContext[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [everActive, setEverActive] = useState(false);

  useEffect(() => {
    browserHost.attach(hostRef.current);
    const unsub = browserHost.subscribe(() => {
      const list = browserHost.list();
      setContexts(list);
      if (list.length) setEverActive(true);
    });
    return () => {
      unsub();
      browserHost.attach(null);
    };
  }, []);

  const embedded = client.mode === 'embedded';
  const visible = embedded && (contexts.length > 0 || everActive);

  return (
    <div className={cn('fixed bottom-4 right-4 z-30 w-[min(100vw-2rem,780px)] rounded-2xl border border-slate-200 bg-white/95 shadow-pop backdrop-blur transition-all', visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0')}>
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MonitorSmartphone className="h-4 w-4 text-brand-600" />
          Live synthetic browsers
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', contexts.length ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{contexts.length ? `${contexts.length} active` : 'idle'}</span>
        </div>
        <button onClick={() => setCollapsed((c) => !c)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      <div className={cn('scrollbar-thin overflow-x-auto px-4 pb-4', collapsed && 'hidden')}>
        <div ref={hostRef} className="flex min-h-[176px] items-start gap-4" />
        <p className="mt-2 text-[11px] text-slate-400">Each tile is an isolated sandboxed frame driven by the engine. Pages, clicks and events are real; nothing is animated.</p>
      </div>
    </div>
  );
}
