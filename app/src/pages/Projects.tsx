import { FolderKanban, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtDate } from '@/lib/format.ts';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Loading, Modal, PageHeader, Toggle } from '@/components/ui.tsx';

export default function Projects() {
  const { client } = useEngine();
  const navigate = useNavigate();
  const { data: projects, error, loading, reload } = useAsync(() => client.listProjects(), [client]);
  const { data: scenarios } = useAsync(() => client.listScenarios(), [client]);
  const { data: runs } = useAsync(() => client.listRuns(), [client]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', seedDemo: true });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const p = await client.createProject({ name: form.name, description: form.description, seedDemo: form.seedDemo });
      setOpen(false);
      setForm({ name: '', description: '', seedDemo: true });
      await reload();
      navigate(`/projects/${p.id}`);
    } finally {
      setBusy(false);
    }
  };

  const seedDemo = async () => {
    setBusy(true);
    try {
      const p = await client.ensureDemoProject();
      await reload();
      navigate(`/projects/${p.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="A project represents a website and the attribution solution you want to test, with its journeys, scenarios, integrations and history."
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={busy} onClick={seedDemo}>
              Demo project
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
              New project
            </Button>
          </>
        }
      />
      <ErrorBanner message={error} />
      {loading && !projects && <Loading />}
      {projects && projects.length === 0 && <EmptyState icon={<FolderKanban className="h-10 w-10" />} title="No projects yet" description="Create a project for the website and attribution system you want to validate, or start from the bundled Aurora Supply Co. demo." action={<Button onClick={seedDemo} loading={busy}>Create the demo project</Button>} />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects?.map((p) => {
          const scenarioCount = scenarios?.filter((s) => s.projectId === p.id).length ?? 0;
          const projectRuns = runs?.filter((r) => r.projectId === p.id) ?? [];
          const last = projectRuns[0];
          return (
            <Link key={p.id} to={`/projects/${p.id}`} className="group">
              <Card className="h-full transition group-hover:-translate-y-0.5 group-hover:shadow-pop">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{p.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description || 'No description'}</p>
                  </div>
                  <Badge tone={p.website.kind === 'bundled_demo_store' ? 'brand' : 'neutral'}>{p.website.kind === 'bundled_demo_store' ? 'Demo store' : 'External site'}</Badge>
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-slate-50 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Scenarios</dt>
                    <dd className="text-lg font-bold text-slate-900">{scenarioCount}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Runs</dt>
                    <dd className="text-lg font-bold text-slate-900">{projectRuns.length}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Last accuracy</dt>
                    <dd className="text-lg font-bold text-slate-900">{last?.summary?.attributionAccuracy != null ? `${Math.round(last.summary.attributionAccuracy * 100)}%` : '—'}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>SUT: {p.sut.adapter} · {p.sut.identityResolution.replace(/_/g, ' ')} · {p.sut.lookbackDays}d</span>
                  <span>{fmtDate(p.createdAt)}</span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New project" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} loading={busy} disabled={!form.name.trim()}>Create project</Button></>}>
        <div className="space-y-4">
          <Field label="Project name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Northwind Retail — EU" autoFocus />
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Website and attribution solution under test" />
          </Field>
          <Toggle checked={form.seedDemo} onChange={(v) => setForm({ ...form, seedDemo: v })} label="Add the preconfigured journeys and scenarios" hint="Multi-touch purchase, cross-device login, lookback expiry, missing UTMs, duplicate and lost conversions, and more." />
          <p className="text-xs text-slate-500">New projects target the bundled demo store. Point the project at an external website from its settings once the SDK is installed there.</p>
        </div>
      </Modal>
    </>
  );
}
