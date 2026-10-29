import { describe, expect, it } from 'vitest';
import { SessionTokenService } from '../src/tokens/session-token.ts';
import { generateCustomers, SYNTHETIC_EMAIL_DOMAIN } from '../src/customers/generate.ts';
import { JOURNEY_TEMPLATES, SCENARIO_PRESETS, getTemplate, instantiateTemplate } from '../src/journeys/templates.ts';
import { linearize, validateJourney } from '../src/journeys/graph.ts';
import { NODE_CATALOG, NODE_TYPES } from '../src/journeys/node-catalog.ts';
import { buildLandingUrl, buildChannelPageUrl, extractTrackingParams } from '../src/channels/urls.ts';
import { computeLinkGroups } from '../src/ledger/expectations.ts';
import { MemoryStore } from '../src/store/store.ts';
import { EventCollector } from '../src/collector/collector.ts';

describe('session tokens', () => {
  const tokens = new SessionTokenService('secret');
  const payload = { p: 'proj', r: 'run', s: 'scn', c: 'cust', sid: 'sess', col: 'postmessage', off: 0 };

  it('mints and verifies', async () => {
    const token = await tokens.mint(payload);
    const verified = await tokens.verify(token);
    expect(verified).toMatchObject(payload);
    expect(SessionTokenService.peek(token)?.c).toBe('cust');
  });

  it('rejects tampered, foreign and expired tokens', async () => {
    const token = await tokens.mint(payload);
    const [body, sig] = token.split('.');
    await expect(tokens.verify(`${body}x.${sig}`)).rejects.toThrow(/signature/);
    await expect(new SessionTokenService('other').verify(token)).rejects.toThrow(/signature/);
    const expired = await tokens.mint({ ...payload, exp: Date.now() - 1000 });
    await expect(tokens.verify(expired)).rejects.toThrow(/expired/);
  });
});

