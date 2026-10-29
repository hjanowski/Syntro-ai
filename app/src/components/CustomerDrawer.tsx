import { NODE_CATEGORY, type CollectedEvent, type CustomerDetail, type ExecutedAction, type TestResult } from '@syntro/engine';
import { Cookie, Globe, Megaphone, Monitor, Radio, ShoppingBag, Smartphone, Tablet, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useEngine } from '@/engine/provider.tsx';
import { useAsync } from '@/engine/hooks.ts';
import { fmtClock, fmtMoney, modelName } from '@/lib/format.ts';
import { CreditChips, ChannelDot } from './charts.tsx';
import { EvidenceList, FailureDiagnosticView, TestRow } from './Evidence.tsx';
import { Badge, Drawer, ErrorBanner, JsonBlock, KeyValue, Loading, StatusPill, Tabs, cn } from './ui.tsx';

type Tab = 'timeline' | 'events' | 'attribution' | 'tests' | 'identity';

export function CustomerDrawer({ customerId, tests, onClose }: { customerId: string | null; tests?: TestResult[]; onClose: () => void }) {
  const { client } = useEngine();
  const { data, error, loading } = useAsync(() => (customerId ? client.getCustomer(customerId) : Promise.resolve(null)), [customerId], { poll: 2000 });
  const [tab, setTab] = useState<Tab>('timeline');
  const [openTest, setOpenTest] = useState<TestResult | null>(null);
  const customer = data?.customer;
  const customerTests = useMemo(() => tests?.filter((t) => t.customerId === customerId) ?? [], [tests, customerId]);

  return (
    <Drawer open={!!customerId} onClose={onClose} title={customer ? `${customer.firstName} ${customer.lastName}` : 'Synthetic customer'} subtitle={customer ? `${customer.email} · #${customer.index} · ${customer.device.kind} (${customer.device.browser})` : undefined} actions={customer && <StatusPill status={customer.status} pulse />}>
      <ErrorBanner message={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: 'timeline', label: 'Journey timeline', count: data.ledger?.executed.length ?? 0 },
              { value: 'events', label: 'Tracked events', count: data.events.length },
              { value: 'attribution', label: 'Attribution', count: data.attributionResults.length },
              { value: 'tests', label: 'Tests', count: customerTests.length },
              { value: 'identity', label: 'Identity & sessions', count: data.customer.sessions.length },
            ]}
          />
          {tab === 'timeline' && <Timeline detail={data} />}
          {tab === 'events' && <EventsTable events={data.events} />}
          {tab === 'attribution' && <AttributionView detail={data} />}
          {tab === 'tests' && (
            <div className="space-y-2">
              {customerTests.length === 0 && <p className="text-sm text-slate-500">No validation results for this customer yet.</p>}
              {customerTests.map((t) => (
                <TestRow key={t.id} test={t} onOpen={t.failure ? () => setOpenTest(t) : undefined} />
              ))}
            </div>
          )}
          {tab === 'identity' && <IdentityView detail={data} />}
        </>
      )}
      <Drawer open={!!openTest} onClose={() => setOpenTest(null)} title={openTest?.name ?? ''} subtitle="Failure investigation" width="max-w-2xl">
        {openTest?.failure && <FailureDiagnosticView failure={openTest.failure} test={openTest} />}
      </Drawer>
    </Drawer>
  );
}

function DeviceIcon({ kind, className }: { kind: string; className?: string }) {
  const cls = cn('h-4 w-4', className);
  return kind === 'mobile' ? <Smartphone className={cls} /> : kind === 'tablet' ? <Tablet className={cls} /> : <Monitor className={cls} />;
}

type TimelineItem = { ts: string; kind: 'action'; action: ExecutedAction } | { ts: string; kind: 'event'; event: CollectedEvent };

