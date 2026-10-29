import { X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { statusTone } from '@/lib/format.ts';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---- Layout -------------------------------------------------------------------

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn('rounded-2xl border border-slate-200/80 bg-white shadow-card', padded && 'p-5', className)}>{children}</div>;
}

export function CardTitle({ children, actions, hint }: { children: ReactNode; actions?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{children}</h2>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-8', className)}>
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">{title}</h2>}
      {children}
    </section>
  );
}

// ---- Buttons & badges --------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode };

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[size];
  const variants = {
    primary: 'bg-brand-gradient text-white shadow-sm hover:brightness-110',
    secondary: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  }[variant];
  return (
    <button className={cn(base, sizes, variants, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
}

const TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export type Tone = keyof typeof TONES;

export function Badge({ children, tone = 'neutral', className, dot }: { children: ReactNode; tone?: Tone; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'success' ? 'bg-emerald-500' : tone === 'danger' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : tone === 'info' ? 'bg-sky-500' : 'bg-slate-400')} />}
      {children}
    </span>
  );
}

export function StatusPill({ status, pulse }: { status: string; pulse?: boolean }) {
  const tone = statusTone(status);
  const label = status === 'pass' ? 'Passed' : status === 'fail' ? 'Failed' : status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Badge tone={tone} dot className={pulse && (status === 'running' || status === 'finalizing') ? 'animate-pulse-soft' : undefined}>
      {label}
    </Badge>
  );
}

export function MaturityBadge({ maturity }: { maturity: 'functional' | 'prototype' | 'not_implemented' }) {
  return maturity === 'functional' ? <Badge tone="success">Functional</Badge> : maturity === 'prototype' ? <Badge tone="warning">Prototype adapter</Badge> : <Badge tone="neutral">Not implemented</Badge>;
}

// ---- Data display -----------------------------------------------------------------

export function StatTile({ label, value, hint, tone, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'success' | 'danger' | 'warning' | 'brand' | 'neutral'; icon?: ReactNode }) {
  const valueColor = tone === 'success' ? 'text-emerald-600' : tone === 'danger' ? 'text-rose-600' : tone === 'warning' ? 'text-amber-600' : tone === 'brand' ? 'text-brand-600' : 'text-slate-900';
  return (
    <Card className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
        <div className={cn('mt-2 text-3xl font-bold tracking-tight', valueColor)}>{value}</div>
        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </div>
      {icon && <div className="rounded-xl bg-slate-50 p-2 text-slate-400">{icon}</div>}
    </Card>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-card', className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('whitespace-nowrap border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500', className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td className={cn('border-b border-slate-100 px-4 py-3 align-middle text-slate-700', className)} colSpan={colSpan}>
      {children}
    </td>
  );
}

export function EmptyState({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-slate-500">
      <Spinner className="h-4 w-4" /> {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>;
}

export function InfoBanner({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  const cls = tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-800';
  return <div className={cn('rounded-xl border px-4 py-3 text-sm', cls)}>{children}</div>;
}

export function ProgressBar({ value, max, tone = 'brand', className }: { value: number; max: number; tone?: 'brand' | 'success' | 'danger'; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone === 'success' ? 'bg-emerald-500' : tone === 'danger' ? 'bg-rose-500' : 'bg-brand-gradient';
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---- Forms ---------------------------------------------------------------------------

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <span className="text-xs font-semibold text-slate-700">{children}</span>
      {hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-5.5 translate-x-0.5' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      {children}
    </div>
  );
}

// ---- Tabs, drawers, modals -----------------------------------------------------------

export function Tabs<T extends string>({ items, value, onChange }: { items: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-200">
      {items.map((item) => (
        <button key={item.value} onClick={() => onChange(item.value)} className={cn('-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition', value === item.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {item.label}
          {item.count !== undefined && <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', value === item.value ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ items, value, onChange, size = 'sm' }: { items: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1">
      {items.map((item) => (
        <button key={item.value} onClick={() => onChange(item.value)} className={cn('rounded-lg font-medium transition', size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm', value === item.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, width = 'max-w-3xl', actions }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: string; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={cn('relative flex h-full w-full flex-col bg-white shadow-pop', width)}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('relative w-full rounded-2xl bg-white p-6 shadow-pop', width)}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Code({ children, className }: { children: string; className?: string }) {
  return <pre className={cn('scrollbar-thin overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100', className)}>{children}</pre>;
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return <pre className={cn('scrollbar-thin max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700', className)}>{JSON.stringify(value, null, 2)}</pre>;
}

export function KeyValue({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
          <dt className="text-slate-500">{it.label}</dt>
          <dd className="truncate text-right font-medium text-slate-800">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
