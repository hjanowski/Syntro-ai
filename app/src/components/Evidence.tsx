import { FAILURE_LABELS, POINT_LABELS, type Evidence, type FailureDiagnostic, type TestResult } from '@syntro/engine';
import { ChevronDown, ChevronRight, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { fmtClock } from '@/lib/format.ts';
import { Badge, JsonBlock, Modal, StatusPill, cn } from './ui.tsx';

const KIND_LABEL: Record<Evidence['kind'], string> = {
  screenshot: 'Screenshot',
  dom_snapshot: 'DOM snapshot',
  url: 'URL',
  log: 'Log',
  collected_event: 'Collected event',
  ledger: 'Ground truth',
  attribution_result: 'Attribution result',
  platform_record: 'Platform record',
  fault_injection: 'Fault injection',
  configuration: 'Configuration',
};

const KIND_TONE: Record<Evidence['kind'], 'neutral' | 'brand' | 'info' | 'warning' | 'violet' | 'success'> = {
  screenshot: 'brand',
  dom_snapshot: 'neutral',
  url: 'neutral',
  log: 'neutral',
  collected_event: 'info',
  ledger: 'success',
  attribution_result: 'violet',
  platform_record: 'info',
  fault_injection: 'warning',
  configuration: 'neutral',
};

export function EvidenceList({ evidence, compact }: { evidence: Evidence[]; compact?: boolean }) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (!evidence.length) return <p className="text-xs text-slate-400">No evidence captured.</p>;
  return (
    <div className={cn('space-y-2', compact && 'space-y-1.5')}>
      {evidence.map((ev, i) => (
        <EvidenceItem key={i} evidence={ev} onZoom={setZoom} compact={compact} />
      ))}
      <Modal open={!!zoom} onClose={() => setZoom(null)} title="Screenshot evidence" width="max-w-4xl">
        {zoom && <img src={zoom} alt="Screenshot evidence" className="w-full rounded-xl border border-slate-200" />}
      </Modal>
    </div>
  );
}

function EvidenceItem({ evidence, onZoom, compact }: { evidence: Evidence; onZoom: (src: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(evidence.kind === 'screenshot' || evidence.kind === 'dom_snapshot');
  const body = () => {
    switch (evidence.kind) {
      case 'screenshot':
        return (
          <button onClick={() => onZoom(String(evidence.data))} className="group relative block overflow-hidden rounded-lg border border-slate-200">
            <img src={String(evidence.data)} alt={evidence.label} className="max-h-56 w-auto object-cover" />
            <span className="absolute bottom-2 right-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100">Click to enlarge</span>
          </button>
        );
      case 'dom_snapshot': {
        const d = evidence.data as { title?: string; text?: string };
        return (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {d?.title && <div className="mb-1 font-semibold text-slate-800">{d.title}</div>}
            <p className="line-clamp-4 leading-relaxed">{d?.text || '—'}</p>
          </div>
        );
      }
      case 'url':
        return (
          <a href={String(evidence.data)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-xs text-brand-600 hover:underline">
            {String(evidence.data)} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      default:
        return <JsonBlock value={evidence.data ?? { ref: evidence.ref }} />;
    }
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        {evidence.kind === 'screenshot' && <ImageIcon className="h-3.5 w-3.5 text-brand-500" />}
        <span className={cn('flex-1 truncate font-medium text-slate-800', compact ? 'text-xs' : 'text-sm')}>{evidence.label}</span>
        <Badge tone={KIND_TONE[evidence.kind]}>{KIND_LABEL[evidence.kind]}</Badge>
        {evidence.ts && <span className="text-[11px] tabular-nums text-slate-400">{fmtClock(evidence.ts)}</span>}
      </button>
      {open && <div className="px-3 pb-3">{body()}</div>}
    </div>
  );
}

export function FailureDiagnosticView({ failure, test }: { failure: FailureDiagnostic; test?: TestResult }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">{FAILURE_LABELS[failure.type]}</Badge>
        <span className="text-xs text-slate-500">Suspected point of failure:</span>
        <Badge tone="warning">{POINT_LABELS[failure.suspectedPointOfFailure]}</Badge>
      </div>
      {test && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Expected</div>
            <div className="text-sm text-emerald-900">{String(test.expected)}</div>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-rose-700">Observed</div>
            <div className="text-sm text-rose-900">{String(test.observed)}</div>
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">What happened</div>
        <p className="text-sm leading-relaxed text-slate-700">{failure.explanation}</p>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Recommended troubleshooting</div>
        <ol className="space-y-1.5 text-sm text-slate-700">
          {failure.recommendedSteps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Evidence ({failure.evidence.length})</div>
        <EvidenceList evidence={failure.evidence} compact />
      </div>
    </div>
  );
}

export function TestRow({ test, onOpen }: { test: TestResult; onOpen?: () => void }) {
  return (
    <button onClick={onOpen} className={cn('flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition', test.status === 'fail' ? 'border-rose-200 bg-rose-50/40 hover:bg-rose-50' : test.status === 'inconclusive' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white hover:bg-slate-50', !onOpen && 'cursor-default')}>
      <StatusPill status={test.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800">{test.name}</div>
        <div className="truncate text-xs text-slate-500">{test.summary}</div>
      </div>
      {test.failure && <Badge tone="danger">{FAILURE_LABELS[test.failure.type]}</Badge>}
    </button>
  );
}
