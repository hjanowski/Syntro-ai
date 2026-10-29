import { BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAsync } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { fmtPct, relTime } from '@/lib/format.ts';
import { ProjectPicker, useActiveProject } from '@/components/ProjectPicker.tsx';
import { EmptyState, Loading, PageHeader, StatusPill, Table, Td, Th } from '@/components/ui.tsx';

export default function ResultsIndex() {
  const { client } = useEngine();
  const { projects, project, setProjectId } = useActiveProject();
  const { data: runs, loading } = useAsync(() => (project ? client.listRuns(project.id) : Promise.resolve([])), [client, project?.id], { poll: 4000 });
  const finished = runs?.filter((r) => r.summary) ?? [];

  return (
    <>
      <PageHeader title="Results & Diagnostics" subtitle="Pick a simulation run to inspect expected versus actual attribution, failures by type, and the evidence behind every failed test." actions={projects.length > 0 && project && <ProjectPicker projects={projects} value={project.id} onChange={setProjectId} />} />
      {loading && !runs && <Loading />}
      {runs && finished.length === 0 && <EmptyState icon={<BarChart3 className="h-10 w-10" />} title="No validated runs yet" description="Launch a simulation; results appear here once execution and validation complete." />}
      {finished.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Run</Th>
              <Th>Status</Th>
              <Th>Customers</Th>
              <Th>Tests</Th>
              <Th>Attribution accuracy</Th>
              <Th>Tracking accuracy</Th>
              <Th>Finished</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {finished.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                <Td className="font-medium text-slate-900">{r.name}{r.parentRunId && <span className="ml-2 text-xs text-slate-400">re-run</span>}</Td>
                <Td><StatusPill status={r.status} /></Td>
                <Td>{r.summary!.customers}</Td>
                <Td><span className="text-emerald-600">{r.summary!.passed}</span> / <span className="text-rose-600">{r.summary!.failed}</span> / <span className="text-amber-600">{r.summary!.inconclusive}</span></Td>
                <Td>{fmtPct(r.summary!.attributionAccuracy)}</Td>
                <Td>{fmtPct(r.summary!.trackingAccuracy)}</Td>
                <Td className="text-slate-500">{relTime(r.finishedAt)}</Td>
                <Td className="text-right"><Link to={`/results/${r.id}`} className="text-xs font-semibold text-brand-600 hover:underline">Open report</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