function Timeline({ detail }: { detail: CustomerDetail }) {
  const items = useMemo<TimelineItem[]>(() => {
    const actions: TimelineItem[] = (detail.ledger?.executed ?? []).map((a) => ({ ts: a.virtualTs, kind: 'action', action: a }));
    const events: TimelineItem[] = detail.events.map((e) => ({ ts: e.ts, kind: 'event', event: e }));
    return [...actions, ...events].sort((a, b) => a.ts.localeCompare(b.ts) || (a.kind === 'action' ? -1 : 1));
  }, [detail]);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!items.length) return <p className="text-sm text-slate-500">Nothing executed yet.</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        <Stat label="Steps executed" value={`${detail.ledger?.executed.filter((a) => a.status === 'ok').length ?? 0}/${detail.ledger?.intended.length ?? 0}`} />
        <Stat label="Touchpoints" value={String(detail.ledger?.touchpoints.length ?? 0)} />
        <Stat label="Conversions" value={detail.ledger?.conversions.map((c) => fmtMoney(c.value)).join(', ') || '—'} />
      </div>
      <ol className="relative border-l border-slate-200 pl-6">
        {items.map((item, i) => {
          const key = item.kind === 'action' ? item.action.id : item.event.id;
          const isOpen = expanded === key;
          if (item.kind === 'event') {
            const e = item.event;
            const isConversion = ['purchase', 'lead', 'signup'].includes(e.eventType);
            return (
              <li key={key} className="relative mb-2">
                <span className={cn('absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white', isConversion ? 'bg-emerald-500' : 'bg-sky-400')} />
                <button onClick={() => setExpanded(isOpen ? null : key)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-slate-50">
                  <Radio className="h-3.5 w-3.5 text-sky-500" />
                  <span className="font-medium text-slate-700">Tracked: {e.eventType}</span>
                  {e.utm.utm_source && <Badge tone="info">{e.utm.utm_source}{e.utm.utm_campaign ? ` · ${e.utm.utm_campaign}` : ''}</Badge>}
                  {Object.keys(e.clickIds).length > 0 && <Badge tone="neutral">{Object.keys(e.clickIds).join(', ')}</Badge>}
                  {e.revenue != null && <Badge tone="success">{fmtMoney(e.revenue)}</Badge>}
                  {e.faultsApplied.length > 0 && <Badge tone="warning">{e.faultsApplied.join(', ')}</Badge>}
                  {e.delivery.duplicateOf && <Badge tone="danger">duplicate</Badge>}
                  <span className="ml-auto tabular-nums text-slate-400">{fmtClock(e.ts)}</span>
                </button>
                {isOpen && <JsonBlock className="mt-1" value={{ anonymous_id: e.anonymousId, session_id: e.sessionId, url: e.url, referrer: e.referrer, utm: e.utm, click_ids: e.clickIds, revenue: e.revenue, order_id: e.orderId, user_key: e.userKey, delivery: e.delivery, props: e.props }} />}
              </li>
            );
          }
          const a = item.action;
          const category = NODE_CATEGORY[a.type];
          const Icon = category === 'marketing' ? Megaphone : category === 'website' ? Globe : a.type === 'clear_cookies' ? Cookie : a.type === 'change_device' ? Smartphone : Workflow;
          const isConversion = a.details.conversionId !== undefined;
          return (
            <li key={key} className={cn('relative mb-3', i > 0 && 'mt-3')}>
              <span className={cn('absolute -left-[35px] top-1 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white', a.status === 'failed' ? 'bg-rose-500 text-white' : isConversion ? 'bg-emerald-500 text-white' : category === 'marketing' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-white')}>
                {isConversion ? <ShoppingBag className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </span>
              <button onClick={() => setExpanded(isOpen ? null : key)} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{a.label}</span>
                    {a.details.channel ? <ChannelDot channel={String(a.details.channel)} /> : null}
                    {a.status === 'failed' && <Badge tone="danger">failed</Badge>}
                    {a.details.faultApplied ? <Badge tone="warning">{String(a.details.faultApplied)}</Badge> : null}
                    {isConversion && <Badge tone="success">{fmtMoney(Number(a.details.total ?? a.details.value ?? 0))}</Badge>}
                    {a.attempts > 1 && <Badge tone="neutral">{a.attempts} attempts</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {a.details.landingUrl ? `Landed on ${shortUrl(String(a.details.landingUrl))}` : a.details.url ? shortUrl(String(a.details.url)) : a.error ?? String(a.details.note ?? '')}
                  </div>
                </div>
                <span className="text-[11px] tabular-nums text-slate-400">{fmtClock(a.virtualTs)}</span>
              </button>
              {isOpen && (
                <div className="mt-2 space-y-2 pl-1">
                  {a.error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{a.error}</div>}
                  {Object.keys(a.details).length > 0 && <JsonBlock value={a.details} />}
                  <EvidenceList evidence={a.evidence} compact />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function EventsTable({ events }: { events: CollectedEvent[] }) {
  if (!events.length) return <p className="text-sm text-slate-500">No events reached the collector for this customer.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Event</th>
            <th className="px-3 py-2">Anonymous id</th>
            <th className="px-3 py-2">Campaign</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Delivery</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t border-slate-100">
              <td className="px-3 py-2 tabular-nums text-slate-500">{fmtClock(e.ts)}</td>
              <td className="px-3 py-2 font-medium text-slate-800">{e.eventType}{e.userKey && e.eventType === 'identify' ? ' ✓' : ''}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{e.anonymousId}</td>
              <td className="px-3 py-2 text-slate-600">{e.utm.utm_source ? `${e.utm.utm_source} · ${e.utm.utm_campaign ?? '—'}` : Object.keys(e.clickIds).length ? Object.keys(e.clickIds).join(', ') : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{e.revenue != null ? fmtMoney(e.revenue) : '—'}</td>
              <td className="px-3 py-2">
                {e.delivery.duplicateOf ? <Badge tone="danger">duplicate</Badge> : !e.delivery.deliveredToSut ? <Badge tone="warning">delayed</Badge> : <Badge tone="success">delivered</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttributionView({ detail }: { detail: CustomerDetail }) {
  const ledger = detail.ledger;
  if (!ledger) return <p className="text-sm text-slate-500">No ledger.</p>;
  if (!ledger.conversions.length) return <p className="text-sm text-slate-500">This journey has no conversion, so no attribution is expected.</p>;
  return (
    <div className="space-y-6">
      {ledger.conversions.map((c) => (
        <div key={c.id} className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">
              {c.eventType} {c.orderId ?? ''} · {fmtMoney(c.value)}
            </div>
            <span className="text-xs text-slate-500">{fmtClock(c.ts)}</span>
          </div>
          <div className="space-y-3">
            {ledger.expectedAttribution
              .filter((e) => e.conversionId === c.id)
              .map((exp) => {
                const actual = detail.attributionResults.find((r) => r.model === exp.model && (c.orderId ? r.conversion.orderId === c.orderId : r.conversion.type === c.eventType));
                return (
                  <div key={exp.model} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[120px_1fr]">
                    <div className="text-xs font-semibold text-slate-700">{modelName(exp.model)}</div>
                    <div className="space-y-2">
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">Expected (reference model)</div>
                        <CreditChips credits={exp.credits} />
                        {exp.note && <div className="mt-1 text-[11px] text-slate-500">{exp.note}</div>}
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">Actual (attribution system)</div>
                        <CreditChips credits={actual?.credits ?? null} />
                      </div>
                      {actual && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-slate-500">Journey considered by the attribution system ({actual.journey.length} touchpoints · identity {actual.identity.anonymousIds.length} ids)</summary>
                          <JsonBlock className="mt-1" value={{ identity: actual.identity, journey: actual.journey }} />
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function IdentityView({ detail }: { detail: CustomerDetail }) {
  const c = detail.customer;
  const identity = detail.ledger?.identity;
  return (
    <div className="space-y-6">
      <KeyValue
        items={[
          { label: 'Synthetic customer id', value: <span className="font-mono text-xs">{c.id}</span> },
          { label: 'Email (non-deliverable)', value: c.email },
          { label: 'Phone (fictional range)', value: c.phone },
          { label: 'Primary device', value: `${c.device.kind} · ${c.device.os} · ${c.device.browser}` },
          { label: 'Persona', value: String(c.attributes.persona ?? '—') },
          { label: 'Region', value: String(c.attributes.region ?? '—') },
          { label: 'Stitching required', value: identity?.stitchRequired ? 'Yes — cross-cookie identity' : 'No' },
          { label: 'Link groups', value: identity ? identity.linkGroups.map((g) => g.length).join(' + ') + ' jar(s)' : '—' },
        ]}
      />
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Sessions</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Session</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Cookie jar</th>
                <th className="px-3 py-2">Started (virtual)</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Identified</th>
              </tr>
            </thead>
            <tbody>
              {c.sessions.map((s) => {
                const ident = identity?.sessions.find((x) => x.sessionId === s.id)?.identifiedWithEmail;
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-[11px]">{s.id}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <DeviceIcon kind={s.device.kind} className="text-slate-400" /> {s.device.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{s.cookieJarId}</td>
                    <td className="px-3 py-2 tabular-nums">{new Date(s.virtualStartedAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{s.reason.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2">{ident ? <Badge tone="success">email</Badge> : <Badge tone="neutral">anonymous</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {detail.platformRecords.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Synthetic platform records ({detail.platformRecords.length})</div>
          <JsonBlock value={detail.platformRecords.map((r) => ({ kind: r.kind, channel: r.channel, campaign: r.campaignId, clickId: r.clickId, segmentId: r.segmentId, ts: r.ts }))} />
        </div>
      )}
      {detail.collectorLog.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Collector log</div>
          <ul className="space-y-1 text-xs">
            {detail.collectorLog.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <Badge tone={l.kind === 'accepted' ? 'success' : l.kind === 'rejected' || l.kind === 'dropped' ? 'danger' : 'warning'}>{l.kind}</Badge>
                <span className="font-medium text-slate-700">{l.eventType}</span>
                <span className="text-slate-500">{l.reason}</span>
                <span className="ml-auto tabular-nums text-slate-400">{fmtClock(l.ts)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').pop();
    const id = u.searchParams.get('id');
    const src = u.searchParams.get('utm_source');
    return `${file}${id ? `?id=${id}` : ''}${src ? ` · utm_source=${src}` : ''}`;
  } catch {
    return url;
  }
}
