/**
 * Syntro Engine API — contract version 1.
 *
 * Every Layer 2 → Layer 1 interaction goes through these request/response shapes,
 * whether transported over HTTP (`/v1/...`, see server/src/api/http.ts) or called
 * in-process by the embedded engine client. Responses are always enveloped.
 */
import type {
  AttributionPolicy,
  AttributionResult,
  CollectedEvent,
  CollectorLogEntry,
  ExecutionLogEntry,
  IntegrationStatus,
  JourneyDefinition,
  JourneyEdge,
  JourneyNode,
  LedgerEntry,
  PlatformRecord,
  PreflightReport,
  Project,
  RunAssignment,
  Scenario,
  ScenarioFault,
  SimulationRun,
  SyntheticCustomer,
  SystemUnderTestConfig,
  ValidationReport,
  WebsiteConfig,
} from '../domain/types.ts';

export const API_VERSION = 'v1' as const;

export type ApiError = { code: string; message: string; details?: unknown };
export type ApiResponse<T> = { ok: true; data: T; version: typeof API_VERSION } | { ok: false; error: ApiError; version: typeof API_VERSION };

export function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, version: API_VERSION };
}

export function fail(code: string, message: string, details?: unknown): ApiResponse<never> {
  return { ok: false, error: { code, message, details }, version: API_VERSION };
}

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

// ---- Projects -------------------------------------------------------------

export interface CreateProjectRequest {
  name: string;
  description?: string;
  website?: Partial<WebsiteConfig>;
  attributionPolicy?: Partial<AttributionPolicy>;
  sut?: Partial<SystemUnderTestConfig>;
  /** Seed the project with the bundled demo journeys and scenarios. */
  seedDemo?: boolean;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  website?: Partial<WebsiteConfig>;
  attributionPolicy?: Partial<AttributionPolicy>;
  sut?: Partial<SystemUnderTestConfig>;
}

// ---- Journeys & scenarios --------------------------------------------------

export interface CreateJourneyRequest {
  projectId: string | null;
  name: string;
  description?: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  tags?: string[];
}

export interface UpdateJourneyRequest {
  name?: string;
  description?: string;
  nodes?: JourneyNode[];
  edges?: JourneyEdge[];
  tags?: string[];
}

export interface CreateScenarioRequest {
  projectId: string;
  name: string;
  description?: string;
  journeyId: string;
  faults?: ScenarioFault[];
  defaultCustomerCount?: number;
  tags?: string[];
}

export interface UpdateScenarioRequest {
  name?: string;
  description?: string;
  journeyId?: string;
  faults?: ScenarioFault[];
  defaultCustomerCount?: number;
  tags?: string[];
}

export interface JourneyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Linear preview of the journey for customer index 1. */
  preview: { nodeId: string; type: string; label: string }[];
}

// ---- Customers -------------------------------------------------------------

export interface PreviewCustomersRequest {
  count: number;
  seed?: number;
  attributes?: Record<string, string | number | boolean>;
}

// ---- Simulations -----------------------------------------------------------

export interface StartSimulationRequest {
  projectId: string;
  name?: string;
  assignments: RunAssignment[];
  seed?: number;
  concurrency?: number;
}

export interface RerunRequest {
  mode: 'all' | 'failed_only';
  name?: string;
}

export interface RunDetail {
  run: SimulationRun;
  customers: SyntheticCustomer[];
  project: Project;
  scenarios: Scenario[];
}

export interface CustomerDetail {
  customer: SyntheticCustomer;
  ledger: LedgerEntry | null;
  events: CollectedEvent[];
  collectorLog: CollectorLogEntry[];
  platformRecords: PlatformRecord[];
  attributionResults: AttributionResult[];
  logs: ExecutionLogEntry[];
}

// ---- Collector -------------------------------------------------------------

/** Event envelope emitted by the website SDK (sdk/syntro.js). Snake case on the wire. */
export interface SdkEvent {
  event_id: string;
  type: string;
  ts: string;
  url: string;
  path: string;
  referrer: string;
  title?: string;
  anonymous_id: string;
  user?: { email?: string };
  utm?: Record<string, string>;
  click_ids?: Record<string, string>;
  props?: Record<string, unknown>;
  device?: { user_agent?: string; viewport?: string };
  sdk_version?: string;
}

export interface CollectRequest {
  token: string;
  events: SdkEvent[];
}

export interface CollectResponse {
  accepted: number;
  rejected: number;
  runId?: string;
  customerId?: string;
}

// ---- Results ---------------------------------------------------------------

export interface RunComparison {
  baseline: { run: SimulationRun; report: ValidationReport | null };
  candidate: { run: SimulationRun; report: ValidationReport | null };
  deltas: {
    passed: number;
    failed: number;
    inconclusive: number;
    attributionAccuracy: number | null;
  };
  /** Per scenario: status change between runs. */
  byScenario: { scenarioId: string; scenarioName: string; baseline: { passed: number; failed: number }; candidate: { passed: number; failed: number } }[];
}

export interface OverviewStats {
  projects: number;
  runs: number;
  customersSimulated: number;
  testsPassed: number;
  testsFailed: number;
  testsInconclusive: number;
  attributionAccuracy: number | null;
  commonIssues: { type: string; count: number }[];
  trend: { runId: string; runName: string; finishedAt: string; attributionAccuracy: number | null; passed: number; failed: number }[];
  recentRuns: SimulationRun[];
}

export interface EngineInfo {
  name: 'syntro-engine';
  apiVersion: typeof API_VERSION;
  host: 'node' | 'browser';
  driver: string;
  capabilities: { screenshots: boolean; realBrowserIsolation: boolean; persistent: boolean };
  siteBaseUrl: string;
  collectorEndpoint: string;
}

export type { IntegrationStatus, PreflightReport };
