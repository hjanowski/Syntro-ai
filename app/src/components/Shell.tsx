import { Activity, BarChart3, FolderKanban, GitBranch, LayoutDashboard, Plug, Settings, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useEngine } from '@/engine/provider.tsx';
import { Badge } from './ui.tsx';
import { cn } from './ui.tsx';
import { LiveDock } from './LiveDock.tsx';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/journeys', label: 'Journey Builder', icon: GitBranch },
  { to: '/customers', label: 'Synthetic Customers', icon: Users },
  { to: '/simulations', label: 'Simulation Control', icon: Activity },
  { to: '/results', label: 'Results & Diagnostics', icon: BarChart3 },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const { client, info } = useEngine();
  return (
    <div className="flex h-full min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200/80 bg-white md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-lg font-black text-white shadow-sm">S</div>
          <div>
            <div className="text-base font-bold tracking-tight text-slate-900">Syntro</div>
            <div className="text-[11px] leading-tight text-slate-500">Simulate the journey.<br />Trust the attribution.</div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-0.5 px-3">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200/80 px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Engine</span>
            <Badge tone={client.mode === 'remote' ? 'brand' : 'violet'} dot>
              {client.mode === 'remote' ? 'Node · Playwright' : 'In-browser'}
            </Badge>
          </div>
          <div className="mt-1 truncate text-[11px] text-slate-400">{info ? `${info.driver} · API ${info.apiVersion}` : ''}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur md:hidden">
          <div className="flex items-center gap-2 font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-white">S</span> Syntro
          </div>
          <nav className="flex gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cn('rounded-lg p-2', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500')} title={item.label}>
                <item.icon className="h-4 w-4" />
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="scrollbar-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
      <LiveDock />
    </div>
  );
}
