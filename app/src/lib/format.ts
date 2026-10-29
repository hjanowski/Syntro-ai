import type { Channel, TestStatus } from '@syntro/engine';

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—';
  return `$${v.toFixed(2)}`;
}

export function fmtNumber(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString();
}

export function fmtTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtClock(iso: string | undefined | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—';
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(startIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email',
  meta: 'Meta Ads',
  google: 'Google Ads',
  linkedin: 'LinkedIn Ads',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  direct: 'Direct',
  referral: 'Referral',
  unknown: 'Unknown',
};

export const CHANNEL_COLOR: Record<Channel, string> = {
  email: '#0ea5e9',
  meta: '#2563eb',
  google: '#f59e0b',
  linkedin: '#0a66c2',
  sms: '#10b981',
  whatsapp: '#22c55e',
  direct: '#94a3b8',
  referral: '#a855f7',
  unknown: '#64748b',
};

export function statusTone(status: TestStatus | string): 'success' | 'danger' | 'warning' | 'neutral' | 'info' {
  switch (status) {
    case 'pass':
    case 'completed':
      return 'success';
    case 'fail':
    case 'failed':
      return 'danger';
    case 'inconclusive':
    case 'stopped':
    case 'awaiting_results':
      return 'warning';
    case 'running':
    case 'finalizing':
    case 'queued':
      return 'info';
    default:
      return 'neutral';
  }
}

export function humanize(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function modelName(model: string): string {
  return model === 'first_touch' ? 'First-touch' : model === 'last_touch' ? 'Last-touch' : model === 'linear' ? 'Linear' : humanize(model);
}
