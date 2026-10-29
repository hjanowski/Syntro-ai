import { createAttributionAdapter } from '../attribution/adapters/index.ts';
import { EventCollector } from '../collector/collector.ts';
import type {
  CollectRequest,
  CollectResponse,
  CreateJourneyRequest,
  CreateProjectRequest,
  CreateScenarioRequest,
  CustomerDetail,
  EngineInfo,
  JourneyValidationResult,
  OverviewStats,
  PreviewCustomersRequest,
  RerunRequest,
  RunComparison,
  RunDetail,
  StartSimulationRequest,
  UpdateJourneyRequest,
  UpdateProjectRequest,
  UpdateScenarioRequest,
} from '../contracts/v1.ts';
import { EngineError } from '../contracts/v1.ts';
import { generateCustomers } from '../customers/generate.ts';
import type {
  AttributionPolicy,
  AttributionResult,
  CollectedEvent,
  ExecutionLogEntry,
  IntegrationStatus,
  JourneyDefinition,
  LedgerEntry,
  PreflightReport,
  Project,
  RunAssignment,
  Scenario,
  SimulationRun,
  SyntheticCustomer,
  SystemUnderTestConfig,
  ValidationReport,
} from '../domain/types.ts';
import type { EngineConfig, EngineLogger } from '../execution/config.ts';
import { StoreLogger } from '../execution/config.ts';
import type { BrowserDriver, DriverCapabilities } from '../execution/driver.ts';
import { SimulationRunner } from '../execution/runner.ts';
import { linearize, validateJourney } from '../journeys/graph.ts';
import { JOURNEY_TEMPLATES, SCENARIO_PRESETS, getTemplate, instantiateTemplate, type JourneyTemplate, type ScenarioPreset } from '../journeys/templates.ts';
import type { Store } from '../store/store.ts';
import { SessionTokenService } from '../tokens/session-token.ts';
import { randomId } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';

export const DEMO_PROJECT_ID = 'proj_demo_aurora';

export function defaultSutConfig(overrides: Partial<SystemUnderTestConfig> = {}): SystemUnderTestConfig {
  return {
    adapter: 'local',
    models: ['first_touch', 'last_touch', 'linear'],
    lookbackDays: 30,
    identityResolution: 'cookie_only',
    dedupeConversionsByOrderId: false,
    clickIdMappings: { fbclid: 'meta', gclid: 'google' },
    utmSourceMappings: { facebook: 'meta', meta: 'meta', instagram: 'meta', google: 'google', linkedin: 'linkedin', email: 'email', newsletter: 'email', sms: 'sms', whatsapp: 'whatsapp' },
    usePlatformClickRecords: false,
    faults: {},
    ...overrides,
  };
}

export function defaultAttributionPolicy(overrides: Partial<AttributionPolicy> = {}): AttributionPolicy {
  return { models: ['first_touch', 'last_touch', 'linear'], lookbackDays: 30, ...overrides };
}

export interface EngineServiceDeps {
  store: Store;
  config: EngineConfig;
  driverFactory: () => Promise<BrowserDriver>;
  host: 'node' | 'browser';
  driverName: string;
  driverCapabilities: DriverCapabilities;
  persistent: boolean;
  logger?: EngineLogger;
  onRunUpdate?: (run: SimulationRun) => void;
}

/**
 * Layer 1 service façade. Every operation of the v1 API contract is implemented here and
 * exposed either over HTTP (server) or in-process (browser-hosted engine).
 */
export class EngineService {
  readonly store: Store;
  readonly config: EngineConfig;
  readonly tokens: SessionTokenService;
  readonly collector: EventCollector;
  readonly runner: SimulationRunner;
  readonly logger: EngineLogger;

  constructor(private readonly deps: EngineServiceDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.logger = deps.logger ?? new StoreLogger(deps.store);
    this.tokens = new SessionTokenService(deps.config.secret);
    this.collector = new EventCollector(deps.store, this.tokens);
    this.runner = new SimulationRunner({
      store: deps.store,
      tokens: this.tokens,
      config: deps.config,
      logger: this.logger,
      driverFactory: deps.driverFactory,
      onRunUpdate: deps.onRunUpdate,
    });
  }

