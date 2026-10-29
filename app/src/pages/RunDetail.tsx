import { ArrowRight, RefreshCw, RotateCcw, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtClock, fmtDuration, fmtMoney, fmtPct } from '@/lib/format.ts';
import { CustomerDrawer } from '@/components/CustomerDrawer.tsx';
import { DeviceCell } from './Customers.tsx';
import { Badge, Button, Card, CardTitle, ErrorBanner, InfoBanner, Loading, PageHeader, ProgressBar, StatusPill, cn } from '@/components/ui.tsx';

export default function RunDetail() {
  const { runId = '' } = useParams();
  const { client } = useEngine();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => client.getRun(runId), [client, runId], { poll: 1000 });
  const run = data?.run;
  const active = run ? ['queued', 'running', 'finalizing'].includes(run.status) : false;
  const { data: ledgers } = useAsync(() => client.getLedger(runId), [client, runId], { poll: active ? 1500 : 6000 });
  const { data: report } = useAsync(() => client.getValidation(runId), [client, runId, run?.status], { poll: active ? 3000 : 0 });
  const { data: logs } = useAsync(() => client.getLogs(runId), [client, runId], { poll: active ? 2000 : 0 });
  const [showLogs, setShowLogs] = useState(false);

  const ledgerByCustomer = useMemo(() => new Map((ledgers ?? []).map((l) => [l.customerId, l])), [ledgers]);
  const scenarioName = (id: string) => data?.scenarios.find((s) => s.id === id)?.name ?? id;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await reload();
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading />;
  if (!data || !run) return <ErrorBanner message={error ?? 'Run not found'} />;
  const done = run.progress.completed + run.progress.failed + run.progress.stopped;

  return (
    <>
      <PageHeader
        eyebrow={<Link to={`/projects/${run.projectId}`} className="hover:underline">{data.project.name}</Link>}
        title={
          <span className="flex items-center gap-3">
            {run.name} <StatusPill status={run.status} pulse />
          </span>
        }
        subtitle={`${run.progress.total} synthetic customers · ${run.assignments.length} scenario(s) · driver ${run.driver} · seed ${run.seed} · ${run.startedAt ? `started ${fmtClock(run.startedAt)}, ${fmtDuration(run.startedAt, run.finishedAt)}` : 'queued'}`}
        actions={
          <>
            {active && (
              <Button variant="danger" icon={<Square className="h-4 w-4" />} loading={busy === 'stop'} onClick={() => act('stop', () => client.stopRun(run.id))}>
                Stop
              </Button>
            )}
            {!active && (
              <>
                <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy === 'revalidate'} onClick={() => act('revalidate', () => client.revalidate(run.id))} title="Re-run attribution and validation against the project's current attribution-system configuration, without re-executing browsers">
                  Re-validate with current config
                </Button>
                {report && report.summary.customersFailed + report.summary.customersInconclusive > 0 && (
                  <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'rerun-failed'} onClick={() => act('rerun-failed', async () => navigate(`/simulations/${(await client.rerun(run.id, { mode: 'failed_only' })).id}`))}>
                    Re-run failed scenarios
                  </Button>
                )}
                <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'rerun'} onClick={() => act('rerun', async () => navigate(`/simulations/${(await client.rerun(run.id, { mode: 'all' })).id}`))}>
                  Re-run all
                </Button>
                {report && (
                  <Button icon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate(`/results/${run.id}`)}>
                    View results
                  </Button>
                )}
              </>
            )}
          </>
        }
      />
      {run.error && <ErrorBanner message={run.error} />}
      {run.status === 'awaiting_results' && <InfoBanner tone="warning">Execution finished. The external attribution adapter has not returned results yet — provide the results document in the project settings and re-validate.</InfoBanner>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-[240px]">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Execution progress</span>
              <span className="tabular-nums text-slate-500">{done}/{run.progress.total}</span>
            </div>
            <ProgressBar value={done} max={run.progress.total} tone={run.progress.failed ? 'danger' : active ? 'brand' : 'success'} />
          </div>
          <div className="flex gap-2">
            <Chip label="Running" value={run.progress.running} tone="info" />
            <Chip label="Completed" value={run.progress.completed} tone="success" />
            <Chip label="Failed" value={run.progress.failed} tone="danger" />
            {run.progress.stopped > 0 && <Chip label="Stopped" value={run.progress.stopped} tone="warning" />}
          </div>
        </div>
        {report && (
          <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">
            <Mini label="Tests passed" value={String(report.summary.passed)} tone="text-emerald-600" />
            <Mini label="Tests failed" value={String(report.summary.failed)} tone="text-rose-600" />
            <Mini label="Inconclusive" value={String(report.summary.inconclusive)} tone="text-amber-600" />
            <Mini label="Attribution accuracy" value={fmtPct(report.summary.attributionAccuracy)} tone="text-brand-700" />
          </div>
        )}
      </Card>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-slate-500">Synthetic customers</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.customers.map((c) => {
          const ledger = ledgerByCustomer.get(c.id);
          const okSteps = ledger?.executed.filter((a) => a.status === 'ok').length ?? 0;
          const totalSteps = ledger?.intended.length ?? 0;
          const validation = report?.customers.find((v) => v.customerId === c.id);
          const conversions = ledger?.conversions ?? [];
          return (
            <button key={c.id} onClick={() => setOpen(c.id)} className={cn('rounded-2xl border bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop', validation?.status === 'fail' ? 'border-rose-200' : c.status === 'running' ? 'border-brand-200' : 'border-slate-200')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    <span className="mr-1.5 text-slate-400">#{c.index}</span>
                    {c.firstName} {c.lastName}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{scenarioName(c.scenarioId)}</div>
                </div>
                {validation ? <StatusPill status={validation.status} /> : <StatusPill status={c.status} pulse />}
              </div>
              <div className="mt-3">
                <ProgressBar value={okSteps} max={Math.max(totalSteps, 1)} tone={c.status === 'failed' ? 'danger' : c.status === 'completed' ? 'success' : 'brand'} />
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span className="truncate">{c.status === 'running' ? c.currentStep ?? 'Starting…' : c.status === 'completed' ? `${okSteps} steps executed` : c.status === 'failed' ? c.error ?? 'Failed' : c.status}</span>
                  <span className="tabular-nums">{okSteps}/{totalSteps || '…'}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <DeviceCell kind={c.device.kind} label={c.device.kind} />
                {ledger && <Badge>{ledger.touchpoints.length} touchpoints</Badge>}
                {conversions.map((cv) => (
                  <Badge key={cv.id} tone="success">
                    {cv.eventType} {fmtMoney(cv.value)}
                  </Badge>
                ))}
                {c.sessions.length > 1 && <Badge tone="violet">{c.sessions.length} sessions</Badge>}
              </div>
            </button>
          );
        })}
      </div>

      <Card className="mt-8" padded={false}>
        <button onClick={() => setShowLogs((s) => !s)} className="flex w-full items-center justify-between px-5 py-4 text-left">
          <CardTitle hint="Engine execution log (most recent last)">Execution log</CardTitle>
          <span className="text-xs text-slate-500">{logs?.length ?? 0} entries · {showLogs ? 'hide' : 'show'}</span>
        </button>
        {showLogs && (
          <div className="scrollbar-thin max-h-80 overflow-auto border-t border-slate-100 bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-200">
            {(logs ?? []).slice(-200).map((l) => (
              <div key={l.id} className={cn(l.level === 'error' ? 'text-rose-300' : l.level === 'warn' ? 'text-amber-300' : '')}>
                <span className="text-slate-500">{fmtClock(l.ts)}</span> <span className="text-slate-400">{l.customerId ? data.customers.find((c) => c.id === l.customerId)?.firstName ?? l.customerId : 'run'}</span> {l.message}
              </div>
            ))}
          </div>
        )}
      </Card>

      <CustomerDrawer customerId={open} tests={report?.customers.flatMap((c) => c.tests)} onClose={() => setOpen(null)} />
    </>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'info' | 'success' | 'danger' | 'warning' }) {
  const cls = { info: 'bg-sky-50 text-sky-700', success: 'bg-emerald-50 text-emerald-700', danger: 'bg-rose-50 text-rose-700', warning: 'bg-amber-50 text-amber-700' }[tone];
  return (
    <div className={cn('rounded-xl px-3 py-2 text-center', cls)}>
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cn('text-xl font-bold', tone)}>{value}</div>
    </div>
  );
}
