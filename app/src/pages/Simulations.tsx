import type { Scenario } from '@syntro/engine';
import { Play, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtPct, relTime } from '@/lib/format.ts';
import { ProjectPicker, useActiveProject } from '@/components/ProjectPicker.tsx';
import { describeFault } from './ProjectDetail.tsx';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorBanner, Field, InfoBanner, Input, PageHeader, ProgressBar, Select, StatusPill, Table, Td, Th, Toggle } from '@/components/ui.tsx';

export default function Simulations() {
  const { client } = useEngine();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { projects, project, setProjectId } = useActiveProject();
  const preselectProject = params.get('project');
  useEffect(() => {
    if (preselectProject) setProjectId(preselectProject);
  }, [preselectProject, setProjectId]);

  const { data: scenarios } = useAsync(() => (project ? client.listScenarios(project.id) : Promise.resolve([])), [client, project?.id]);
  const { data: runs, reload: reloadRuns } = useAsync(() => (project ? client.listRuns(project.id) : Promise.resolve([])), [client, project?.id], { poll: 2000 });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [concurrency, setConcurrency] = useState(3);
  const [resetDemoSut, setResetDemoSut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Preselection from query params or the investor demo preset.
  useEffect(() => {
    if (!scenarios) return;
    const preset = params.get('preset');
    const scenarioId = params.get('scenario');
    if (preset === 'demo') {
      applyDemoPreset(scenarios);
      setResetDemoSut(true);
    } else if (scenarioId) {
      const s = scenarios.find((x) => x.id === scenarioId);
      if (s) setCounts({ [s.id]: s.defaultCustomerCount });
    } else if (Object.keys(counts).length === 0 && scenarios[0]) {
      setCounts({ [scenarios[0].id]: scenarios[0].defaultCustomerCount });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios]);

  const applyDemoPreset = (list: Scenario[]) => {
    const happy = list.find((s) => s.templateKey === 'happy_path_multitouch');
    const cross = list.find((s) => s.templateKey === 'cross_device_login');
    const next: Record<string, number> = {};
    if (happy) next[happy.id] = 9;
    if (cross) next[cross.id] = 1;
    setCounts(next);
    setName('Investor demo');
  };

  const total = useMemo(() => Object.values(counts).reduce((s, n) => s + (n > 0 ? n : 0), 0), [counts]);

  const launch = async () => {
    if (!project) return;
    setLaunching(true);
    setError(null);
    try {
      if (resetDemoSut) await client.updateProject(project.id, { sut: { identityResolution: 'cookie_only' } });
      const assignments = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([scenarioId, customerCount]) => ({ scenarioId, customerCount }));
      const run = await client.startSimulation({ projectId: project.id, name: name || undefined, assignments, concurrency });
      navigate(`/simulations/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <>
      <PageHeader title="Simulation Control Centre" subtitle="Select scenarios, choose how many synthetic customers to generate, launch, and monitor real execution." actions={projects.length > 0 && project && <ProjectPicker projects={projects} value={project.id} onChange={setProjectId} />} />
      {!project && <EmptyState title="Create a project first" action={<Button onClick={() => navigate('/projects')}>Go to projects</Button>} />}
      {project && (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardTitle
              hint="Each scenario runs its journey for the chosen number of synthetic customers."
              actions={
                <Button size="sm" variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={() => scenarios && applyDemoPreset(scenarios)}>
                  Investor demo preset
                </Button>
              }
            >
              Scenarios
            </CardTitle>
            <ErrorBanner message={error} />
            {scenarios && scenarios.length === 0 && <InfoBanner tone="warning">This project has no scenarios yet. <Link className="underline" to={`/projects/${project.id}`}>Add preconfigured scenarios</Link>.</InfoBanner>}
            <div className="divide-y divide-slate-100">
              {scenarios?.map((s) => {
                const n = counts[s.id] ?? 0;
                return (
                  <div key={s.id} className="flex items-center gap-4 py-3">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={n > 0} onChange={(e) => setCounts({ ...counts, [s.id]: e.target.checked ? s.defaultCustomerCount : 0 })} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">{s.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span className="truncate">{s.description}</span>
                        {s.faults.map((f, i) => (
                          <Badge key={i} tone="warning">
                            {describeFault(f)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">customers</span>
                      <Input type="number" min={0} max={100} className="w-20" value={n} onChange={(e) => setCounts({ ...counts, [s.id]: Math.max(0, Math.min(100, Number(e.target.value))) })} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardTitle>Launch</CardTitle>
              <div className="space-y-4">
                <Field label="Run name" hint="optional"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pre-launch regression" /></Field>
                <Field label="Parallel browsers">
                  <Select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
                {project.id === 'proj_demo_aurora' && <Toggle checked={resetDemoSut} onChange={setResetDemoSut} label="Start from the enterprise's original attribution setup" hint="Sets the system under test back to cookie-only identity resolution — the configuration the team believes is correct." />}
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Synthetic customers</span>
                    <span className={total > 100 ? 'font-semibold text-rose-600' : 'font-semibold text-slate-900'}>{total} / 100</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-slate-600">Scenarios</span>
                    <span className="font-semibold text-slate-900">{Object.values(counts).filter((n) => n > 0).length}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-slate-600">Attribution system</span>
                    <span className="font-semibold text-slate-900">{resetDemoSut ? 'cookie only' : project.sut.identityResolution.replace(/_/g, ' ')} · {project.sut.lookbackDays}d</span>
                  </div>
                </div>
                <Button className="w-full" size="lg" icon={<Play className="h-4 w-4" />} onClick={launch} loading={launching} disabled={total < 1 || total > 100}>
                  Launch simulation
                </Button>
                <p className="text-[11px] text-slate-500">Journeys execute in real {client.mode === 'remote' ? 'headless Chromium browsers (Playwright)' : 'sandboxed browser frames in this tab'}. Progress below reflects actual execution.</p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {project && runs && (
        <Card className="mt-6" padded={false}>
          <div className="px-5 pt-5">
            <CardTitle hint="Live status of every run in this project">Simulation runs</CardTitle>
          </div>
          {runs.length === 0 && <div className="px-5 pb-6 text-sm text-slate-500">No runs yet.</div>}
          {runs.length > 0 && (
            <Table className="rounded-t-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th className="w-56">Progress</Th>
                  <Th>Passed / failed</Th>
                  <Th>Accuracy</Th>
                  <Th>Started</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const done = r.progress.completed + r.progress.failed + r.progress.stopped;
                  const active = ['queued', 'running', 'finalizing'].includes(r.status);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <Td>
                        <Link to={`/simulations/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {r.name}
                        </Link>
                        {r.parentRunId && <div className="text-[11px] text-slate-400">re-run · {r.rerunMode === 'failed_only' ? 'failed scenarios' : 'all'}</div>}
                      </Td>
                      <Td><StatusPill status={r.status} pulse /></Td>
                      <Td>
                        <ProgressBar value={done} max={r.progress.total} tone={r.progress.failed ? 'danger' : active ? 'brand' : 'success'} />
                        <div className="mt-1 text-[11px] text-slate-500">{done}/{r.progress.total} customers · {r.progress.running} running</div>
                      </Td>
                      <Td><span className="text-emerald-600">{r.summary?.passed ?? '—'}</span> / <span className="text-rose-600">{r.summary?.failed ?? '—'}</span></Td>
                      <Td>{fmtPct(r.summary?.attributionAccuracy)}</Td>
                      <Td className="text-slate-500">{relTime(r.startedAt ?? r.createdAt)}</Td>
                      <Td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {active && (
                            <Button size="sm" variant="ghost" icon={<Square className="h-3.5 w-3.5" />} onClick={async () => { await client.stopRun(r.id); await reloadRuns(); }}>
                              Stop
                            </Button>
                          )}
                          {!active && (
                            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={async () => { const run = await client.rerun(r.id, { mode: 'all' }); navigate(`/simulations/${run.id}`); }}>
                              Re-run
                            </Button>
                          )}
                          {r.summary && (
                            <Link to={`/results/${r.id}`} className="rounded-xl px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50">
                              Results
                            </Link>
                          )}
                          {!active && (
                            <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (confirm('Delete this run and its data?')) { await client.deleteRun(r.id); await reloadRuns(); } }}>
                              <Trash2 className="h-4 w-4 text-slate-400" />
                            </Button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
