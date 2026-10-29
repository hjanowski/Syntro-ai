import type {
  AttributionResult,
  CollectedEvent,
  CreateJourneyRequest,
  CreateProjectRequest,
  CreateScenarioRequest,
  CustomerDetail,
  EngineInfo,
  ExecutionLogEntry,
  IntegrationStatus,
  JourneyDefinition,
  JourneyTemplate,
  JourneyValidationResult,
  LedgerEntry,
  OverviewStats,
  PreflightReport,
  PreviewCustomersRequest,
  Project,
  RerunRequest,
  RunComparison,
  RunDetail,
  Scenario,
  ScenarioPreset,
  SimulationRun,
  StartSimulationRequest,
  SyntheticCustomer,
  UpdateJourneyRequest,
  UpdateProjectRequest,
  UpdateScenarioRequest,
  ValidationReport,
} from '@syntro/engine';

/**
 * Layer 2 → Layer 1 client. Mirrors the v1 API contract one-to-one. Two transports:
 * HttpEngineClient (Node host over /v1) and EmbeddedEngineClient (engine running in this tab).
 */
export interface EngineClient {
  readonly mode: 'remote' | 'embedded';
  info(): Promise<EngineInfo>;
  overview(): Promise<OverviewStats>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project>;
  createProject(req: CreateProjectRequest): Promise<Project>;
  updateProject(id: string, req: UpdateProjectRequest): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  seedProject(id: string): Promise<{ journeys: JourneyDefinition[]; scenarios: Scenario[] }>;
  getIntegrations(projectId: string): Promise<IntegrationStatus[]>;
  runPreflight(projectId: string): Promise<PreflightReport>;
  getLatestPreflight(projectId: string): Promise<PreflightReport | null>;
  previewCustomers(projectId: string, req: PreviewCustomersRequest): Promise<SyntheticCustomer[]>;

  listJourneyTemplates(): Promise<JourneyTemplate[]>;
  listJourneys(projectId?: string): Promise<JourneyDefinition[]>;
  getJourney(id: string): Promise<JourneyDefinition>;
  createJourney(req: CreateJourneyRequest): Promise<JourneyDefinition>;
  createJourneyFromTemplate(templateKey: string, projectId: string | null): Promise<JourneyDefinition>;
  updateJourney(id: string, req: UpdateJourneyRequest): Promise<JourneyDefinition>;
  deleteJourney(id: string): Promise<void>;
  validateJourney(def: Pick<JourneyDefinition, 'nodes' | 'edges'>): Promise<JourneyValidationResult>;

  listScenarioPresets(): Promise<ScenarioPreset[]>;
  listScenarios(projectId?: string): Promise<Scenario[]>;
  getScenario(id: string): Promise<Scenario>;
  createScenario(req: CreateScenarioRequest): Promise<Scenario>;
  updateScenario(id: string, req: UpdateScenarioRequest): Promise<Scenario>;
  deleteScenario(id: string): Promise<void>;

  listRuns(projectId?: string): Promise<SimulationRun[]>;
  getRun(runId: string): Promise<RunDetail>;
  startSimulation(req: StartSimulationRequest): Promise<SimulationRun>;
  stopRun(runId: string): Promise<SimulationRun>;
  rerun(runId: string, req: RerunRequest): Promise<SimulationRun>;
  revalidate(runId: string): Promise<SimulationRun>;
  deleteRun(runId: string): Promise<void>;
  listCustomers(runId: string): Promise<SyntheticCustomer[]>;
  getCustomer(customerId: string): Promise<CustomerDetail>;
  getLedger(runId: string): Promise<LedgerEntry[]>;
  getEvents(runId: string): Promise<CollectedEvent[]>;
  getAttribution(runId: string): Promise<AttributionResult[]>;
  getValidation(runId: string): Promise<ValidationReport | null>;
  getLogs(runId: string, customerId?: string): Promise<ExecutionLogEntry[]>;
  compareRuns(baseline: string, candidate: string): Promise<RunComparison>;

  ensureDemoProject(): Promise<Project>;
  resetAll(): Promise<void>;
}
