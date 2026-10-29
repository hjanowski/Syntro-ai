import { FAILURE_LABELS, type FailureType } from '@syntro/engine';
import { ArrowRight, Sparkles, Target, Users, Activity, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtPct, fmtNumber, relTime } from '@/lib/format.ts';
import { HorizontalBars, TrendChart } from '@/components/charts.tsx';
import { Button, Card, CardTitle, ErrorBanner, Loading, PageHeader, StatTile, StatusPill, Table, Td, Th } from '@/components/ui.tsx';

export default function Overview() {
  const { client, info } = useEngine();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => client.overview(), [client], { poll: 4000 });
  const [seeding, setSeeding] = useState(false);

  const seedDemo = async () => {
    setSeeding(true);
    try {
      const project = await client.ensureDemoProject();
      await reload();
      navigate(`/simulations?project=${project.id}&preset=demo`);
    } finally {
      setSeeding(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner message={error} />;

  if (data.projects === 0) {
    return (
      <div className="bg-hero-gradient -mx-4 -mt-6 rounded-b-3xl px-6 py-16 sm:-mx-6 lg:-mx-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-2xl font-black text-white shadow-pop">S</div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Your attribution may look right.<br />Syntro proves whether it actually is.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600">
            Syntro creates synthetic customers, runs them through real marketing touchpoints and your instrumented website, then verifies — against an independent ground truth — that your tracking, identity resolution and attribution produced the right answer.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" icon={<Sparkles className="h-4 w-4" />} loading={seeding} onClick={seedDemo}>
              Set up the Aurora Supply Co. demo
            </Button>
            <Button size="lg" variant="secondary" onClick={() => navigate('/projects')}>
              Create a project
            </Button>
          </div>
          <p className="mt-6 text-xs text-slate-500">
            Engine: {info?.host === 'browser' ? 'running in this browser tab (sandboxed-iframe execution)' : `Node host · ${info?.driver}`}. Every result you will see comes from actual execution.
          </p>
        </div>
      </div>
    );
  }

  const issues = data.commonIssues.map((i) => ({ label: FAILURE_LABELS[i.type as FailureType] ?? i.type, value: i.count, color: '#f43f5e' }));

  return (
    <>
      <PageHeader title="Overview" subtitle="Attribution quality across every project and simulation run." actions={<Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={seeding} onClick={seedDemo}>Run the investor demo</Button>} />
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Projects" value={fmtNumber(data.projects)} hint={`${fmtNumber(data.runs)} simulations run`} icon={<Target className="h-5 w-5" />} />
        <StatTile label="Customers simulated" value={fmtNumber(data.customersSimulated)} hint="real browser journeys" icon={<Users className="h-5 w-5" />} />
        <StatTile label="Attribution accuracy" value={fmtPct(data.attributionAccuracy)} tone={data.attributionAccuracy == null ? 'neutral' : data.attributionAccuracy >= 0.95 ? 'success' : data.attributionAccuracy >= 0.8 ? 'warning' : 'danger'} hint="attribution tests passed" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatTile label="Scenarios passed / failed" value={<span>{fmtNumber(data.testsPassed)} <span className="text-slate-300">/</span> <span className="text-rose-600">{fmtNumber(data.testsFailed)}</span></span>} hint={`${fmtNumber(data.testsInconclusive)} inconclusive`} icon={<Activity className="h-5 w-5" />} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle hint="Tests passed/failed per run with attribution accuracy">Testing trends</CardTitle>
          <TrendChart data={data.trend.map((t) => ({ name: t.runName, accuracy: t.attributionAccuracy, passed: t.passed, failed: t.failed }))} />
        </Card>
        <Card>
          <CardTitle hint="Across all completed runs">Most common tracking issues</CardTitle>
          <HorizontalBars data={issues} emptyLabel="No failures detected yet — run a scenario with fault injection to see diagnostics." />
        </Card>
      </div>

      <Card className="mt-6" padded={false}>
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-sm font-semibold text-slate-900">Recent simulations</h2>
          <Link to="/simulations" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            Simulation control <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="mt-3">
          <Table className="rounded-t-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Status</Th>
                <Th>Customers</Th>
                <Th>Passed</Th>
                <Th>Failed</Th>
                <Th>Accuracy</Th>
                <Th>When</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.recentRuns.length === 0 && (
                <tr>
                  <Td colSpan={8} className="text-center text-slate-400">
                    No simulations yet.
                  </Td>
                </tr>
              )}
              {data.recentRuns.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <Td className="font-medium text-slate-900">{r.name}</Td>
                  <Td>
                    <StatusPill status={r.status} pulse />
                  </Td>
                  <Td>{r.progress.total}</Td>
                  <Td className="text-emerald-600">{r.summary?.passed ?? '—'}</Td>
                  <Td className="text-rose-600">{r.summary?.failed ?? '—'}</Td>
                  <Td>{fmtPct(r.summary?.attributionAccuracy)}</Td>
                  <Td className="text-slate-500">{relTime(r.finishedAt ?? r.createdAt)}</Td>
                  <Td className="text-right">
                    <Link to={r.summary ? `/results/${r.id}` : `/simulations/${r.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                      {r.summary ? 'Results' : 'Open'}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </>
  );
}
