import type { Credit } from '@syntro/engine';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHANNEL_COLOR, CHANNEL_LABEL, fmtMoney, fmtPct } from '@/lib/format.ts';
import { cn } from './ui.tsx';

export function TrendChart({ data }: { data: { name: string; accuracy: number | null; passed: number; failed: number }[] }) {
  if (!data.length) return <div className="flex h-56 items-center justify-center text-sm text-slate-400">No completed simulations yet.</div>;
  const rows = data.map((d) => ({ ...d, accuracyPct: d.accuracy == null ? null : Math.round(d.accuracy * 100) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} tickFormatter={(v: string) => (v.length > 14 ? v.slice(0, 13) + '…' : v)} />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(value: number, name: string) => (name === 'Attribution accuracy' ? [`${value}%`, name] : [value, name])} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="left" dataKey="passed" name="Tests passed" stackId="t" fill="#10b981" radius={[0, 0, 4, 4]} />
        <Bar yAxisId="left" dataKey="failed" name="Tests failed" stackId="t" fill="#f43f5e" radius={[4, 4, 0, 0]} />
        <Line yAxisId="right" type="monotone" dataKey="accuracyPct" name="Attribution accuracy" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBars({ data, color = '#4f46e5', emptyLabel = 'Nothing to show' }: { data: { label: string; value: number; color?: string }[]; color?: string; emptyLabel?: string }) {
  if (!data.length) return <div className="py-6 text-center text-sm text-slate-400">{emptyLabel}</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="truncate font-medium text-slate-700">{d.label}</span>
            <span className="ml-3 tabular-nums text-slate-500">{d.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, (d.value / max) * 100)}%`, background: d.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CreditChips({ credits, muted }: { credits: Credit[] | null; muted?: boolean }) {
  if (!credits) return <span className="text-xs text-slate-400">no result</span>;
  if (!credits.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {credits.map((c, i) => (
        <span key={i} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs', muted ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white text-slate-700')}>
          <span className="h-2 w-2 rounded-full" style={{ background: CHANNEL_COLOR[c.channel] ?? '#94a3b8' }} />
          <span className="font-medium">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
          {c.campaignId !== '(none)' && <span className="text-slate-400">{c.campaignId}</span>}
          <span className="tabular-nums">{fmtMoney(c.credit)}</span>
          <span className="tabular-nums text-slate-400">{fmtPct(c.share)}</span>
        </span>
      ))}
    </div>
  );
}

export function CreditBar({ credits }: { credits: Credit[] | null }) {
  if (!credits || !credits.length) return <div className="h-2 w-full rounded-full bg-slate-100" />;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      {credits.map((c, i) => (
        <div key={i} style={{ width: `${Math.max(2, c.share * 100)}%`, background: CHANNEL_COLOR[c.channel] ?? '#94a3b8' }} title={`${CHANNEL_LABEL[c.channel]} ${fmtPct(c.share)}`} />
      ))}
    </div>
  );
}

export function ChannelDot({ channel }: { channel: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CHANNEL_COLOR[channel as keyof typeof CHANNEL_COLOR] ?? '#94a3b8' }} />;
}
