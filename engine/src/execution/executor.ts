import { buildChannelPageUrl, buildLandingUrl, CHANNEL_META, extractTrackingParams, storeUrl } from '../channels/urls.ts';
import { deviceProfileFor } from '../customers/generate.ts';
import type {
  CampaignConfig,
  Channel,
  DeviceKind,
  DeviceProfile,
  Evidence,
  ExecutedAction,
  GroundTruthConversion,
  JourneyDefinition,
  JourneyNode,
  LedgerEntry,
  Project,
  Scenario,
  ScenarioFault,
  SimulationRun,
  SyntheticCustomer,
  SyntheticSession,
} from '../domain/types.ts';
import { getStartNode, nextNodeId, nodeLabel, linearize } from '../journeys/graph.ts';
import { computeExpectedAttribution, computeExpectedIdentity } from '../ledger/expectations.ts';
import { platformRecord } from '../attribution/platform-feed.ts';
import type { Store } from '../store/store.ts';
import type { SessionTokenService } from '../tokens/session-token.ts';
import { sha256Hex } from '../util/encoding.ts';
import { randomId } from '../util/ids.ts';
import { Rng } from '../util/rng.ts';
import { DAY_MS, HOUR_MS, nowIso, sleep, VirtualClock } from '../util/time.ts';
import type { EngineConfig, EngineLogger } from './config.ts';
import type { BrowserContextHandle, BrowserDriver } from './driver.ts';

export interface ExecutionJob {
  run: SimulationRun;
  project: Project;
  scenario: Scenario;
  journey: JourneyDefinition;
  customer: SyntheticCustomer;
  driver: BrowserDriver;
  shouldStop: () => boolean;
}

export interface ExecutorDeps {
  store: Store;
  tokens: SessionTokenService;
  config: EngineConfig;
  logger: EngineLogger;
}

/** Executes one synthetic customer's journey in an isolated browser context and writes the ground truth ledger. */
export class JourneyExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  execute(job: ExecutionJob): Promise<LedgerEntry> {
    return new CustomerExecution(job, this.deps).run();
  }
}

const TRACKING_FAULT_KINDS = new Set(['drop_events', 'duplicate_events', 'delay_events']);

class CustomerExecution {
  private ctx: BrowserContextHandle | null = null;
  private contextId = randomId('ctx');
  private cookieJarId = randomId('jar');
  private session!: SyntheticSession;
  private token = '';
  private readonly clock = new VirtualClock();
  private readonly identifiedSessions = new Set<string>();
  private readonly rng: Rng;
  private device: DeviceProfile;
  private ledger!: LedgerEntry;
  private readonly store: Store;
  private readonly logCtx: { runId: string; customerId: string };

