import { FAILURE_LABELS, POINT_LABELS, type FailureType, type PointOfFailure, type TestResult } from '@syntro/engine';
import { GitCompare, RefreshCw, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtMoney, fmtPct, modelName, relTime } from '@/lib/format.ts';
import { CreditBar, CreditChips, HorizontalBars } from '@/components/charts.tsx';
import { CustomerDrawer } from '@/components/CustomerDrawer.tsx';
import { FailureDiagnosticView, TestRow } from '@/components/Evidence.tsx';
import { Badge, Button, Card, CardTitle, Drawer, EmptyState, ErrorBanner, InfoBanner, Loading, PageHeader, Segmented, Select, StatTile, StatusPill, Table, Tabs, Td, Th, cn } from '@/components/ui.tsx';

type Tab = 'failures' | 'attribution' | 'customers' | 'compare';

export default function Results() {
  const { runId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { client } = useEngine();
  const navigate = useNavigate();
  const { data: detail, error, loading } = useAsync(() => client.getRun(runId), [client, runId], { poll: 5000 });
  const { data: report, reload: reloadReport } = useAsync(() => client.getValidation(runId), [client, runId], { poll: 5000 });
  const { data: runs } = useAsync(() => (detail ? client.listRuns(detail.project.id) : Promise.resolve([])), [client, detail?.project.id]);
  const [tab, setTab] = useState<Tab>('failures');
  const [model, setModel] = useState<string>('last_touch');
  const [openTest, setOpenTest] = useState<TestResult | null>(null);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const compareWith = params.get('compare') ?? detail?.run.parentRunId ?? '';
  const { data: comparison } = useAsync(() => (compareWith && compareWith !== runId ? client.compareRuns(compareWith, runId) : Promise.resolve(null)), [client, compareWith, runId]);

  const failures = useMemo(() => (report ? report.customers.flatMap((c) => c.tests.filter((t) => t.status === 'fail').map((t) => ({ customer: c, test: t }))) : []), [report]);
  const byType = useMemo(() => Object.entries(report?.summary.failuresByType ?? {}).map(([k, v]) => ({ label: FAILURE_LABELS[k as FailureType] ?? k, value: v, color: '#f43f5e' })).sort((a, b) => b.value - a.value), [report]);
  const byPoint = useMemo(() => Object.entries(report?.summary.failuresByPoint ?? {}).map(([k, v]) => ({ label: POINT_LABELS[k as PointOfFailure] ?? k, value: v, color: '#f59e0b' })).sort((a, b) => b.value - a.value), [report]);
  const rows = useMemo(() => (report?.expectedVsActual ?? []).filter((r) => r.model === model), [report, model]);
  const models = useMemo(() => Array.from(new Set((report?.expectedVsActual ?? []).map((r) => r.model))), [report]);

  if (loading && !detail) return <Loading />;
  if (!detail) return <ErrorBanner message={error ?? 'Run not found'} />;
  const run = detail.run;

  if (!report) {
    return (
      <>
        <PageHeader eyebrow={detail.project.name} title={run.name} subtitle="Validation results are not available yet." />
        <EmptyState title={run.status === 'awaiting_results' ? 'Awaiting attribution results' : `Run is ${run.status}`} description={run.status === 'awaiting_results' ? 'Provide the external results document in the project settings, then re-validate.' : 'Results appear when execution and validation finish.'} action={<Button onClick={() => navigate(`/simulations/${run.id}`)}>Open live run</Button>} />
      </>
    );
  }
  const s = report.summary;

  return (
    <>
      <PageHeader
        eyebrow={<Link to={`/projects/${run.projectId}`} className="hover:underline">{detail.project.name}</Link>}
        title={
          <span className="flex items-center gap-3">
            {run.name} <StatusPill status={run.status} />
          </span>
        }
        subtitle={`Validated ${relTime(report.createdAt)} against ${report.adapter === 'local' ? 'the local attribution system' : `adapter "${report.adapter}"`} · identity resolution ${run.sutSnapshot.identityResolution.replace(/_/g, ' ')} · lookback ${run.sutSnapshot.lookbackDays}d · policy lookback ${run.policySnapshot.lookbackDays}d`}
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy === 'revalidate'} onClick={async () => { setBusy('revalidate'); try { await client.revalidate(run.id); await reloadReport(); } finally { setBusy(null); } }}>
              Re-validate with current config
            </Button>
            {s.customersFailed + s.customersInconclusive > 0 && (
              <Button icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'rerun'} onClick={async () => { setBusy('rerun'); try { const r = await client.rerun(run.id, { mode: 'failed_only' }); navigate(`/simulations/${r.id}`); } finally { setBusy(null); } }}>
                Re-run failed scenarios
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile label="Scenarios" value={s.scenarios} hint="executed" />
        <StatTile label="Customers" value={s.customers} hint={`${s.customersPassed} passed · ${s.customersFailed} failed`} />
        <StatTile label="Tests passed" value={s.passed} tone="success" />
        <StatTile label="Tests failed" value={s.failed} tone={s.failed ? 'danger' : 'neutral'} />
        <StatTile label="Inconclusive" value={s.inconclusive} tone={s.inconclusive ? 'warning' : 'neutral'} hint="could not be evaluated" />
        <StatTile label="Attribution accuracy" value={fmtPct(s.attributionAccuracy)} tone={s.attributionAccuracy == null ? 'neutral' : s.attributionAccuracy >= 0.95 ? 'success' : s.attributionAccuracy >= 0.8 ? 'warning' : 'danger'} hint={`tracking ${fmtPct(s.trackingAccuracy)}`} />
      </div>

      {s.failed === 0 && s.inconclusive === 0 && <div className="mt-5"><InfoBanner tone="success">Every test passed: the attribution system reproduced the independently computed expectations for all {s.customers} synthetic customers.</InfoBanner></div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Classified from evidence, never inferred from the injected faults alone">Failures by type</CardTitle>
          <HorizontalBars data={byType} emptyLabel="No failures." />
        </Card>
        <Card>
          <CardTitle hint="Where in the pipeline the journey most likely broke">Failures by suspected point of failure</CardTitle>
          <HorizontalBars data={byPoint} emptyLabel="No failures." />
        </Card>
      </div>

      <div className="mt-8">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'failures', label: 'Failed tests', count: failures.length },
            { value: 'attribution', label: 'Expected vs actual attribution', count: report.expectedVsActual.length },
            { value: 'customers', label: 'Customers', count: report.customers.length },
            { value: 'compare', label: 'Compare runs' },
          ]}
        />

        {tab === 'failures' && (
          <div className="space-y-2">
            {failures.length === 0 && <EmptyState title="No failed tests" description="Everything the synthetic customers did was tracked and attributed as expected." />}
            {failures.map(({ customer, test }) => (
              <div key={test.id} className="flex items-stretch gap-2">
                <button onClick={() => setOpenCustomer(customer.customerId)} className="w-44 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50">
                  <div className="truncate text-sm font-medium text-slate-800">{customer.customerName}</div>
                  <div className="truncate text-[11px] text-slate-500">{customer.scenarioName}</div>
                </button>
                <div className="min-w-0 flex-1">
                  <TestRow test={test} onOpen={() => setOpenTest(test)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'attribution' && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <Segmented value={model} onChange={setModel} items={models.map((m) => ({ value: m, label: modelName(m) }))} />
              <span className="text-xs text-slate-500">Expected = independent reference model over the ground truth ledger · Actual = attribution system under test</span>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Conversion</Th>
                  <Th>Expected</Th>
                  <Th>Actual</Th>
                  <Th className="w-40">Credit split</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.customerId + r.conversionId + r.model} className={cn('hover:bg-slate-50/60', !r.match && r.status === 'fail' && 'bg-rose-50/30')}>
                    <Td>
                      <button className="font-medium text-slate-900 hover:text-brand-700" onClick={() => setOpenCustomer(r.customerId)}>
                        {r.customerName}
                      </button>
                    </Td>
                    <Td className="text-xs">{r.orderId ?? r.conversionId} · {fmtMoney(r.value)}</Td>
                    <Td><CreditChips credits={r.expected} /></Td>
                    <Td><CreditChips credits={r.actual} muted={!r.match} /></Td>
                    <Td>
                      <div className="space-y-1">
                        <CreditBar credits={r.expected} />
                        <CreditBar credits={r.actual} />
                      </div>
                    </Td>
                    <Td><StatusPill status={r.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}

        {tab === 'customers' && (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Scenario</Th>
                <Th>Tests</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {report.customers.map((c) => (
                <tr key={c.customerId} className="hover:bg-slate-50/60">
                  <Td className="font-medium text-slate-900">{c.customerName}</Td>
                  <Td className="text-xs">{c.scenarioName}</Td>
                  <Td className="text-xs">
                    <span className="text-emerald-600">{c.tests.filter((t) => t.status === 'pass').length} passed</span> · <span className="text-rose-600">{c.tests.filter((t) => t.status === 'fail').length} failed</span> · <span className="text-amber-600">{c.tests.filter((t) => t.status === 'inconclusive').length} inconclusive</span>
                  </Td>
                  <Td><StatusPill status={c.status} /></Td>
                  <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setOpenCustomer(c.customerId)}>Journey timeline</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {tab === 'compare' && (
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <GitCompare className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-600">Compare this run with</span>
              <Select className="w-auto" value={compareWith} onChange={(e) => setParams(e.target.value ? { compare: e.target.value } : {})}>
                <option value="">Select a run…</option>
                {runs?.filter((r) => r.id !== runId && r.summary).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {relTime(r.finishedAt)}
                  </option>
                ))}
              </Select>
            </div>
            {comparison && (
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Delta label="Tests passed" value={comparison.deltas.passed} good="up" />
                  <Delta label="Tests failed" value={comparison.deltas.failed} good="down" />
                  <Delta label="Inconclusive" value={comparison.deltas.inconclusive} good="down" />
                  <Delta label="Attribution accuracy" value={comparison.deltas.attributionAccuracy == null ? null : Math.round(comparison.deltas.attributionAccuracy * 100)} good="up" suffix=" pts" />
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th>Scenario</Th>
                      <Th>{comparison.baseline.run.name} (baseline)</Th>
                      <Th>{comparison.candidate.run.name} (this run)</Th>
                      <Th>Change</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.byScenario.map((row) => {
                      const improved = row.candidate.failed < row.baseline.failed;
                      const regressed = row.candidate.failed > row.baseline.failed;
                      return (
                        <tr key={row.scenarioId}>
                          <Td className="font-medium text-slate-900">{row.scenarioName}</Td>
                          <Td><span className="text-emerald-600">{row.baseline.passed} passed</span> · <span className="text-rose-600">{row.baseline.failed} failed</span></Td>
                          <Td><span className="text-emerald-600">{row.candidate.passed} passed</span> · <span className="text-rose-600">{row.candidate.failed} failed</span></Td>
                          <Td>{improved ? <Badge tone="success">improved</Badge> : regressed ? <Badge tone="danger">regressed</Badge> : <Badge>unchanged</Badge>}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                <p className="text-xs text-slate-500">Baseline SUT: {comparison.baseline.run.sutSnapshot.identityResolution.replace(/_/g, ' ')}, lookback {comparison.baseline.run.sutSnapshot.lookbackDays}d · This run: {comparison.candidate.run.sutSnapshot.identityResolution.replace(/_/g, ' ')}, lookback {comparison.candidate.run.sutSnapshot.lookbackDays}d</p>
              </div>
            )}
          </Card>
        )}
      </div>

      <Drawer open={!!openTest} onClose={() => setOpenTest(null)} title={openTest?.name ?? ''} subtitle={openTest ? `${report.customers.find((c) => c.customerId === openTest.customerId)?.customerName} · ${report.customers.find((c) => c.customerId === openTest.customerId)?.scenarioName}` : undefined} actions={openTest && <Button size="sm" variant="secondary" onClick={() => { setOpenCustomer(openTest.customerId); }}>Open customer journey</Button>}>
        {openTest?.failure && <FailureDiagnosticView failure={openTest.failure} test={openTest} />}
      </Drawer>
      <CustomerDrawer customerId={openCustomer} tests={report.customers.flatMap((c) => c.tests)} onClose={() => setOpenCustomer(null)} />
    </>
  );
}

function Delta({ label, value, good, suffix = '' }: { label: string; value: number | null; good: 'up' | 'down'; suffix?: string }) {
  const positive = value != null && value > 0;
  const negative = value != null && value < 0;
  const isGood = value == null || value === 0 ? null : (good === 'up') === positive;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cn('mt-1 text-xl font-bold', isGood == null ? 'text-slate-700' : isGood ? 'text-emerald-600' : 'text-rose-600')}>
        {value == null ? '—' : `${positive ? '+' : negative ? '' : '±'}${value}${suffix}`}
      </div>
    </div>
  );
}