describe('synthetic customers', () => {
  it('are deterministic per seed and never contactable', () => {
    const a = generateCustomers({ runId: 'r', projectId: 'p', scenarioId: 's', journeyId: 'j', count: 5, seed: 42 });
    const b = generateCustomers({ runId: 'r', projectId: 'p', scenarioId: 's', journeyId: 'j', count: 5, seed: 42 });
    expect(a.map((c) => c.email)).toEqual(b.map((c) => c.email));
    for (const c of a) {
      expect(c.email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
      expect(c.email).toMatch(/\.invalid$/);
      expect(c.phone).toMatch(/^\+1 555 01\d\d$/);
      expect(c.device.userAgent).toContain('Syntro-Synthetic');
    }
  });

  it('clamps population size to 1..100', () => {
    expect(generateCustomers({ runId: 'r', projectId: 'p', scenarioId: 's', journeyId: 'j', count: 500, seed: 1 })).toHaveLength(100);
    expect(generateCustomers({ runId: 'r', projectId: 'p', scenarioId: 's', journeyId: 'j', count: 0, seed: 1 })).toHaveLength(1);
  });
});

describe('journey templates and graph', () => {
  it('every template is a valid graph and every preset references a template', () => {
    for (const t of JOURNEY_TEMPLATES) {
      const v = validateJourney(t);
      expect(v.errors, t.key).toEqual([]);
    }
    for (const p of SCENARIO_PRESETS) expect(getTemplate(p.journeyTemplateKey), p.key).toBeDefined();
  });

  it('branches deterministically on customer index', () => {
    const journey = instantiateTemplate(getTemplate('branching_meta_or_google')!, 'p');
    const [even, odd] = generateCustomers({ runId: 'r', projectId: 'p', scenarioId: 's', journeyId: journey.id, count: 2, seed: 3, startIndex: 2 });
    const evenPath = linearize(journey, even).map((s) => s.label);
    const oddPath = linearize(journey, odd).map((s) => s.label);
    expect(evenPath.some((l) => l.includes('meta'))).toBe(true);
    expect(oddPath.some((l) => l.includes('google'))).toBe(true);
  });

  it('catalog covers every node type', () => {
    for (const type of NODE_TYPES) expect(NODE_CATALOG[type].label).toBeTruthy();
    expect(validateJourney({ nodes: [], edges: [] }).valid).toBe(false);
  });
});

describe('simulated channel URLs', () => {
  const campaign = { channel: 'meta' as const, campaignId: 'fb_1', creativeId: 'cr', landingPath: 'cart.html' };

  it('carries intended UTMs, the token and a synthetic click id', () => {
    const landing = buildLandingUrl('http://x/sites/store', campaign, 'tok.sig', []);
    const { utm } = extractTrackingParams(landing.url);
    expect(utm).toMatchObject({ utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'fb_1', utm_content: 'cr' });
    expect(landing.url).toContain('syntro_token=tok.sig');
    expect(landing.clickIdParam).toBe('fbclid');
    const page = buildChannelPageUrl({ siteBaseUrl: 'http://x/sites', campaign, destination: landing, customerFirstName: 'Sarah' });
    expect(page).toContain('/channels/meta.html');
    expect(page).toContain('click_param=fbclid');
  });

  it('applies destination-configuration faults', () => {
    const missing = buildLandingUrl('http://x/sites/store', campaign, 't', [{ kind: 'missing_utm', channel: 'meta' }]);
    expect(Object.keys(missing.observedUtm)).toEqual([]);
    expect(missing.faultApplied).toBe('missing_utm');
    const wrong = buildLandingUrl('http://x/sites/store', campaign, 't', [{ kind: 'wrong_campaign_param', channel: 'meta', campaignId: 'OLD' }]);
    expect(wrong.observedUtm.utm_campaign).toBe('OLD');
    expect(wrong.intendedUtm.utm_campaign).toBe('fb_1');
  });
});

describe('expected identity link groups', () => {
  it('links cookie jars only through identified sessions', () => {
    const groups = computeLinkGroups([
      { sessionId: 's1', cookieJarId: 'A', contextId: 'c1', identifiedWithEmail: false },
      { sessionId: 's2', cookieJarId: 'B', contextId: 'c2', identifiedWithEmail: true },
      { sessionId: 's3', cookieJarId: 'C', contextId: 'c3', identifiedWithEmail: true },
    ]);
    expect(groups.map((g) => g.sort())).toContainEqual(['A']);
    expect(groups.map((g) => g.sort())).toContainEqual(['B', 'C']);
  });
});

describe('event collector', () => {
  it('accepts signed events, binds them to the customer and applies tracking faults', async () => {
    const store = new MemoryStore();
    const tokens = new SessionTokenService('secret');
    const collector = new EventCollector(store, tokens);
    const customer = generateCustomers({ runId: 'run1', projectId: 'p', scenarioId: 's', journeyId: 'j', count: 1, seed: 1 })[0];
    customer.activeFaults = [{ kind: 'drop_events', eventTypes: ['add_to_cart'] }, { kind: 'duplicate_events', eventTypes: ['purchase'] }, { kind: 'delay_events', eventTypes: ['lead'], delayMs: 60_000 }];
    store.customers.put(customer);
    const token = await tokens.mint({ p: 'p', r: 'run1', s: 's', c: customer.id, sid: 'sess1', col: 'postmessage', off: 0 });
    const base = { url: 'http://store/x', path: '/x', referrer: '', anonymous_id: 'anon1', ts: new Date().toISOString() };
    const res = await collector.collect({
      token,
      events: [
        { ...base, event_id: '1', type: 'page_view', utm: { utm_source: 'google' } },
        { ...base, event_id: '2', type: 'add_to_cart' },
        { ...base, event_id: '3', type: 'purchase', props: { order_id: 'ORD-1', revenue: 120 }, user: { email: customer.email } },
        { ...base, event_id: '4', type: 'lead', props: { value: 25 } },
      ],
    });
    expect(res.accepted).toBe(4);
    const events = store.events.list();
    expect(events.filter((e) => e.eventType === 'add_to_cart')).toHaveLength(0);
    expect(events.filter((e) => e.eventType === 'purchase')).toHaveLength(2);
    expect(events.find((e) => e.eventType === 'lead')?.delivery).toMatchObject({ delayMs: 60_000, deliveredToSut: false });
    const purchase = events.find((e) => e.eventType === 'purchase' && !e.delivery.duplicateOf)!;
    expect(purchase).toMatchObject({ syntheticCustomerId: customer.id, runId: 'run1', sessionId: 'sess1', isSynthetic: true, revenue: 120, orderId: 'ORD-1' });
    expect(purchase.userKey).toHaveLength(64);
    expect(store.collectorLog.list((l) => l.kind === 'dropped')).toHaveLength(1);
  });

  it('rejects unsigned or foreign tokens', async () => {
    const store = new MemoryStore();
    const collector = new EventCollector(store, new SessionTokenService('secret'));
    await expect(collector.collect({ token: 'nope.nope', events: [] })).rejects.toMatchObject({ status: 401 });
    const foreign = await new SessionTokenService('other').mint({ p: 'p', r: 'r', s: 's', c: 'c', sid: 'x', col: 'postmessage', off: 0 });
    await expect(collector.collect({ token: foreign, events: [] })).rejects.toMatchObject({ status: 401 });
  });
});