  constructor(
    private readonly job: ExecutionJob,
    private readonly deps: ExecutorDeps,
  ) {
    this.store = deps.store;
    this.device = { ...job.customer.device };
    this.rng = new Rng(`${job.run.seed}:${job.customer.id}:plan`);
    this.logCtx = { runId: job.run.id, customerId: job.customer.id };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async run(): Promise<LedgerEntry> {
    const { customer, journey, scenario, run, project } = this.job;
    const ts = nowIso();
    this.ledger = {
      id: randomId('ledger'),
      runId: run.id,
      projectId: project.id,
      customerId: customer.id,
      scenarioId: scenario.id,
      journeyId: journey.id,
      intended: linearize(journey, customer, run.seed),
      executed: [],
      touchpoints: [],
      impressions: [],
      conversions: [],
      identity: { email: customer.email, sessions: [], linkGroups: [], stitchRequired: false },
      expectedAttribution: [],
      faults: scenario.faults,
      segments: [],
      status: 'in_progress',
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.ledger.put(this.ledger);

    customer.status = 'running';
    customer.startedAt = ts;
    customer.sessions = [];
    customer.activeFaults = scenario.faults.filter((f) => TRACKING_FAULT_KINDS.has(f.kind));
    this.saveCustomer();
    this.log('info', `Starting journey "${journey.name}" for ${customer.firstName} ${customer.lastName}`, { scenario: scenario.name, device: this.device.kind });

    try {
      await this.startSession('initial');
      const byId = new Map(journey.nodes.map((n) => [n.id, n]));
      let node = getStartNode(journey);
      let guard = 0;
      let outcome: 'completed' | 'failed' | 'stopped' = 'completed';

      while (node && guard++ < 200) {
        if (this.job.shouldStop()) {
          outcome = 'stopped';
          break;
        }
        customer.currentStep = nodeLabel(node);
        this.saveCustomer();
        const status = await this.executeNode(node);
        if (status === 'failed') {
          outcome = 'failed';
          break;
        }
        if (node.type === 'end') break;
        const nextId = nextNodeId(journey, node, customer, this.rng);
        node = nextId ? byId.get(nextId) : undefined;
      }

      if (outcome === 'completed') await this.isolationCheck();

      this.ledger.identity = computeExpectedIdentity(customer, this.identifiedSessions);
      this.ledger.expectedAttribution = computeExpectedAttribution(this.ledger, project.attributionPolicy);
      this.ledger.status = outcome === 'completed' ? 'complete' : 'incomplete';
      customer.status = outcome;
      customer.currentStep = undefined;
      customer.finishedAt = nowIso();
      this.log(outcome === 'completed' ? 'info' : 'warn', `Journey ${outcome}`, { touchpoints: this.ledger.touchpoints.length, conversions: this.ledger.conversions.length });
    } catch (e) {
      const err = e as Error;
      this.ledger.identity = computeExpectedIdentity(customer, this.identifiedSessions);
      this.ledger.expectedAttribution = computeExpectedAttribution(this.ledger, project.attributionPolicy);
      this.ledger.status = 'incomplete';
      customer.status = 'failed';
      customer.error = err.message;
      customer.finishedAt = nowIso();
      this.log('error', `Journey aborted: ${err.message}`);
    } finally {
      this.ledger.updatedAt = nowIso();
      this.store.ledger.put(this.ledger);
      this.saveCustomer();
      await this.closeContext();
    }
    return this.ledger;
  }

  private async executeNode(node: JourneyNode): Promise<'ok' | 'failed'> {
    const action: ExecutedAction = {
      id: randomId('act'),
      nodeId: node.id,
      type: node.type,
      label: nodeLabel(node),
      status: 'ok',
      attempts: 1,
      startedAt: nowIso(),
      finishedAt: '',
      virtualTs: this.clock.nowIso(),
      sessionId: this.session?.id,
      details: {},
      evidence: [],
    };
    try {
      await this.perform(node, action);
      action.status = 'ok';
    } catch (e) {
      const err = e as Error;
      action.status = 'failed';
      action.error = err.message;
      this.log('error', `Step failed: ${action.label} — ${err.message}`, { nodeId: node.id });
      await this.captureEvidence(action, { screenshot: true, label: 'State at failure' }).catch(() => undefined);
    }
    action.finishedAt = nowIso();
    action.sessionId = this.session?.id;
    this.ledger.executed.push(action);
    this.ledger.updatedAt = action.finishedAt;
    this.store.ledger.put(this.ledger);
    return action.status === 'ok' ? 'ok' : 'failed';
  }

  // -------------------------------------------------------------------------
  // Node dispatch
  // -------------------------------------------------------------------------

  private async perform(node: JourneyNode, action: ExecutedAction): Promise<void> {
    const c = node.config ?? {};
    switch (node.type) {
      case 'start':
      case 'end':
        return;
      case 'branch':
        action.details.condition = c.condition;
        return;
      case 'email_open':
      case 'ad_view':
      case 'message_receive':
        return this.marketingImpression(node, action);
      case 'email_click':
      case 'ad_click':
      case 'message_click':
        return this.marketingClick(node, action);
      case 'enter_segment':
        return this.enterSegment(node, action);
      case 'visit_page':
        return this.gotoStore(str(c.path) ?? 'index.html', action);
      case 'navigate':
        if (str(c.path)) return this.gotoStore(str(c.path)!, action);
        await this.ensureContext();
        await this.ctx!.click(str(c.selector) ?? 'a', { expectNavigation: true, timeoutMs: this.deps.config.navigationTimeoutMs });
        return this.captureEvidence(action);
      case 'search':
        return this.search(str(c.query) ?? '', action);
      case 'view_product':
        return this.gotoStore(`product.html?id=${encodeURIComponent(str(c.productId) ?? 'trail-jacket')}`, action);
      case 'add_to_cart':
        return this.addToCart(str(c.productId), num(c.quantity) ?? 1, action);
      case 'view_cart':
        return this.gotoStore('cart.html', action);
      case 'fill_form':
        return this.fillForm(str(c.formId) ?? 'newsletter', num(c.value) ?? 0, node, action);
      case 'register':
        return this.register(num(c.value) ?? 0, node, action);
      case 'login':
        return this.login(action);
      case 'checkout':
        return this.checkout(node, action);
      case 'conversion_event':
        return this.customConversion(str(c.eventType) ?? 'custom_conversion', num(c.value) ?? 0, node, action);
      case 'wait':
        return this.wait(num(c.seconds) ?? 0, num(c.virtualHours) ?? 0, num(c.virtualDays) ?? 0, action);
      case 'new_session':
        await this.startSession('new_session');
        action.details.sessionId = this.session.id;
        return;
      case 'change_device':
        return this.changeDevice((str(c.to) as DeviceKind) ?? 'mobile', action);
      case 'clear_cookies':
        return this.clearCookies(action);
      case 'inject_failure':
        return this.injectFailure(c.fault as ScenarioFault | undefined, action);
      default:
        throw new Error(`Unsupported node type ${node.type}`);
    }
  }

  // -------------------------------------------------------------------------
  // Marketing environments
  // -------------------------------------------------------------------------

  private campaignFromNode(node: JourneyNode): CampaignConfig {
    const c = node.config ?? {};
    const channel: Channel = node.type.startsWith('email')
      ? 'email'
      : node.type.startsWith('message')
        ? ((str(c.channel) as Channel) ?? 'sms')
        : ((str(c.channel) as Channel) ?? 'meta');
    const utmCampaign = str(c.utmCampaign);
    return {
      channel,
      campaignId: str(c.campaignId) ?? `${channel}_campaign`,
      campaignName: str(c.campaignName),
      creativeId: str(c.creativeId),
      adsetId: str(c.adsetId),
      headline: str(c.headline),
      body: str(c.body),
      subject: str(c.subject),
      landingPath: str(c.landingPath) ?? 'index.html',
      utm: utmCampaign ? { campaign: utmCampaign } : undefined,
    };
  }

  private async openChannel(node: JourneyNode, action: ExecutedAction) {
    const campaign = this.campaignFromNode(node);
    const landing = buildLandingUrl(this.job.project.website.baseUrl, campaign, this.token, this.job.scenario.faults);
    const channelUrl = buildChannelPageUrl({
      siteBaseUrl: this.deps.config.siteBaseUrl,
      campaign,
      destination: landing,
      customerFirstName: this.job.customer.firstName,
      messagingChannel: campaign.channel === 'sms' || campaign.channel === 'whatsapp' ? campaign.channel : undefined,
    });
    await this.ensureContext();
    await this.retryable(() => this.ctx!.goto(channelUrl, { timeoutMs: this.deps.config.navigationTimeoutMs }), `open ${campaign.channel} environment`);
    action.details.channel = campaign.channel;
    action.details.campaignId = campaign.campaignId;
    action.details.creativeId = campaign.creativeId;
    action.details.environment = CHANNEL_META[campaign.channel].label;
    action.details.destinationUrl = landing.url;
    if (landing.faultApplied) action.details.faultApplied = landing.faultApplied;
    return { campaign, landing };
  }

  private async marketingImpression(node: JourneyNode, action: ExecutedAction): Promise<void> {
    const { campaign } = await this.openChannel(node, action);
    await this.captureEvidence(action, { screenshot: false });
    const ts = this.clock.nowIso();
    this.ledger.impressions.push({ id: randomId('imp'), nodeId: node.id, channel: campaign.channel, campaignId: campaign.campaignId, creativeId: campaign.creativeId, ts, sessionId: this.session.id });
    const kind = campaign.channel === 'email' ? 'email_open' : campaign.channel === 'sms' || campaign.channel === 'whatsapp' ? 'message_delivery' : 'ad_impression';
    this.store.platformRecords.put(platformRecord({ runId: this.job.run.id, customerId: this.job.customer.id, kind, channel: campaign.channel, campaignId: campaign.campaignId, creativeId: campaign.creativeId, ts, contactHash: await this.contactHash() }));
  }

  private async marketingClick(node: JourneyNode, action: ExecutedAction): Promise<void> {
    const { campaign, landing } = await this.openChannel(node, action);
    const cta = CHANNEL_META[campaign.channel].ctaSelector;
    await this.ctx!.waitForSelector(cta, { timeoutMs: this.deps.config.actionTimeoutMs });
    await this.ctx!.click(cta, { expectNavigation: true, timeoutMs: this.deps.config.navigationTimeoutMs });
    const url = await this.ctx!.url();
    if (!url.startsWith(this.job.project.website.baseUrl.replace(/\/$/, ''))) {
      throw new Error(`Expected to land on the website, but browser is at ${url}`);
    }
    const { utm, clickIds } = extractTrackingParams(url);
    const ts = this.clock.nowIso();
    const tp = {
      id: randomId('tp'),
      nodeId: node.id,
      channel: campaign.channel,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      creativeId: campaign.creativeId,
      clickId: landing.clickIdParam ? clickIds[landing.clickIdParam] ?? landing.clickId : undefined,
      clickIdParam: landing.clickIdParam,
      observedUtm: utm,
      intendedUtm: landing.intendedUtm,
      ts,
      sessionId: this.session.id,
      cookieJarId: this.cookieJarId,
      landingUrl: url,
      faultApplied: landing.faultApplied,
    };
    this.ledger.touchpoints.push(tp);
    action.details.touchpointId = tp.id;
    action.details.landingUrl = url;
    action.details.observedUtm = utm;
    action.details.clickId = tp.clickId;
    await this.captureEvidence(action, { screenshot: true, label: `Landed on ${pathOf(url)}` });
    this.store.platformRecords.put(platformRecord({ runId: this.job.run.id, customerId: this.job.customer.id, kind: 'ad_click', channel: campaign.channel, campaignId: campaign.campaignId, creativeId: campaign.creativeId, clickId: tp.clickId, ts, contactHash: await this.contactHash() }));
    this.log('info', `${campaign.channel} click landed on ${pathOf(url)}`, { campaignId: campaign.campaignId, utm });
  }

  private async enterSegment(node: JourneyNode, action: ExecutedAction): Promise<void> {
    const segmentId = str(node.config.segmentId) ?? 'segment';
    const ts = this.clock.nowIso();
    this.ledger.segments.push({ segmentId, ts });
    this.store.platformRecords.put(platformRecord({ runId: this.job.run.id, customerId: this.job.customer.id, kind: 'segment_membership', channel: 'email', campaignId: segmentId, ts, contactHash: await this.contactHash(), segmentId }));
    action.details.segmentId = segmentId;
    action.details.note = 'Recorded through the synthetic platform data adapter (no browser interaction).';
  }

  // -------------------------------------------------------------------------
  // Website interactions (bundled demo store selectors)
  // -------------------------------------------------------------------------

  private async gotoStore(path: string, action: ExecutedAction, opts: { screenshot?: boolean } = {}): Promise<void> {
    await this.ensureContext();
    const url = storeUrl(this.job.project.website.baseUrl, path, this.token);
    await this.retryable(() => this.ctx!.goto(url, { timeoutMs: this.deps.config.navigationTimeoutMs }), `goto ${path}`);
    action.details.url = await this.ctx!.url();
    await this.captureEvidence(action, { screenshot: opts.screenshot ?? false });
  }

  private async onStorePage(pageFile: string, query?: string): Promise<boolean> {
    if (!this.ctx) return false;
    const url = await this.ctx.url();
    if (!url.includes(`/${pageFile}`)) return false;
    return query ? url.includes(query) : true;
  }

  private async search(query: string, action: ExecutedAction): Promise<void> {
    if (!(await this.onStorePage('products.html'))) await this.gotoStore('products.html', action);
    await this.ctx!.fill('#search-input', query);
    await this.ctx!.click('#search-button', { expectNavigation: true });
    action.details.query = query;
    action.details.results = await this.ctx!.text('#results-count');
    await this.captureEvidence(action);
  }

  private async addToCart(productId: string | undefined, quantity: number, action: ExecutedAction): Promise<void> {
    if (productId && !(await this.onStorePage('product.html', `id=${productId}`))) {
      await this.gotoStore(`product.html?id=${encodeURIComponent(productId)}`, action);
    }
    await this.ensureContext();
    await this.ctx!.waitForSelector('#add-to-cart');
    if (quantity !== 1) await this.ctx!.fill('#qty', String(quantity));
    await this.ctx!.click('#add-to-cart');
    await this.ctx!.waitForSelector('#cart-toast');
    action.details.productId = productId ?? (await this.ctx!.text('#product-title'));
    action.details.quantity = quantity;
    action.details.cartCount = await this.ctx!.text('#cart-count');
    await this.captureEvidence(action);
  }

  private async fillForm(formId: string, value: number, node: JourneyNode, action: ExecutedAction): Promise<void> {
    if (formId !== 'newsletter') throw new Error(`Unknown form "${formId}"`);
    if (!(await this.onStorePage('index.html'))) await this.gotoStore('index.html', action);
    await this.ctx!.fill('#newsletter-email', this.job.customer.email);
    await this.ctx!.click('#newsletter-submit');
    await this.ctx!.waitForSelector('#newsletter-success');
    this.identifiedSessions.add(this.session.id);
    this.recordConversion(node, 'lead', 'lead', value, action);
    await this.captureEvidence(action, { screenshot: true, label: 'Newsletter signup confirmed' });
  }

  private async register(value: number, node: JourneyNode, action: ExecutedAction): Promise<void> {
    if (!(await this.onStorePage('account.html'))) await this.gotoStore('account.html', action);
    await this.ctx!.fill('#reg-first', this.job.customer.firstName);
    await this.ctx!.fill('#reg-last', this.job.customer.lastName);
    await this.ctx!.fill('#reg-email', this.job.customer.email);
    await this.ctx!.click('#register-submit');
    await this.ctx!.waitForSelector('#account-welcome');
    this.identifiedSessions.add(this.session.id);
    this.recordConversion(node, 'signup', 'signup', value, action);
    await this.captureEvidence(action, { screenshot: true, label: 'Account created' });
  }

  private async login(action: ExecutedAction): Promise<void> {
    if (!(await this.onStorePage('account.html'))) await this.gotoStore('account.html', action);
    await this.ctx!.fill('#login-email', this.job.customer.email);
    await this.ctx!.click('#login-submit');
    await this.ctx!.waitForSelector('#account-welcome');
    this.identifiedSessions.add(this.session.id);
    action.details.email = this.job.customer.email;
    await this.captureEvidence(action, { screenshot: true, label: 'Logged in' });
  }

  private async checkout(node: JourneyNode, action: ExecutedAction): Promise<void> {
    const { customer, project } = this.job;
    if (project.website.kind === 'external' && !project.website.testCheckoutAuthorized) {
      throw new Error('Conversion scenarios on external websites require an authorized test checkout integration.');
    }
    if (!(await this.onStorePage('checkout.html'))) await this.gotoStore('checkout.html', action);
    await this.ctx!.waitForSelector('#checkout-form');
    await this.ctx!.fill('#email', customer.email);
    await this.ctx!.fill('#first-name', customer.firstName);
    await this.ctx!.fill('#last-name', customer.lastName);
    await this.ctx!.fill('#address', '1 Synthetic Way');
    await this.ctx!.fill('#city', 'Testville');
    await this.ctx!.fill('#postal', '00000');
    await this.ctx!.click('#place-order', { expectNavigation: true });
    await this.ctx!.waitForSelector('#order-total');
    const url = await this.ctx!.url();
    const params = new URL(url).searchParams;
    const orderId = params.get('id') ?? (await this.ctx!.text('#order-id')) ?? randomId('ORD');
    const totalText = (await this.ctx!.text('#order-total')) ?? params.get('total') ?? '0';
    const total = Number(String(totalText).replace(/[^0-9.]/g, ''));
    let items: GroundTruthConversion['items'];
    try {
      const raw = await this.ctx!.readGlobal('__syntroOrder.items');
      if (Array.isArray(raw)) items = raw as GroundTruthConversion['items'];
    } catch {
      /* optional */
    }
    this.identifiedSessions.add(this.session.id);
    const conversion = this.recordConversion(node, 'purchase', 'purchase', total, action, orderId, items);
    action.details.orderId = orderId;
    action.details.total = total;
    action.details.testOrder = true;
    await this.captureEvidence(action, { screenshot: true, label: `Test order ${orderId} confirmed` });
    this.log('info', `Test checkout completed: ${orderId} for $${total}`, { conversionId: conversion.id });
  }

  private async customConversion(eventType: string, value: number, node: JourneyNode, action: ExecutedAction): Promise<void> {
    await this.gotoStore(`conversion.html?type=${encodeURIComponent(eventType)}&value=${encodeURIComponent(String(value))}`, action);
    await this.ctx!.waitForSelector('#conversion-fired');
    this.recordConversion(node, 'custom', eventType, value, action);
  }

  private recordConversion(
    node: JourneyNode,
    type: GroundTruthConversion['type'],
    eventType: string,
    value: number,
    action: ExecutedAction,
    orderId?: string,
    items?: GroundTruthConversion['items'],
  ): GroundTruthConversion {
    const conversion: GroundTruthConversion = {
      id: randomId('conv'),
      nodeId: node.id,
      type,
      eventType,
      value,
      orderId,
      ts: this.clock.nowIso(),
      sessionId: this.session.id,
      cookieJarId: this.cookieJarId,
      items,
    };
    this.ledger.conversions.push(conversion);
    action.details.conversionId = conversion.id;
    action.details.value = value;
    return conversion;
  }

  // -------------------------------------------------------------------------
  // Journey logic
  // -------------------------------------------------------------------------

  private async wait(seconds: number, virtualHours: number, virtualDays: number, action: ExecutedAction): Promise<void> {
    const realMs = Math.min(seconds, this.deps.config.maxRealWaitSeconds) * 1000;
    if (realMs > 0) await sleep(realMs);
    const virtualMs = virtualHours * HOUR_MS + virtualDays * DAY_MS;
    action.details.realSeconds = realMs / 1000;
    action.details.virtualMs = virtualMs;
    if (virtualMs > 0) {
      this.clock.advance(virtualMs);
      await this.startSession('virtual_wait');
      action.details.virtualNow = this.clock.nowIso();
      action.details.newSessionId = this.session.id;
    }
  }

  private async changeDevice(to: DeviceKind, action: ExecutedAction): Promise<void> {
    await this.closeContext();
    this.device = deviceProfileFor(to, this.rng.fork('device'));
    this.contextId = randomId('ctx');
    this.cookieJarId = randomId('jar');
    await this.startSession('change_device');
    action.details.device = this.device;
    action.details.note = 'New browser context: fresh cookies and storage.';
  }

  private async clearCookies(action: ExecutedAction): Promise<void> {
    if (this.ctx) await this.ctx.clearStorage();
    this.cookieJarId = randomId('jar');
    await this.startSession('clear_cookies');
    action.details.note = 'First-party cookies and storage cleared; new cookie jar id assigned.';
    action.details.cookieJarId = this.cookieJarId;
  }

  private async injectFailure(fault: ScenarioFault | undefined, action: ExecutedAction): Promise<void> {
    if (!fault || !fault.kind) throw new Error('inject_failure requires a fault definition');
    this.job.customer.activeFaults.push(fault);
    this.saveCustomer();
    if (fault.kind === 'suppress_identify') this.token = await this.mintToken();
    action.details.fault = fault;
    action.evidence.push({ kind: 'fault_injection', label: `Fault activated: ${fault.kind}`, data: fault, ts: this.clock.nowIso() });
  }

  // -------------------------------------------------------------------------
  // Sessions, tokens, contexts
  // -------------------------------------------------------------------------

  private async startSession(reason: SyntheticSession['reason']): Promise<void> {
    this.session = {
      id: randomId('sess'),
      contextId: this.contextId,
      cookieJarId: this.cookieJarId,
      device: this.device,
      startedAt: nowIso(),
      virtualStartedAt: this.clock.nowIso(),
      reason,
    };
    this.job.customer.sessions.push(this.session);
    this.saveCustomer();
    this.token = await this.mintToken();
  }

  private mintToken(): Promise<string> {
    const { project, run, scenario, customer } = this.job;
    const suppressIdentify = scenario.faults.some((f) => f.kind === 'suppress_identify') || customer.activeFaults.some((f) => f.kind === 'suppress_identify');
    return this.deps.tokens.mint({
      p: project.id,
      r: run.id,
      s: scenario.id,
      c: customer.id,
      sid: this.session.id,
      col: this.deps.config.collectorEndpoint,
      off: this.clock.offsetMs,
      sdk: { identify: !suppressIdentify, guard: project.website.isolationGuard, dedupe: true },
      dev: { kind: this.device.kind, os: this.device.os, browser: this.device.browser, ua: this.device.userAgent, vw: this.device.viewport.width, vh: this.device.viewport.height },
    });
  }

  private async ensureContext(): Promise<void> {
    if (this.ctx) return;
    this.ctx = await this.job.driver.newContext({ contextId: this.contextId, device: this.device, label: `${this.job.customer.firstName} ${this.job.customer.lastName}` });
  }

  private async closeContext(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.ctx = null;
    await ctx.close().catch(() => undefined);
  }

  private async isolationCheck(): Promise<void> {
    if (!this.ctx || this.job.project.website.kind !== 'bundled_demo_store') return;
    try {
      const raw = await this.ctx.readGlobal('__prodAnalytics.count');
      const count = typeof raw === 'number' ? raw : Number(raw ?? 0);
      this.ledger.isolationCheck = {
        performed: true,
        productionEventsObserved: Number.isFinite(count) ? count : 0,
        note:
          count === 0
            ? 'The mock production analytics tag received no events during the synthetic session (isolation guard active).'
            : `The mock production analytics tag recorded ${count} event(s) during the synthetic session (isolation guard ${this.job.project.website.isolationGuard ? 'active but bypassed' : 'disabled'}).`,
      };
    } catch (e) {
      this.ledger.isolationCheck = { performed: false, productionEventsObserved: 0, note: `Isolation check unavailable: ${(e as Error).message}` };
    }
  }

  // -------------------------------------------------------------------------
  // Evidence, retries, persistence
  // -------------------------------------------------------------------------

  private async captureEvidence(action: ExecutedAction, opts: { screenshot?: boolean; label?: string } = {}): Promise<void> {
    if (!this.ctx) return;
    const wantShot = (opts.screenshot ?? false) && this.deps.config.captureScreenshots && this.job.driver.capabilities.screenshots;
    const snap = await this.ctx.snapshot({ screenshot: wantShot });
    const evidence: Evidence[] = [{ kind: 'url', label: opts.label ?? 'Page URL', data: snap.url, ts: snap.ts }];
    if (snap.title || snap.text) evidence.push({ kind: 'dom_snapshot', label: snap.title || 'Page snapshot', data: { title: snap.title, text: snap.text }, ts: snap.ts });
    if (snap.screenshot) evidence.push({ kind: 'screenshot', label: opts.label ?? (snap.title || 'Screenshot'), data: snap.screenshot, ts: snap.ts });
    action.evidence.push(...evidence);
  }

  private async retryable<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const attempts = Math.max(1, this.deps.config.retryAttempts);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        if (attempt < attempts) {
          this.log('warn', `Retrying ${label} (attempt ${attempt + 1}/${attempts}): ${(e as Error).message}`);
          await sleep(this.deps.config.retryBackoffMs * attempt);
        }
      }
    }
    throw lastError;
  }

  private async contactHash(): Promise<string> {
    return sha256Hex(this.job.customer.email.toLowerCase());
  }

  private saveCustomer(): void {
    this.store.customers.put(this.job.customer);
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>): void {
    this.deps.logger.log(level, message, data, this.logCtx);
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').pop() ?? '';
    const id = u.searchParams.get('id');
    return id ? `${file}?id=${id}` : file;
  } catch {
    return url;
  }
}
