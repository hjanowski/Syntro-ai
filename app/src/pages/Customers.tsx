import { Monitor, Smartphone, Tablet, Users } from 'lucide-react';
import { useState } from 'react';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtTime } from '@/lib/format.ts';
import { CustomerDrawer } from '@/components/CustomerDrawer.tsx';
import { ProjectPicker, useActiveProject } from '@/components/ProjectPicker.tsx';
import { Badge, Button, Card, CardTitle, EmptyState, Field, InfoBanner, Input, PageHeader, Select, StatusPill, Table, Td, Th } from '@/components/ui.tsx';

export default function Customers() {
  const { client } = useEngine();
  const { projects, project, setProjectId } = useActiveProject();
  const [count, setCount] = useState(10);
  const [seed, setSeed] = useState(42);
  const [persona, setPersona] = useState('');
  const [region, setRegion] = useState('');
  const attributes: Record<string, string> = {};
  if (persona) attributes.persona = persona;
  if (region) attributes.region = region;
  const { data: preview, reload } = useAsync(() => (project ? client.previewCustomers(project.id, { count, seed, attributes }) : Promise.resolve([])), [client, project?.id, count, seed, persona, region]);
  const { data: runs } = useAsync(() => (project ? client.listRuns(project.id) : Promise.resolve([])), [client, project?.id], { poll: 5000 });
  const [runId, setRunId] = useState('');
  const activeRunId = runId || runs?.[0]?.id || '';
  const { data: customers } = useAsync(() => (activeRunId ? client.listCustomers(activeRunId) : Promise.resolve([])), [client, activeRunId], { poll: 2000 });
  const { data: report } = useAsync(() => (activeRunId ? client.getValidation(activeRunId) : Promise.resolve(null)), [client, activeRunId], { poll: 5000 });
  const { data: scenarios } = useAsync(() => (project ? client.listScenarios(project.id) : Promise.resolve([])), [client, project?.id]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Synthetic Customers" subtitle="Generate synthetic populations with unique identities, assign scenarios, and inspect every customer's identities and journey history." actions={projects.length > 0 && project && <ProjectPicker projects={projects} value={project.id} onChange={setProjectId} />} />
      {!project && <EmptyState icon={<Users className="h-10 w-10" />} title="Create a project first" />}
      {project && (
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardTitle hint="Deterministic from the seed — the same population is reproducible.">Population generator</CardTitle>
            <div className="space-y-4">
              <Field label={`Customers: ${count}`}>
                <input type="range" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-brand-600" />
              </Field>
              <Field label="Seed"><Input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Persona">
                  <Select value={persona} onChange={(e) => setPersona(e.target.value)}>
                    <option value="">Mixed</option>
                    <option value="value_seeker">Value seeker</option>
                    <option value="brand_loyal">Brand loyal</option>
                    <option value="researcher">Researcher</option>
                    <option value="impulse">Impulse</option>
                  </Select>
                </Field>
                <Field label="Region">
                  <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="">Mixed</option>
                    <option value="NA">North America</option>
                    <option value="EU">Europe</option>
                    <option value="APAC">APAC</option>
                  </Select>
                </Field>
              </div>
              <Button variant="secondary" onClick={() => reload()} className="w-full">Regenerate preview</Button>
              <InfoBanner>
                Contact data can never reach a real person: emails use the reserved <code>.invalid</code> domain and phone numbers the fictional 555-01xx range. Populations are created per simulation from the Simulation Control Centre.
              </InfoBanner>
            </div>
          </Card>
          <div className="space-y-5">
            <Card padded={false}>
              <div className="px-5 pt-5">
                <CardTitle hint="How the next population will look">Preview</CardTitle>
              </div>
              <Table className="rounded-t-none border-0 shadow-none">
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Name</Th>
                    <Th>Synthetic email</Th>
                    <Th>Phone</Th>
                    <Th>Device</Th>
                    <Th>Attributes</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview?.slice(0, 12).map((c) => (
                    <tr key={c.id}>
                      <Td className="text-slate-400">{c.index}</Td>
                      <Td className="font-medium text-slate-900">{c.firstName} {c.lastName}</Td>
                      <Td className="font-mono text-xs">{c.email}</Td>
                      <Td className="font-mono text-xs">{c.phone}</Td>
                      <Td><DeviceCell kind={c.device.kind} label={`${c.device.os} · ${c.device.browser}`} /></Td>
                      <Td className="text-xs text-slate-500">{String(c.attributes.persona)} · {String(c.attributes.region)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {preview && preview.length > 12 && <div className="px-5 py-3 text-xs text-slate-400">…and {preview.length - 12} more</div>}
            </Card>

            <Card padded={false}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                <CardTitle hint="Identities and journey histories of customers created by simulations">Simulated populations</CardTitle>
                <Select className="w-auto" value={activeRunId} onChange={(e) => setRunId(e.target.value)}>
                  {runs?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {fmtTime(r.createdAt)}
                    </option>
                  ))}
                </Select>
              </div>
              {!runs?.length && <div className="px-5 pb-6 text-sm text-slate-500">No simulations yet for this project.</div>}
              {customers && customers.length > 0 && (
                <Table className="rounded-t-none border-0 shadow-none">
                  <thead>
                    <tr>
                      <Th>#</Th>
                      <Th>Customer</Th>
                      <Th>Scenario</Th>
                      <Th>Device</Th>
                      <Th>Sessions</Th>
                      <Th>Status</Th>
                      <Th>Validation</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => {
                      const v = report?.customers.find((x) => x.customerId === c.id);
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/60">
                          <Td className="text-slate-400">{c.index}</Td>
                          <Td>
                            <div className="font-medium text-slate-900">{c.firstName} {c.lastName}</div>
                            <div className="font-mono text-[11px] text-slate-500">{c.email}</div>
                          </Td>
                          <Td className="text-xs">{scenarios?.find((s) => s.id === c.scenarioId)?.name ?? c.scenarioId}</Td>
                          <Td><DeviceCell kind={c.device.kind} label={c.device.browser} /></Td>
                          <Td>{c.sessions.length}</Td>
                          <Td><StatusPill status={c.status} pulse /></Td>
                          <Td>{v ? <StatusPill status={v.status} /> : <Badge>pending</Badge>}</Td>
                          <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setOpen(c.id)}>Journey</Button></Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </div>
      )}
      <CustomerDrawer customerId={open} tests={report?.customers.flatMap((c) => c.tests)} onClose={() => setOpen(null)} />
    </>
  );
}

export function DeviceCell({ kind, label }: { kind: string; label?: string }) {
  const Icon = kind === 'mobile' ? Smartphone : kind === 'tablet' ? Tablet : Monitor;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <Icon className="h-3.5 w-3.5 text-slate-400" /> {label ?? kind}
    </span>
  );
}
