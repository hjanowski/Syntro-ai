import { ATTRIBUTION_MODELS, MARKETING_CHANNELS, type AttributionModel, type Channel, type Project, type ScenarioFault, type SystemUnderTestConfig } from '@syntro/engine';
import { Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtPct, humanize, relTime } from '@/lib/format.ts';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorBanner, Field, InfoBanner, Input, Loading, Modal, PageHeader, Select, StatusPill, Table, Tabs, Td, Th, Toggle } from '@/components/ui.tsx';

type Tab = 'scenarios' | 'journeys' | 'runs' | 'settings';

export default function ProjectDetail() {
  const { projectId = '' } = useParams();
  const { client } = useEngine();
  const navigate = useNavigate();
  const { data: project, error, loading, reload } = useAsync(() => client.getProject(projectId), [client, projectId]);
  const { data: scenarios, reload: reloadScenarios } = useAsync(() => client.listScenarios(projectId), [client, projectId]);
  const { data: journeys, reload: reloadJourneys } = useAsync(() => client.listJourneys(projectId), [client, projectId]);
  const { data: runs } = useAsync(() => client.listRuns(projectId), [client, projectId], { poll: 4000 });
  const { data: templates } = useAsync(() => client.listJourneyTemplates(), [client]);
  const [tab, setTab] = useState<Tab>('scenarios');
  const [scenarioModal, setScenarioModal] = useState(false);

  if (loading && !project) return <Loading />;
  if (!project) return <ErrorBanner message={error ?? 'Project not found'} />;

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        subtitle={project.description}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(`/integrations?project=${project.id}`)}>
              Integrations
            </Button>
            <Button icon={<Play className="h-4 w-4" />} onClick={() => navigate(`/simulations?project=${project.id}`)}>
              Launch simulation
            </Button>
          </>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'scenarios', label: 'Scenarios', count: scenarios?.length },
          { value: 'journeys', label: 'Journeys', count: journeys?.length },
          { value: 'runs', label: 'Simulation history', count: runs?.length },
          { value: 'settings', label: 'Attribution & website setup' },
        ]}
      />

      {tab === 'scenarios' && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-500">A scenario is a journey plus deliberate faults and a default population size.</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={async () => { await client.seedProject(project.id); await reloadScenarios(); await reloadJourneys(); }}>
                Add preconfigured scenarios
              </Button>
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setScenarioModal(true)} disabled={!journeys?.length}>
                New scenario
              </Button>
            </div>
          </div>
          {scenarios && scenarios.length === 0 && <EmptyState title="No scenarios" description="Add the preconfigured attribution testing scenarios or create one from a journey." />}
          {scenarios && scenarios.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Scenario</Th>
                  <Th>Journey</Th>
                  <Th>Injected faults</Th>
                  <Th>Default customers</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <Td>
                      <div className="font-medium text-slate-900">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.description}</div>
                    </Td>
                    <Td>
                      <Link to={`/journeys/${s.journeyId}`} className="text-brand-600 hover:underline">
                        {journeys?.find((j) => j.id === s.journeyId)?.name ?? s.journeyId}
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {s.faults.length === 0 && <Badge tone="success">none</Badge>}
                        {s.faults.map((f, i) => (
                          <Badge key={i} tone="warning">
                            {describeFault(f)}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                    <Td>{s.defaultCustomerCount}</Td>
                    <Td className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/simulations?project=${project.id}&scenario=${s.id}`)}>
                          Run
                        </Button>
                        <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Delete scenario "${s.name}"?`)) { await client.deleteScenario(s.id); await reloadScenarios(); } }} aria-label="Delete">
                          <Trash2 className="h-4 w-4 text-slate-400" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <ScenarioModal open={scenarioModal} onClose={() => setScenarioModal(false)} projectId={project.id} journeys={journeys ?? []} onCreated={reloadScenarios} />
        </>
      )}

      {tab === 'journeys' && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-500">Journeys define what synthetic customers do. Open one in the visual builder or start from a template.</p>
            <div className="flex gap-2">
              <Select
                className="w-auto"
                value=""
                onChange={async (e) => {
                  if (!e.target.value) return;
                  const j = await client.createJourneyFromTemplate(e.target.value, project.id);
                  navigate(`/journeys/${j.id}`);
                }}
              >
                <option value="">New from template…</option>
                {templates?.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={async () => {
                  const j = await client.createJourney({ projectId: project.id, name: 'Untitled journey', nodes: [{ id: 'n1', type: 'start', config: {}, position: { x: 60, y: 160 } }, { id: 'n2', type: 'end', config: {}, position: { x: 520, y: 160 } }], edges: [{ id: 'e1', source: 'n1', target: 'n2' }] });
                  navigate(`/journeys/${j.id}`);
                }}
              >
                Blank journey
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {journeys?.map((j) => (
              <Link key={j.id} to={`/journeys/${j.id}`}>
                <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-pop">
                  <div className="text-sm font-semibold text-slate-900">{j.name}</div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{j.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <Badge>{j.nodes.length} steps</Badge>
                    {j.tags.slice(0, 3).map((t) => (
                      <Badge key={t} tone="brand">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {tab === 'runs' && (
        <>
          {runs && runs.length === 0 && <EmptyState title="No simulations yet" action={<Button onClick={() => navigate(`/simulations?project=${project.id}`)}>Launch the first simulation</Button>} />}
          {runs && runs.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th>Customers</Th>
                  <Th>Passed / failed</Th>
                  <Th>Accuracy</Th>
                  <Th>SUT identity</Th>
                  <Th>When</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <Td className="font-medium text-slate-900">{r.name}{r.parentRunId && <span className="ml-2 text-xs text-slate-400">re-run</span>}</Td>
                    <Td><StatusPill status={r.status} pulse /></Td>
                    <Td>{r.progress.total}</Td>
                    <Td><span className="text-emerald-600">{r.summary?.passed ?? '—'}</span> / <span className="text-rose-600">{r.summary?.failed ?? '—'}</span></Td>
                    <Td>{fmtPct(r.summary?.attributionAccuracy)}</Td>
                    <Td className="text-xs">{r.sutSnapshot.identityResolution.replace(/_/g, ' ')}</Td>
                    <Td className="text-slate-500">{relTime(r.createdAt)}</Td>
                    <Td className="text-right"><Link to={r.summary ? `/results/${r.id}` : `/simulations/${r.id}`} className="text-xs font-semibold text-brand-600 hover:underline">{r.summary ? 'Results' : 'Open'}</Link></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}

      {tab === 'settings' && <ProjectSettings project={project} onSaved={reload} />}
    </>
  );
}

export function describeFault(f: ScenarioFault): string {
  switch (f.kind) {
    case 'missing_utm':
      return `missing UTMs (${f.channel})`;
    case 'wrong_campaign_param':
      return `wrong campaign (${f.channel})`;
    case 'drop_events':
      return `drop ${f.eventTypes.join(', ')}`;
    case 'duplicate_events':
      return `duplicate ${f.eventTypes.join(', ')}`;
    case 'delay_events':
      return `delay ${f.eventTypes.join(', ')} ${Math.round(f.delayMs / 3600000)}h`;
    case 'suppress_identify':
      return 'suppress identify';
  }
}

function ScenarioModal({ open, onClose, projectId, journeys, onCreated }: { open: boolean; onClose: () => void; projectId: string; journeys: { id: string; name: string }[]; onCreated: () => Promise<void> }) {
  const { client } = useEngine();
  const [form, setForm] = useState({ name: '', description: '', journeyId: journeys[0]?.id ?? '', count: 2, faultKind: '', faultChannel: 'linkedin', eventTypes: 'purchase', delayHours: 6, campaignId: 'OLD_CAMPAIGN' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!form.journeyId && journeys[0]) setForm((f) => ({ ...f, journeyId: journeys[0].id }));
  }, [journeys, form.journeyId]);

  const buildFault = (): ScenarioFault[] => {
    const types = form.eventTypes.split(',').map((s) => s.trim()).filter(Boolean);
    switch (form.faultKind) {
      case 'missing_utm':
        return [{ kind: 'missing_utm', channel: form.faultChannel as Channel }];
      case 'wrong_campaign_param':
        return [{ kind: 'wrong_campaign_param', channel: form.faultChannel as Channel, campaignId: form.campaignId }];
      case 'drop_events':
        return [{ kind: 'drop_events', eventTypes: types }];
      case 'duplicate_events':
        return [{ kind: 'duplicate_events', eventTypes: types }];
      case 'delay_events':
        return [{ kind: 'delay_events', eventTypes: types, delayMs: form.delayHours * 3600000 }];
      case 'suppress_identify':
        return [{ kind: 'suppress_identify' }];
      default:
        return [];
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      await client.createScenario({ projectId, name: form.name, description: form.description, journeyId: form.journeyId, faults: buildFault(), defaultCustomerCount: form.count });
      await onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New scenario" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={create} loading={busy} disabled={!form.name.trim() || !form.journeyId}>Create scenario</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Journey">
          <Select value={form.journeyId} onChange={(e) => setForm({ ...form, journeyId: e.target.value })}>
            {journeys.map((j) => (<option key={j.id} value={j.id}>{j.name}</option>))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default customers"><Input type="number" min={1} max={100} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} /></Field>
          <Field label="Injected fault">
            <Select value={form.faultKind} onChange={(e) => setForm({ ...form, faultKind: e.target.value })}>
              <option value="">None</option>
              <option value="missing_utm">Missing UTM parameters</option>
              <option value="wrong_campaign_param">Wrong campaign parameter</option>
              <option value="drop_events">Lost website events</option>
              <option value="duplicate_events">Duplicate events</option>
              <option value="delay_events">Delayed events</option>
              <option value="suppress_identify">SDK never identifies</option>
            </Select>
          </Field>
        </div>
        {(form.faultKind === 'missing_utm' || form.faultKind === 'wrong_campaign_param') && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel">
              <Select value={form.faultChannel} onChange={(e) => setForm({ ...form, faultChannel: e.target.value })}>
                {MARKETING_CHANNELS.map((c) => (<option key={c} value={c}>{humanize(c)}</option>))}
              </Select>
            </Field>
            {form.faultKind === 'wrong_campaign_param' && <Field label="Wrong utm_campaign value"><Input value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })} /></Field>}
          </div>
        )}
        {['drop_events', 'duplicate_events', 'delay_events'].includes(form.faultKind) && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Event types" hint="comma separated"><Input value={form.eventTypes} onChange={(e) => setForm({ ...form, eventTypes: e.target.value })} /></Field>
            {form.faultKind === 'delay_events' && <Field label="Delay (hours)"><Input type="number" min={1} value={form.delayHours} onChange={(e) => setForm({ ...form, delayHours: Number(e.target.value) })} /></Field>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProjectSettings({ project, onSaved }: { project: Project; onSaved: () => Promise<void> }) {
  const { client } = useEngine();
  const [sut, setSut] = useState<SystemUnderTestConfig>(() => structuredClone(project.sut));
  const [policy, setPolicy] = useState(() => ({ ...project.attributionPolicy }));
  const [website, setWebsite] = useState(() => ({ ...project.website }));
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mappingKey, setMappingKey] = useState('');
  const [mappingChannel, setMappingChannel] = useState<Channel>('linkedin');

  const save = async () => {
    setSaving(true);
    try {
      await client.updateProject(project.id, { name, sut, attributionPolicy: policy, website });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const toggleModel = (list: AttributionModel[], m: AttributionModel) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardTitle hint="What the business intends. Syntro derives expected results from this policy, independently of the system under test.">Attribution policy (expected)</CardTitle>
        <div className="space-y-4">
          <Field label="Project name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Models to validate">
            <div className="flex flex-wrap gap-2">
              {ATTRIBUTION_MODELS.map((m) => (
                <button key={m} onClick={() => setPolicy({ ...policy, models: toggleModel(policy.models, m) })} className={`rounded-full border px-3 py-1 text-xs font-medium ${policy.models.includes(m) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500'}`}>
                  {humanize(m)}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Lookback window (days)"><Input type="number" min={1} max={365} value={policy.lookbackDays} onChange={(e) => setPolicy({ ...policy, lookbackDays: Number(e.target.value) })} /></Field>
        </div>
      </Card>

      <Card>
        <CardTitle hint="The attribution solution Syntro validates. Change settings here to introduce (or fix) deliberate errors.">Attribution system under test</CardTitle>
        <div className="space-y-4">
          <Field label="Adapter">
            <Select value={sut.adapter} onChange={(e) => setSut({ ...sut, adapter: e.target.value as SystemUnderTestConfig['adapter'] })}>
              <option value="local">Syntro local attribution system (functional)</option>
              <option value="file">Generic file exchange adapter (prototype)</option>
              <option value="http">Generic HTTP adapter (prototype)</option>
            </Select>
          </Field>
          {sut.adapter !== 'local' && (
            <InfoBanner tone="warning">
              Prototype adapter: results must be produced by the external system and conform to the AttributionResult[] contract (see docs/API.md). Runs wait in “awaiting results” until a document is provided.
            </InfoBanner>
          )}
          {sut.adapter === 'http' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ingest URL"><Input value={sut.external?.ingestUrl ?? ''} onChange={(e) => setSut({ ...sut, external: { ...sut.external, ingestUrl: e.target.value } })} placeholder="https://test.attribution.example/ingest" /></Field>
              <Field label="Results URL"><Input value={sut.external?.resultsUrl ?? ''} onChange={(e) => setSut({ ...sut, external: { ...sut.external, resultsUrl: e.target.value } })} placeholder="https://test.attribution.example/results" /></Field>
            </div>
          )}
          {sut.adapter === 'file' && (
            <Field label="Results document (JSON)">
              <textarea className="h-28 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs" value={sut.external?.resultsDocument ?? ''} onChange={(e) => setSut({ ...sut, external: { ...sut.external, resultsDocument: e.target.value } })} placeholder='[{ "model": "last_touch", "conversion": {...}, "identity": {...}, "journey": [...], "credits": [...] }]' />
            </Field>
          )}
          <Field label="Models computed">
            <div className="flex flex-wrap gap-2">
              {ATTRIBUTION_MODELS.map((m) => (
                <button key={m} onClick={() => setSut({ ...sut, models: toggleModel(sut.models, m) })} className={`rounded-full border px-3 py-1 text-xs font-medium ${sut.models.includes(m) ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>
                  {humanize(m)}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lookback (days)"><Input type="number" min={1} max={365} value={sut.lookbackDays} onChange={(e) => setSut({ ...sut, lookbackDays: Number(e.target.value) })} /></Field>
            <Field label="Identity resolution">
              <Select value={sut.identityResolution} onChange={(e) => setSut({ ...sut, identityResolution: e.target.value as SystemUnderTestConfig['identityResolution'] })}>
                <option value="cookie_only">Cookie only (no cross-device stitching)</option>
                <option value="cookie_and_email">Cookie + hashed email (identity graph)</option>
              </Select>
            </Field>
          </div>
          <Toggle checked={sut.dedupeConversionsByOrderId} onChange={(v) => setSut({ ...sut, dedupeConversionsByOrderId: v })} label="Deduplicate conversions by order id" />
          <Toggle checked={sut.usePlatformClickRecords} onChange={(v) => setSut({ ...sut, usePlatformClickRecords: v })} label="Join unknown click ids with synthetic platform click records" hint="Source-platform data adapter (resolves e.g. li_fat_id without UTMs)" />
          <Field label="Click-id → channel mappings">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(sut.clickIdMappings).map(([k, v]) => (
                <Badge key={k} tone="violet" className="cursor-pointer" >
                  <span onClick={() => { const next = { ...sut.clickIdMappings }; delete next[k]; setSut({ ...sut, clickIdMappings: next }); }}>{k} → {v} ×</span>
                </Badge>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input className="w-40" placeholder="li_fat_id" value={mappingKey} onChange={(e) => setMappingKey(e.target.value)} />
              <Select className="w-40" value={mappingChannel} onChange={(e) => setMappingChannel(e.target.value as Channel)}>
                {MARKETING_CHANNELS.map((c) => (<option key={c} value={c}>{humanize(c)}</option>))}
              </Select>
              <Button variant="secondary" size="md" onClick={() => { if (!mappingKey.trim()) return; setSut({ ...sut, clickIdMappings: { ...sut.clickIdMappings, [mappingKey.trim()]: mappingChannel } }); setMappingKey(''); }}>Add</Button>
            </div>
          </Field>
          <Field label="Deliberate faults">
            <div className="flex flex-wrap gap-2">
              {MARKETING_CHANNELS.map((c) => {
                const on = sut.faults.ignoreChannels?.includes(c);
                return (
                  <button key={c} onClick={() => setSut({ ...sut, faults: { ...sut.faults, ignoreChannels: on ? (sut.faults.ignoreChannels ?? []).filter((x) => x !== c) : [...(sut.faults.ignoreChannels ?? []), c] } })} className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500'}`}>
                    {on ? 'ignoring ' : 'ignore '} {humanize(c)}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input placeholder="misattribute campaign from…" value={sut.faults.misattributeCampaign?.from ?? ''} onChange={(e) => setSut({ ...sut, faults: { ...sut.faults, misattributeCampaign: e.target.value ? { from: e.target.value, to: sut.faults.misattributeCampaign?.to ?? '' } : null } })} />
              <Input placeholder="…to" value={sut.faults.misattributeCampaign?.to ?? ''} onChange={(e) => setSut({ ...sut, faults: { ...sut.faults, misattributeCampaign: { from: sut.faults.misattributeCampaign?.from ?? '', to: e.target.value } } })} />
            </div>
          </Field>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle hint="Where synthetic customers browse. The bundled demo store is fully instrumented; external websites need the SDK and an authorized test checkout.">Website</CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Website kind">
            <Select value={website.kind} onChange={(e) => setWebsite({ ...website, kind: e.target.value as Project['website']['kind'] })}>
              <option value="bundled_demo_store">Bundled demo store (Aurora Supply Co.)</option>
              <option value="external">External website (SDK installed)</option>
            </Select>
          </Field>
          <Field label="Base URL" hint="pages are resolved relative to this"><Input value={website.baseUrl} onChange={(e) => setWebsite({ ...website, baseUrl: e.target.value })} disabled={website.kind === 'bundled_demo_store'} /></Field>
          <Toggle checked={website.isolationGuard} onChange={(v) => setWebsite({ ...website, isolationGuard: v })} label="Production analytics isolation guard" hint="Demo store only: when off, the mock production tag fires for synthetic sessions and the isolation check fails." />
          <Toggle checked={website.testCheckoutAuthorized} onChange={(v) => setWebsite({ ...website, testCheckoutAuthorized: v })} label="Test checkout authorized" hint="Required before conversion scenarios run against an external website." />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={save} loading={saving}>Save changes</Button>
          {saved && <span className="text-sm text-emerald-600">Saved. Re-run a simulation or re-validate an existing run to see the effect.</span>}
        </div>
      </Card>
    </div>
  );
}
