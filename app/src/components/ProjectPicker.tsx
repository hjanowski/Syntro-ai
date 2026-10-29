import type { Project } from '@syntro/engine';
import { useEffect } from 'react';
import { useAsync, useLocalState } from '@/engine/hooks.ts';
import { useEngine } from '@/engine/provider.tsx';
import { Select } from './ui.tsx';

/** Remembers the active project across pages. */
export function useActiveProject(): { projects: Project[]; project: Project | null; setProjectId: (id: string) => void; reload: () => Promise<void>; loading: boolean } {
  const { client } = useEngine();
  const { data, reload, loading } = useAsync(() => client.listProjects(), [client]);
  const [projectId, setProjectId] = useLocalState<string>('syntro.activeProject', '');
  const projects = data ?? [];
  const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  useEffect(() => {
    if (project && project.id !== projectId) setProjectId(project.id);
  }, [project, projectId, setProjectId]);
  return { projects, project, setProjectId, reload, loading };
}

export function ProjectPicker({ projects, value, onChange }: { projects: Project[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-[220px]">
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}
