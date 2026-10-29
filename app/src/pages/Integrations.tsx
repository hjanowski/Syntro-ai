import type { IntegrationStatus } from '@syntro/engine';
import { CheckCircle2, CircleDashed, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtTime } from '@/lib/format.ts';
import { ProjectPicker, useActiveProject } from '@/components/ProjectPicker.tsx';
import { Badge, Button, Card, CardTitle, Code, EmptyState, InfoBanner, Loading, MaturityBadge, PageHeader, StatusPill, cn } from '@/components/ui.tsx';

const CATEGORY_TITLES: Record<IntegrationStatus['category'], string> = {
  website: 'Website',
  tag_manager: 'Tag management',
  collector: 'Test data collector',
  attribution: 'Attribution systems',
  channel: 'Simulated marketing environments & platform data',
  execution: 'Execution',
};

export default function Integrations() {
  const { client, info } = useEngine();
  const [params] = useSearchParams();
  const { projects, project, setProjectId } = useActiveProject();
  useEffect(() => {
    const p = params.get('project');
    if (p) setProjectId(p);
  }, [params, setProjectId]);
  const { data: integrations, loading } = useAsync(() => (project ? client.getIntegrations(project.id) : Promise.resolve([])), [client, project?.id, project?.sut, project?.website]);
  const { data: preflight, reload: reloadPreflight } = useAsync(() => (project ? client.getLatestPreflight(project.id) : Promise.resolve(null)), [client, project?.id]);
  const [running, setRunning] = useState(false);

  const runPreflight = async () => {
    if (!project) return;
    setRunning(true);
    try {
      await client.runPreflight(project.id);
      await reloadPreflight();
    } finally {
      setRunning(false);
    }
  };

  const sdkUrl = info ? `${info.siteBaseUrl.replace(/\/sites$/, '')}/sdk/syntro.js` : '/sdk/syntro.js';
  const grouped = (integrations ?? []).reduce<Record<string, IntegrationStatus[]>>((acc, i) => {
    (acc[i.category] ??= []).push(i);
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect the website, tag manager, test data collector and attribution systems. Fully functional connections are labelled; prototype adapters and planned connectors are clearly marked." actions={projects.length > 0 && project && <ProjectPicker projects={projects} value={project.id} onChange={setProjectId} />} />
      {!project && <EmptyState title="Create a project first" />}
      {project && loading && !integrations && <Loading />}
      {project && integrations && (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {(Object.keys(CATEGORY_TITLES) as IntegrationStatus['category'][]).map((cat) =>
              grouped[cat]?.length ? (
                <section key={cat}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{CATEGORY_TITLES[cat]}</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {grouped[cat].map((i) => (
                      <Card key={i.id} className={cn(i.maturity === 'not_implemented' && 'opacity-80')}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <HealthIcon healthy={i.healthy} maturity={i.maturity} />
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{i.name}</div>
                              <p className="mt-1 text-xs leading-relaxed text-slate-500">{i.summary}</p>
                            </div>
                          </div>
                          <MaturityBadge maturity={i.maturity} />
                        </div>
                        {i.id.startsWith('attribution_') && i.maturity !== 'not_implemented' && (
                          <div className="mt-3">
                            <Link to={`/projects/${project.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                              Configure in project settings →
                            </Link>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </section>
              ) : null,
            )}
          </div>

          <div className="space-y-5">
            <Card>
              <CardTitle hint="Confirms synthetic session routing and detects leakage into production analytics" actions={<Button size="sm" onClick={runPreflight} loading={running} icon={<ShieldCheck className="h-4 w-4" />}>Run preflight</Button>}>
                Preflight verification
              </CardTitle>
              {!preflight && <p className="text-sm text-slate-500">Runs one synthetic session through the website and checks token acceptance, event routing and production isolation.</p>}
              {preflight && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{fmtTime(preflight.ts)}</span>
                    <StatusPill status={preflight.passed ? 'pass' : 'fail'} />
                  </div>
                  {preflight.checks.map((c) => (
                    <div key={c.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{c.name}</span>
                        <StatusPill status={c.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{c.detail}</p>
                    </div>
                  ))}
                </div>
              )}
              <InfoBanner tone="warning">
                <span className="text-xs">Do not treat production analytics as isolated for a customer configuration until this check passes against that configuration.</span>
              </InfoBanner>
            </Card>

            <Card>
              <CardTitle hint="Install on every page before production tags">Website SDK snippet</CardTitle>
              <Code>{`<script src="${sdkUrl}"\n        data-syntro-collector="auto"></script>`}</Code>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
                <li>• Inert for real visitors: without a signed Syntro token nothing is sent.</li>
                <li>• Synthetic sessions carry a short-lived HMAC-signed token; the collector verifies it.</li>
                <li>• Exposes <code>syntro.isSynthetic()</code> and pushes <code>syntro_synthetic</code> to the data layer for blocking triggers.</li>
                <li>• Does not block third-party tags by itself — configure the blocking trigger below.</li>
              </ul>
            </Card>

            <Card>
              <CardTitle hint="Prototype — recipe and template, not verified against a live container">Google Tag Manager</CardTitle>
              <ol className="space-y-2 text-xs text-slate-600">
                <li><strong>1.</strong> Add a Custom HTML tag loading the SDK snippet above, firing on <em>Initialization – All Pages</em> (before production tags).</li>
                <li><strong>2.</strong> Create a Data Layer Variable <code>syntro_synthetic</code>.</li>
                <li><strong>3.</strong> Create a trigger <em>Synthetic session</em>: Custom Event <code>syntro_session_evaluated</code> where <code>syntro_synthetic</code> equals <code>true</code>.</li>
                <li><strong>4.</strong> Add it as an <em>exception (blocking) trigger</em> on GA4, ad pixels and CDP tags.</li>
                <li><strong>5.</strong> Run the preflight; confirm zero production events during synthetic sessions.</li>
              </ol>
              <p className="mt-3 text-[11px] text-slate-400">A container template lives at <code>sdk/gtm/syntro-container-template.json</code>.</p>
            </Card>

            <Card>
              <CardTitle>Legend</CardTitle>
              <div className="space-y-2 text-xs text-slate-600">
                <div className="flex items-center gap-2"><Badge tone="success">Functional</Badge> works end to end in this prototype</div>
                <div className="flex items-center gap-2"><Badge tone="warning">Prototype adapter</Badge> contract implemented, not verified with a vendor</div>
                <div className="flex items-center gap-2"><Badge tone="neutral">Not implemented</Badge> planned; interface defined</div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function HealthIcon({ healthy, maturity }: { healthy: boolean | null; maturity: IntegrationStatus['maturity'] }) {
  if (maturity === 'not_implemented' || healthy === null) return <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />;
  return healthy ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />;
}
