import { useState } from 'react';
import { useEngine, type EnginePreference } from '@/engine/provider.tsx';
import { clearEmbeddedStorage } from '@/engine/embedded-engine.ts';
import { Badge, Button, Card, CardTitle, Field, InfoBanner, Input, KeyValue, PageHeader, Select } from '@/components/ui.tsx';

export default function Settings() {
  const { client, info, preference, setPreference, resolvedFrom, embeddedWarning } = useEngine();
  const [pref, setPref] = useState<EnginePreference>(preference);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const apply = () => {
    setPreference(pref);
    window.location.reload();
  };

  const reset = async () => {
    if (!confirm('Delete every project, journey, scenario, run and result? This cannot be undone.')) return;
    setResetting(true);
    try {
      await client.resetAll();
      if (client.mode === 'embedded') clearEmbeddedStorage();
      setMessage('All data was removed.');
      setTimeout(() => window.location.assign(import.meta.env.BASE_URL), 600);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Engine connection, data, and what is real versus simulated in this prototype." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle hint={resolvedFrom}>Engine connection</CardTitle>
          {info && (
            <KeyValue
              items={[
                { label: 'Mode', value: <Badge tone={client.mode === 'remote' ? 'brand' : 'violet'}>{client.mode === 'remote' ? 'Remote Node engine' : 'Embedded in browser'}</Badge> },
                { label: 'Driver', value: info.driver },
                { label: 'Screenshots', value: info.capabilities.screenshots ? 'yes' : 'no (DOM snapshots)' },
                { label: 'Browser isolation', value: info.capabilities.realBrowserIsolation ? 'real contexts' : 'sandboxed iframes' },
                { label: 'Collector', value: info.collectorEndpoint },
                { label: 'Demo sites', value: info.siteBaseUrl },
              ]}
            />
          )}
          <div className="mt-5 space-y-3">
            <Field label="Preferred engine">
              <Select value={pref.mode} onChange={(e) => setPref({ ...pref, mode: e.target.value as EnginePreference['mode'] })}>
                <option value="auto">Auto — use the Node engine when this page is served by it, otherwise embedded</option>
                <option value="embedded">Embedded — run the engine in this browser tab</option>
                <option value="remote">Remote — connect to a Node engine URL</option>
              </Select>
            </Field>
            {pref.mode === 'remote' && (
              <Field label="Engine URL" hint="e.g. http://localhost:4100">
                <Input value={pref.url} onChange={(e) => setPref({ ...pref, url: e.target.value })} placeholder="http://localhost:4100" />
              </Field>
            )}
            <Button onClick={apply}>Apply and reload</Button>
            <InfoBanner>
              <span className="text-xs">
                The embedded engine executes journeys in sandboxed iframes inside this tab — ideal for the hosted demo. The Node engine (<code>npm run dev</code>) uses real headless Chromium through Playwright with screenshots and real cookie jars. Connecting a hosted page to <code>localhost</code> requires the browser to allow local network access.
              </span>
            </InfoBanner>
            {embeddedWarning && <InfoBanner tone="warning"><span className="text-xs">{embeddedWarning}</span></InfoBanner>}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle>Data</CardTitle>
            <p className="text-sm text-slate-600">{client.mode === 'embedded' ? 'Projects, runs and results are stored in this browser (localStorage).' : 'Data is stored by the Node engine in server/data as JSON files.'}</p>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="danger" onClick={reset} loading={resetting}>
                Reset all data
              </Button>
              {message && <span className="text-sm text-slate-500">{message}</span>}
            </div>
          </Card>
          <Card>
            <CardTitle>What is real, simulated, or not yet implemented</CardTitle>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Badge tone="success">Real</Badge> Browser execution, website SDK, signed synthetic tokens, event collection, ground truth ledger, reference model, local attribution system, validation and diagnostics.</li>
              <li><Badge tone="warning">Simulated</Badge> Meta, Google, LinkedIn, email, SMS and WhatsApp environments are Syntro mocks that reproduce click-through behaviour and synthetic click ids — not the real platforms or their APIs.</li>
              <li><Badge tone="warning">Prototype</Badge> Generic file and HTTP attribution adapters, GTM template, external-website mode.</li>
              <li><Badge tone="neutral">Not implemented</Badge> Vendor adapters (Salesforce, Adobe), LLM-driven navigation of unfamiliar websites, PostgreSQL storage, multi-tenant auth.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