  info(): EngineInfo {
    return {
      name: 'syntro-engine',
      apiVersion: 'v1',
      host: this.deps.host,
      driver: this.deps.driverName,
      capabilities: { screenshots: this.deps.driverCapabilities.screenshots, realBrowserIsolation: this.deps.driverCapabilities.realIsolation, persistent: this.deps.persistent },
      siteBaseUrl: this.config.siteBaseUrl,
      collectorEndpoint: this.config.collectorEndpoint,
    };
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  listProjects(): Project[] {
    return this.store.projects.list().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getProject(id: string): Project {
    const p = this.store.projects.get(id);
    if (!p) throw new EngineError('not_found', `Project ${id} not found`, 404);
    return p;
  }

  createProject(req: CreateProjectRequest, id = randomId('proj')): Project {
    if (!req.name?.trim()) throw new EngineError('validation', 'Project name is required');
    const ts = nowIso();
    const project: Project = {
      id,
      name: req.name.trim(),
      description: req.description,
      website: {
        baseUrl: `${this.config.siteBaseUrl.replace(/\/$/, '')}/store`,
        kind: 'bundled_demo_store',
        isolationGuard: true,
        testCheckoutAuthorized: true,
        ...(req.website ?? {}),
      },
      attributionPolicy: defaultAttributionPolicy(req.attributionPolicy),
      sut: defaultSutConfig(req.sut),
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.projects.put(project);
    if (req.seedDemo) this.seedProjectFromPresets(project.id);
    return project;
  }

  updateProject(id: string, req: UpdateProjectRequest): Project {
    const project = this.getProject(id);
    if (req.name !== undefined) project.name = req.name.trim() || project.name;
    if (req.description !== undefined) project.description = req.description;
    if (req.website) project.website = { ...project.website, ...req.website };
    if (req.attributionPolicy) project.attributionPolicy = { ...project.attributionPolicy, ...req.attributionPolicy };
    if (req.sut) project.sut = { ...project.sut, ...req.sut, faults: { ...project.sut.faults, ...(req.sut.faults ?? {}) } };
    project.updatedAt = nowIso();
    this.store.projects.put(project);
    return project;
  }

  deleteProject(id: string): void {
    this.getProject(id);
    for (const run of this.store.runs.list((r) => r.projectId === id)) this.deleteRun(run.id);
    for (const s of this.store.scenarios.list((s) => s.projectId === id)) this.store.scenarios.delete(s.id);
    for (const j of this.store.journeys.list((j) => j.projectId === id)) this.store.journeys.delete(j.id);
    this.store.projects.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Journeys
  // ---------------------------------------------------------------------------

  listJourneyTemplates(): JourneyTemplate[] {
    return JOURNEY_TEMPLATES.filter((t) => !t.tags.includes('internal'));
  }

  listJourneys(projectId?: string, includeInternal = false): JourneyDefinition[] {
    return this.store.journeys
      .list((j) => (projectId ? j.projectId === projectId : true) && (includeInternal || !j.tags.includes('internal')))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getJourney(id: string): JourneyDefinition {
    const j = this.store.journeys.get(id);
    if (!j) throw new EngineError('not_found', `Journey ${id} not found`, 404);
    return j;
  }

  createJourney(req: CreateJourneyRequest): JourneyDefinition {
    if (!req.name?.trim()) throw new EngineError('validation', 'Journey name is required');
    const validation = validateJourney({ nodes: req.nodes ?? [], edges: req.edges ?? [] });
    if (!validation.valid) throw new EngineError('invalid_journey', validation.errors.join(' '), 400, validation);
    const ts = nowIso();
    const journey: JourneyDefinition = {
      id: randomId('jrn'),
      projectId: req.projectId ?? null,
      name: req.name.trim(),
      description: req.description,
      version: 1,
      nodes: req.nodes,
      edges: req.edges,
      tags: req.tags ?? [],
      isTemplate: false,
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.journeys.put(journey);
    return journey;
  }

  createJourneyFromTemplate(templateKey: string, projectId: string | null): JourneyDefinition {
    const template = getTemplate(templateKey);
    if (!template) throw new EngineError('not_found', `Template ${templateKey} not found`, 404);
    const journey = instantiateTemplate(template, projectId);
    this.store.journeys.put(journey);
    return journey;
  }

  updateJourney(id: string, req: UpdateJourneyRequest): JourneyDefinition {
    const journey = this.getJourney(id);
    const nodes = req.nodes ?? journey.nodes;
    const edges = req.edges ?? journey.edges;
    const validation = validateJourney({ nodes, edges });
    if (!validation.valid) throw new EngineError('invalid_journey', validation.errors.join(' '), 400, validation);
    if (req.name !== undefined) journey.name = req.name.trim() || journey.name;
    if (req.description !== undefined) journey.description = req.description;
    if (req.tags) journey.tags = req.tags;
    journey.nodes = nodes;
    journey.edges = edges;
    journey.updatedAt = nowIso();
    this.store.journeys.put(journey);
    return journey;
  }

  deleteJourney(id: string): void {
    this.getJourney(id);
    const used = this.store.scenarios.list((s) => s.journeyId === id);
    if (used.length) throw new EngineError('in_use', `Journey is used by ${used.length} scenario(s)`, 409);
    this.store.journeys.delete(id);
  }

  validateJourneyDefinition(def: Pick<JourneyDefinition, 'nodes' | 'edges'>): JourneyValidationResult {
    const result = validateJourney(def);
    const probe = generateCustomers({ runId: 'preview', projectId: 'preview', scenarioId: 'preview', journeyId: 'preview', count: 1, seed: 1 })[0];
    const preview = result.valid ? linearize({ ...def, id: 'preview', projectId: null, name: '', version: 1, tags: [], isTemplate: false, createdAt: '', updatedAt: '' }, probe) : [];
    return { ...result, preview };
  }

  // ---------------------------------------------------------------------------
  // Scenarios
  // ---------------------------------------------------------------------------

  listScenarioPresets(): ScenarioPreset[] {
    return SCENARIO_PRESETS;
  }

  listScenarios(projectId?: string, includeInternal = false): Scenario[] {
    return this.store.scenarios
      .list((s) => (projectId ? s.projectId === projectId : true) && (includeInternal || !s.tags.includes('internal')))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getScenario(id: string): Scenario {
    const s = this.store.scenarios.get(id);
    if (!s) throw new EngineError('not_found', `Scenario ${id} not found`, 404);
    return s;
  }

  createScenario(req: CreateScenarioRequest): Scenario {
    this.getProject(req.projectId);
    this.getJourney(req.journeyId);
    if (!req.name?.trim()) throw new EngineError('validation', 'Scenario name is required');
    const ts = nowIso();
    const scenario: Scenario = {
      id: randomId('scn'),
      projectId: req.projectId,
      name: req.name.trim(),
      description: req.description,
      journeyId: req.journeyId,
      faults: req.faults ?? [],
      defaultCustomerCount: clampCount(req.defaultCustomerCount ?? 1),
      tags: req.tags ?? [],
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.scenarios.put(scenario);
    return scenario;
  }

  updateScenario(id: string, req: UpdateScenarioRequest): Scenario {
    const scenario = this.getScenario(id);
    if (req.journeyId) this.getJourney(req.journeyId);
    if (req.name !== undefined) scenario.name = req.name.trim() || scenario.name;
    if (req.description !== undefined) scenario.description = req.description;
    if (req.journeyId) scenario.journeyId = req.journeyId;
    if (req.faults) scenario.faults = req.faults;
    if (req.defaultCustomerCount !== undefined) scenario.defaultCustomerCount = clampCount(req.defaultCustomerCount);
    if (req.tags) scenario.tags = req.tags;
    scenario.updatedAt = nowIso();
    this.store.scenarios.put(scenario);
    return scenario;
  }

  deleteScenario(id: string): void {
    this.getScenario(id);
    this.store.scenarios.delete(id);
  }

  /** Create journeys from every template and a scenario for every preset (idempotent per template key). */
  seedProjectFromPresets(projectId: string): { journeys: JourneyDefinition[]; scenarios: Scenario[] } {
    const project = this.getProject(projectId);
    const journeys: JourneyDefinition[] = [];
    const scenarios: Scenario[] = [];
    const journeyByTemplate = new Map<string, JourneyDefinition>();
    for (const j of this.store.journeys.list((j) => j.projectId === project.id && !!j.templateKey)) journeyByTemplate.set(j.templateKey!, j);
    for (const template of JOURNEY_TEMPLATES) {
      if (template.tags.includes('internal')) continue;
      let journey = journeyByTemplate.get(template.key);
      if (!journey) {
        journey = instantiateTemplate(template, project.id);
        this.store.journeys.put(journey);
        journeyByTemplate.set(template.key, journey);
      }
      journeys.push(journey);
    }
    const existingPresets = new Set(this.store.scenarios.list((s) => s.projectId === project.id && !!s.templateKey).map((s) => s.templateKey!));
    for (const preset of SCENARIO_PRESETS) {
      if (existingPresets.has(preset.key)) continue;
      const journey = journeyByTemplate.get(preset.journeyTemplateKey);
      if (!journey) continue;
      const ts = nowIso();
      const scenario: Scenario = {
        id: randomId('scn'),
        projectId: project.id,
        name: preset.name,
        description: preset.description,
        journeyId: journey.id,
        faults: preset.faults,
        defaultCustomerCount: preset.defaultCustomerCount,
        tags: preset.tags,
        templateKey: preset.key,
        createdAt: ts,
        updatedAt: ts,
      };
      this.store.scenarios.put(scenario);
      scenarios.push(scenario);
    }
    return { journeys, scenarios: this.listScenarios(project.id) };
  }

  /** Idempotently create the investor-demo project "Aurora Supply Co." with every preset. */
  ensureDemoProject(): Project {
    const existing = this.store.projects.get(DEMO_PROJECT_ID);
    if (existing) {
      this.seedProjectFromPresets(existing.id);
      return existing;
    }
    return this.createProject(
      {
        name: 'Aurora Supply Co.',
        description: 'Outdoor e-commerce brand running email, Google Ads, Meta Ads, LinkedIn and messaging campaigns into the bundled demo store. The attribution system under test is configured the way the team believes is correct.',
        seedDemo: true,
      },
      DEMO_PROJECT_ID,
    );
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------

  previewCustomers(projectId: string, req: PreviewCustomersRequest): SyntheticCustomer[] {
    this.getProject(projectId);
    return generateCustomers({ runId: 'preview', projectId, scenarioId: 'preview', journeyId: 'preview', count: clampCount(req.count), seed: req.seed ?? 1, attributes: req.attributes });
  }

  listCustomers(runId: string): SyntheticCustomer[] {
    return this.store.customers.list((c) => c.runId === runId).sort((a, b) => a.index - b.index);
  }

  getCustomerDetail(customerId: string): CustomerDetail {
    const customer = this.store.customers.get(customerId);
    if (!customer) throw new EngineError('not_found', `Customer ${customerId} not found`, 404);
    const ledger = this.store.ledger.list((l) => l.customerId === customerId)[0] ?? null;
    const events = this.store.events.list((e) => e.syntheticCustomerId === customerId).sort((a, b) => a.ts.localeCompare(b.ts));
    const orderIds = new Set(ledger?.conversions.map((c) => c.orderId).filter(Boolean));
    const anonIds = new Set(events.map((e) => e.anonymousId));
    const attributionResults = this.store.attributionResults.list((r) => r.runId === customer.runId && ((r.conversion.orderId && orderIds.has(r.conversion.orderId)) || anonIds.has(r.conversion.anonymousId)));
    return {
      customer,
      ledger,
      events,
      collectorLog: this.store.collectorLog.list((l) => l.customerId === customerId).sort((a, b) => a.ts.localeCompare(b.ts)),
      platformRecords: this.store.platformRecords.list((r) => r.customerId === customerId),
      attributionResults,
      logs: this.store.logs.list((l) => l.customerId === customerId).sort((a, b) => a.ts.localeCompare(b.ts)),
    };
  }

  // ---------------------------------------------------------------------------
  // Simulations
  // ---------------------------------------------------------------------------

  listRuns(projectId?: string, includePreflight = false): SimulationRun[] {
    return this.store.runs
      .list((r) => (projectId ? r.projectId === projectId : true) && (includePreflight || r.kind !== 'preflight'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getRunRecord(runId: string): SimulationRun {
    const run = this.store.runs.get(runId);
    if (!run) throw new EngineError('not_found', `Run ${runId} not found`, 404);
    return run;
  }

  getRun(runId: string): RunDetail {
    const run = this.getRunRecord(runId);
    const project = this.getProject(run.projectId);
    const scenarioIds = new Set(run.assignments.map((a) => a.scenarioId));
    return { run, customers: this.listCustomers(runId), project, scenarios: this.store.scenarios.list((s) => scenarioIds.has(s.id)) };
  }

  startSimulation(req: StartSimulationRequest): SimulationRun {
    const project = this.getProject(req.projectId);
    const run = this.createRun(project, req.assignments, { name: req.name, seed: req.seed, concurrency: req.concurrency, kind: 'simulation' });
    this.launch(run);
    return run;
  }

  private createRun(
    project: Project,
    assignments: RunAssignment[],
    opts: { name?: string; seed?: number; concurrency?: number; kind: SimulationRun['kind']; parentRunId?: string; rerunMode?: 'all' | 'failed_only' },
  ): SimulationRun {
    if (!Array.isArray(assignments) || assignments.length === 0) throw new EngineError('validation', 'At least one scenario assignment is required');
    const total = assignments.reduce((sum, a) => sum + Math.floor(a.customerCount), 0);
    if (total < 1 || total > 100) throw new EngineError('validation', `Total synthetic customers must be between 1 and 100 (got ${total})`);
    const scenarios = assignments.map((a) => {
      const s = this.getScenario(a.scenarioId);
      if (s.projectId !== project.id) throw new EngineError('validation', `Scenario ${s.id} belongs to another project`);
      this.getJourney(s.journeyId);
      if (a.customerCount < 1) throw new EngineError('validation', `Scenario ${s.name} needs at least one customer`);
      return s;
    });
    const count = this.store.runs.count((r) => r.projectId === project.id && r.kind === 'simulation');
    const run: SimulationRun = {
      id: randomId('run'),
      projectId: project.id,
      name: opts.name?.trim() || (opts.kind === 'preflight' ? 'Preflight check' : `Simulation #${count + 1}`),
      kind: opts.kind,
      status: 'queued',
      assignments: assignments.map((a) => ({ scenarioId: a.scenarioId, customerCount: Math.floor(a.customerCount) })),
      seed: opts.seed ?? Math.floor(Math.random() * 1_000_000),
      concurrency: Math.max(1, Math.min(10, opts.concurrency ?? this.config.defaultConcurrency)),
      driver: this.deps.driverName,
      parentRunId: opts.parentRunId,
      rerunMode: opts.rerunMode,
      progress: { total, completed: 0, failed: 0, running: 0, stopped: 0 },
      createdAt: nowIso(),
      sutSnapshot: JSON.parse(JSON.stringify(project.sut)) as SystemUnderTestConfig,
      policySnapshot: { ...project.attributionPolicy },
    };
    this.store.runs.put(run);
    let index = 1;
    assignments.forEach((a, i) => {
      const scenario = scenarios[i];
      const customers = generateCustomers({ runId: run.id, projectId: project.id, scenarioId: scenario.id, journeyId: scenario.journeyId, count: a.customerCount, seed: run.seed, startIndex: index });
      index += customers.length;
      for (const c of customers) this.store.customers.put(c);
    });
    return run;
  }

  private launch(run: SimulationRun): void {
    this.runner.start(run.id).catch((e) => this.logger.log('error', `Run ${run.id} crashed: ${(e as Error).message}`, undefined, { runId: run.id }));
  }

  /** Resolve when the run has finished (completed, failed, stopped or awaiting results). */
  async waitForRun(runId: string): Promise<SimulationRun> {
    await this.runner.wait(runId);
    return this.getRunRecord(runId);
  }

  stopRun(runId: string): SimulationRun {
    const run = this.getRunRecord(runId);
    if (['completed', 'failed', 'stopped'].includes(run.status)) return run;
    this.runner.requestStop(runId);
    return this.getRunRecord(runId);
  }

  rerun(runId: string, req: RerunRequest): SimulationRun {
    const parent = this.getRunRecord(runId);
    const project = this.getProject(parent.projectId);
    let assignments = parent.assignments;
    if (req.mode === 'failed_only') {
      const report = this.getValidation(runId);
      if (!report) throw new EngineError('no_report', 'No validation report exists for this run yet', 409);
      const failedByScenario = new Map<string, number>();
      for (const c of report.customers) {
        if (c.status === 'pass') continue;
        failedByScenario.set(c.scenarioId, (failedByScenario.get(c.scenarioId) ?? 0) + 1);
      }
      assignments = Array.from(failedByScenario.entries()).map(([scenarioId, customerCount]) => ({ scenarioId, customerCount }));
      if (!assignments.length) throw new EngineError('nothing_to_rerun', 'Every scenario passed; nothing to re-run', 409);
    }
    const run = this.createRun(project, assignments, { name: req.name ?? `${parent.name} · re-run`, seed: parent.seed, concurrency: parent.concurrency, kind: 'simulation', parentRunId: parent.id, rerunMode: req.mode });
    this.launch(run);
    return run;
  }

  /** Re-run attribution + validation for an existing run against the project's *current* SUT configuration (no browsers). */
  async revalidate(runId: string): Promise<SimulationRun> {
    const run = this.getRunRecord(runId);
    if (this.runner.isActive(runId)) throw new EngineError('busy', 'Run is still executing', 409);
    const project = this.getProject(run.projectId);
    return this.runner.finalize(runId, { sutOverride: JSON.parse(JSON.stringify(project.sut)) as SystemUnderTestConfig });
  }

  deleteRun(runId: string): void {
    this.getRunRecord(runId);
    if (this.runner.isActive(runId)) throw new EngineError('busy', 'Run is still executing', 409);
    const s = this.store;
    for (const c of s.customers.list((c) => c.runId === runId)) s.customers.delete(c.id);
    for (const l of s.ledger.list((l) => l.runId === runId)) s.ledger.delete(l.id);
    for (const e of s.events.list((e) => e.runId === runId)) s.events.delete(e.id);
    for (const l of s.collectorLog.list((l) => l.runId === runId)) s.collectorLog.delete(l.id);
    for (const r of s.platformRecords.list((r) => r.runId === runId)) s.platformRecords.delete(r.id);
    for (const r of s.attributionResults.list((r) => r.runId === runId)) s.attributionResults.delete(r.id);
    for (const r of s.validationReports.list((r) => r.runId === runId)) s.validationReports.delete(r.id);
    for (const l of s.logs.list((l) => l.runId === runId)) s.logs.delete(l.id);
    s.runs.delete(runId);
  }

  getLedger(runId: string): LedgerEntry[] {
    return this.store.ledger.list((l) => l.runId === runId);
  }

  getEvents(runId: string): CollectedEvent[] {
    return this.store.events.list((e) => e.runId === runId).sort((a, b) => a.ts.localeCompare(b.ts));
  }

  getAttributionResults(runId: string): AttributionResult[] {
    return this.store.attributionResults.list((r) => r.runId === runId);
  }

  getValidation(runId: string): ValidationReport | null {
    return this.store.validationReports.list((r) => r.runId === runId)[0] ?? null;
  }

  getLogs(runId: string, customerId?: string): ExecutionLogEntry[] {
    return this.store.logs.list((l) => l.runId === runId && (!customerId || l.customerId === customerId)).sort((a, b) => a.ts.localeCompare(b.ts));
  }

  compareRuns(baselineId: string, candidateId: string): RunComparison {
    const baseline = this.getRunRecord(baselineId);
    const candidate = this.getRunRecord(candidateId);
    const br = this.getValidation(baselineId);
    const cr = this.getValidation(candidateId);
    const scenarioIds = new Set([...baseline.assignments, ...candidate.assignments].map((a) => a.scenarioId));
    const byScenario = Array.from(scenarioIds).map((scenarioId) => {
      const scenario = this.store.scenarios.get(scenarioId);
      const count = (report: ValidationReport | null) => {
        const list = report?.customers.filter((c) => c.scenarioId === scenarioId) ?? [];
        return { passed: list.filter((c) => c.status === 'pass').length, failed: list.filter((c) => c.status !== 'pass').length };
      };
      return { scenarioId, scenarioName: scenario?.name ?? scenarioId, baseline: count(br), candidate: count(cr) };
    });
    const delta = (k: 'passed' | 'failed' | 'inconclusive') => (cr?.summary[k] ?? 0) - (br?.summary[k] ?? 0);
    return {
      baseline: { run: baseline, report: br },
      candidate: { run: candidate, report: cr },
      deltas: {
        passed: delta('passed'),
        failed: delta('failed'),
        inconclusive: delta('inconclusive'),
        attributionAccuracy: cr?.summary.attributionAccuracy != null && br?.summary.attributionAccuracy != null ? cr.summary.attributionAccuracy - br.summary.attributionAccuracy : null,
      },
      byScenario,
    };
  }

  // ---------------------------------------------------------------------------
  // Collector
  // ---------------------------------------------------------------------------

  collect(req: CollectRequest): Promise<CollectResponse> {
    return this.collector.collect(req);
  }

  // ---------------------------------------------------------------------------
  // Integrations & preflight
  // ---------------------------------------------------------------------------

  getIntegrations(projectId: string): IntegrationStatus[] {
    const project = this.getProject(projectId);
    const adapter = createAttributionAdapter(project.sut, 'describe');
    const desc = adapter.describe();
    const caps = this.deps.driverCapabilities;
    const sutList: IntegrationStatus[] = [
      {
        id: 'attribution_local',
        name: 'Syntro local attribution system (system under test)',
        category: 'attribution',
        maturity: 'functional',
        healthy: project.sut.adapter === 'local' ? true : null,
        summary: project.sut.adapter === 'local' ? `Active · ${desc.notes}` : 'Available — bundled SUT with configurable faults.',
        details: project.sut,
      },
      {
        id: 'attribution_file',
        name: 'Generic attribution adapter — file exchange',
        category: 'attribution',
        maturity: 'prototype',
        healthy: project.sut.adapter === 'file' ? !!project.sut.external?.resultsDocument : null,
        summary: 'Exports attribution-facing events; imports AttributionResult[] JSON produced by the external system.',
      },
      {
        id: 'attribution_http',
        name: 'Generic attribution adapter — HTTP',
        category: 'attribution',
        maturity: 'prototype',
        healthy: project.sut.adapter === 'http' ? !!(project.sut.external?.ingestUrl && project.sut.external?.resultsUrl) : null,
        summary: 'POST events to a test ingestion endpoint and GET results. Contract documented; not verified against a vendor.',
      },
      { id: 'attribution_salesforce', name: 'Salesforce Marketing Cloud Intelligence', category: 'attribution', maturity: 'not_implemented', healthy: null, summary: 'Planned vendor adapter on top of the HTTP contract.' },
      { id: 'attribution_adobe', name: 'Adobe Customer Journey Analytics', category: 'attribution', maturity: 'not_implemented', healthy: null, summary: 'Planned vendor adapter on top of the HTTP contract.' },
    ];
    return [
      {
        id: 'website_sdk',
        name: 'Website SDK (syntro.js)',
        category: 'website',
        maturity: 'functional',
        healthy: true,
        summary: project.website.kind === 'bundled_demo_store' ? 'Installed on the bundled demo store; routes synthetic sessions to the isolated collector.' : `External website ${project.website.baseUrl}: install the SDK snippet and run the preflight check.`,
        details: { baseUrl: project.website.baseUrl, isolationGuard: project.website.isolationGuard },
      },
      {
        id: 'gtm',
        name: 'Google Tag Manager integration',
        category: 'tag_manager',
        maturity: 'prototype',
        healthy: null,
        summary: 'Container template and blocking-trigger recipe provided (sdk/gtm). Not verified against a live container.',
      },
      {
        id: 'collector',
        name: 'Isolated test data collector',
        category: 'collector',
        maturity: 'functional',
        healthy: true,
        summary: this.config.collectorEndpoint === 'postmessage' ? 'In-browser collector (postMessage transport) — browser-hosted engine.' : `HTTP collector at ${this.config.collectorEndpoint}`,
      },
      {
        id: 'test_checkout',
        name: 'Test checkout',
        category: 'website',
        maturity: project.website.kind === 'bundled_demo_store' ? 'functional' : project.website.testCheckoutAuthorized ? 'prototype' : 'not_implemented',
        healthy: project.website.kind === 'bundled_demo_store' ? true : project.website.testCheckoutAuthorized,
        summary: project.website.kind === 'bundled_demo_store' ? 'Demo store checkout creates flagged test orders; no payment, fulfilment or revenue.' : 'External sites require an authorized test checkout integration before conversion scenarios run.',
      },
      ...sutList,
      { id: 'channel_meta', name: 'Meta Ads — simulated environment', category: 'channel', maturity: 'functional', healthy: true, summary: 'Mock feed with configurable creative; appends a synthetic fbclid. Not the real platform.' },
      { id: 'channel_google', name: 'Google Ads — simulated environment', category: 'channel', maturity: 'functional', healthy: true, summary: 'Mock search results page with a sponsored result; appends a synthetic gclid.' },
      { id: 'channel_linkedin', name: 'LinkedIn Ads — simulated environment', category: 'channel', maturity: 'functional', healthy: true, summary: 'Mock feed with sponsored content; appends a synthetic li_fat_id.' },
      { id: 'channel_email', name: 'Email — simulated inbox', category: 'channel', maturity: 'functional', healthy: true, summary: 'Mock inbox rendering the campaign email with a tracked CTA.' },
      { id: 'channel_messaging', name: 'SMS / WhatsApp — simulated messaging', category: 'channel', maturity: 'functional', healthy: true, summary: 'Mock conversation view with a tracked link.' },
      { id: 'platform_feed', name: 'Synthetic source-platform data adapter', category: 'channel', maturity: 'functional', healthy: true, summary: 'Emits approved synthetic click / impression / segment / delivery records for test ingestion.' },
      {
        id: 'execution',
        name: `Browser automation — ${this.deps.driverName}`,
        category: 'execution',
        maturity: 'functional',
        healthy: true,
        summary: caps.realIsolation ? 'Real headless Chromium with one isolated context per synthetic customer; screenshots captured.' : 'Sandboxed-iframe execution inside this browser tab (isolated storage per customer); DOM snapshots instead of screenshots.',
        details: caps,
      },
    ];
  }

  async runPreflight(projectId: string): Promise<PreflightReport> {
    const project = this.getProject(projectId);
    const template = getTemplate('preflight')!;
    let journey = this.store.journeys.list((j) => j.projectId === project.id && j.templateKey === 'preflight')[0];
    if (!journey) {
      journey = instantiateTemplate(template, project.id);
      journey.tags = ['internal'];
      this.store.journeys.put(journey);
    }
    let scenario = this.store.scenarios.list((s) => s.projectId === project.id && s.templateKey === 'preflight')[0];
    if (!scenario) {
      const ts = nowIso();
      scenario = { id: randomId('scn'), projectId: project.id, name: 'Preflight check', description: 'Internal routing and isolation check', journeyId: journey.id, faults: [], defaultCustomerCount: 1, tags: ['internal'], templateKey: 'preflight', createdAt: ts, updatedAt: ts };
      this.store.scenarios.put(scenario);
    }
    const run = this.createRun(project, [{ scenarioId: scenario.id, customerCount: 1 }], { kind: 'preflight', concurrency: 1 });
    await this.runner.start(run.id);
    const finished = this.getRunRecord(run.id);
    const customer = this.listCustomers(run.id)[0];
    const ledger = this.getLedger(run.id)[0];
    const events = this.getEvents(run.id);
    const log = this.store.collectorLog.list((l) => l.runId === run.id);
    const rejected = log.filter((l) => l.kind === 'rejected').length;
    const checks: PreflightReport['checks'] = [
      {
        id: 'execution',
        name: 'Synthetic session reached the website',
        status: customer?.status === 'completed' ? 'pass' : 'fail',
        detail: customer?.status === 'completed' ? `Visited ${ledger?.executed.filter((a) => a.status === 'ok').length ?? 0} pages on ${project.website.baseUrl}` : `Journey ${customer?.status ?? 'unknown'}: ${customer?.error ?? ledger?.executed.find((a) => a.status === 'failed')?.error ?? 'see run logs'}`,
      },
      {
        id: 'token',
        name: 'Signed session token accepted by the collector',
        status: events.length > 0 && rejected === 0 ? 'pass' : events.length === 0 ? 'fail' : 'fail',
        detail: events.length > 0 ? `${events.length} events accepted, ${rejected} rejected` : 'No events reached the collector — the SDK may not be installed, or the token was stripped from the landing URL.',
      },
      {
        id: 'routing',
        name: 'Events bound to the synthetic run',
        status: events.length > 0 && events.every((e) => e.runId === run.id && e.isSynthetic) ? 'pass' : events.length ? 'fail' : 'inconclusive',
        detail: events.length ? `All ${events.length} events carry run ${run.id} and is_synthetic=true` : 'No events to inspect',
      },
      {
        id: 'isolation',
        name: 'No synthetic traffic in production analytics',
        status: ledger?.isolationCheck?.performed ? (ledger.isolationCheck.productionEventsObserved === 0 ? 'pass' : 'fail') : 'inconclusive',
        detail: ledger?.isolationCheck?.note ?? 'Isolation check only runs against the bundled demo store; verify external sites with the GTM blocking trigger.',
      },
    ];
    const report: PreflightReport = { id: randomId('pre'), projectId: project.id, ts: nowIso(), passed: checks.every((c) => c.status === 'pass'), checks };
    this.store.preflights.put(report);
    this.logger.log('info', `Preflight ${report.passed ? 'passed' : 'failed'} for ${project.name}`, { runId: finished.id }, { runId: finished.id });
    return report;
  }

  getLatestPreflight(projectId: string): PreflightReport | null {
    return this.store.preflights.list((p) => p.projectId === projectId).sort((a, b) => b.ts.localeCompare(a.ts))[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  getOverview(): OverviewStats {
    const runs = this.listRuns();
    const reports = this.store.validationReports.list();
    const reportByRun = new Map(reports.map((r) => [r.runId, r]));
    const finished = runs.filter((r) => r.summary && r.finishedAt).sort((a, b) => a.finishedAt!.localeCompare(b.finishedAt!));
    const issues: Record<string, number> = {};
    let passed = 0;
    let failed = 0;
    let inconclusive = 0;
    let customers = 0;
    let accNum = 0;
    let accDen = 0;
    for (const run of finished) {
      const s = run.summary!;
      passed += s.passed;
      failed += s.failed;
      inconclusive += s.inconclusive;
      customers += s.customers;
      for (const [type, n] of Object.entries(s.failuresByType)) issues[type] = (issues[type] ?? 0) + n;
      const report = reportByRun.get(run.id);
      if (report) {
        const attr = report.customers.flatMap((c) => c.tests).filter((t) => t.category === 'attribution' && t.status !== 'inconclusive');
        accNum += attr.filter((t) => t.status === 'pass').length;
        accDen += attr.length;
      }
    }
    return {
      projects: this.store.projects.count(),
      runs: runs.length,
      customersSimulated: customers,
      testsPassed: passed,
      testsFailed: failed,
      testsInconclusive: inconclusive,
      attributionAccuracy: accDen ? accNum / accDen : null,
      commonIssues: Object.entries(issues)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      trend: finished.slice(-20).map((r) => ({ runId: r.id, runName: r.name, finishedAt: r.finishedAt!, attributionAccuracy: r.summary!.attributionAccuracy, passed: r.summary!.passed, failed: r.summary!.failed })),
      recentRuns: runs.slice(0, 8),
    };
  }

  resetAll(): void {
    if (this.runner.activeRunIds().length) throw new EngineError('busy', 'Cannot reset while simulations are running', 409);
    this.store.resetAll();
  }
}

function clampCount(n: number): number {
  return Math.max(1, Math.min(100, Math.floor(Number(n) || 1)));
}
