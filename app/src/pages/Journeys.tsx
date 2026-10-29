import { GitBranch, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { ProjectPicker, useActiveProject } from '@/components/ProjectPicker.tsx';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, Select } from '@/components/ui.tsx';

export default function Journeys() {
  const { client } = useEngine();
  const navigate = useNavigate();
  const { projects, project, setProjectId } = useActiveProject();
  const { data: journeys, loading } = useAsync(() => (project ? client.listJourneys(project.id) : Promise.resolve([])), [client, project?.id]);
  const { data: templates } = useAsync(() => client.listJourneyTemplates(), [client]);

  return (
    <>
      <PageHeader
        title="Journey Builder"
        subtitle="Design the customer journeys synthetic customers will execute: marketing touchpoints, website behaviour, conditional branches and expected conversions."
        actions={
          <>
            {projects.length > 0 && project && <ProjectPicker projects={projects} value={project.id} onChange={setProjectId} />}
            <Select
              className="w-auto"
              value=""
              disabled={!project}
              onChange={async (e) => {
                if (!e.target.value || !project) return;
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
              icon={<Plus className="h-4 w-4" />}
              disabled={!project}
              onClick={async () => {
                if (!project) return;
                const j = await client.createJourney({ projectId: project.id, name: 'Untitled journey', nodes: [{ id: 'n1', type: 'start', config: {}, position: { x: 60, y: 160 } }, { id: 'n2', type: 'end', config: {}, position: { x: 520, y: 160 } }], edges: [{ id: 'e1', source: 'n1', target: 'n2' }] });
                navigate(`/journeys/${j.id}`);
              }}
            >
              Blank journey
            </Button>
          </>
        }
      />
      {!project && !loading && <EmptyState icon={<GitBranch className="h-10 w-10" />} title="Create a project first" description="Journeys belong to a project." action={<Button onClick={() => navigate('/projects')}>Go to projects</Button>} />}
      {loading && <Loading />}
      {project && journeys && journeys.length === 0 && <EmptyState title="No journeys in this project" description="Start from one of the preconfigured attribution testing journeys." />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {journeys?.map((j) => (
          <Link key={j.id} to={`/journeys/${j.id}`}>
            <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">{j.name}</div>
                <Badge>{j.nodes.length} steps</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{j.description || 'No description'}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {j.tags.slice(0, 4).map((t) => (
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
  );
}
