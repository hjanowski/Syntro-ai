/**
 * Syntro domain model — shared by the engine (Layer 1) and, through the versioned
 * API contracts, by the SaaS experience (Layer 2).
 *
 * All timestamps are ISO-8601 strings. All money values are plain numbers in the
 * project currency (prototype: USD).
 */

export type Channel =
  | 'email'
  | 'meta'
  | 'google'
  | 'linkedin'
  | 'sms'
  | 'whatsapp'
  | 'direct'
  | 'referral'
  | 'unknown';

export const MARKETING_CHANNELS: Channel[] = ['email', 'meta', 'google', 'linkedin', 'sms', 'whatsapp'];

export type AttributionModel = 'first_touch' | 'last_touch' | 'linear';
export const ATTRIBUTION_MODELS: AttributionModel[] = ['first_touch', 'last_touch', 'linear'];

export type DeviceKind = 'desktop' | 'mobile' | 'tablet';

export interface DeviceProfile {
  kind: DeviceKind;
  os: string;
  browser: string;
  userAgent: string;
  viewport: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// Projects & system under test
// ---------------------------------------------------------------------------

export interface AttributionPolicy {
  /** What the business intends attribution to do. Expected results are derived from this. */
  models: AttributionModel[];
  lookbackDays: number;
}

export interface SystemUnderTestFaults {
  /** Touchpoints from these channels are silently dropped by the attribution system. */
  ignoreChannels?: Channel[];
  /** Campaign id `from` is reported as `to`. */
  misattributeCampaign?: { from: string; to: string } | null;
}

export interface SystemUnderTestConfig {
  /** Which attribution adapter produces "actual" results. `local` is the bundled reference SUT. */
  adapter: 'local' | 'file' | 'http';
  models: AttributionModel[];
  lookbackDays: number;
  /** cookie_only = no cross-device/email stitching; cookie_and_email = identity graph on identify events. */
  identityResolution: 'cookie_only' | 'cookie_and_email';
  dedupeConversionsByOrderId: boolean;
  /** Maps click-id query parameters to channels, e.g. { fbclid: 'meta', gclid: 'google' }. */
  clickIdMappings: Record<string, Channel>;
  /** Maps utm_source values to channels, e.g. { facebook: 'meta', google: 'google' }. */
  utmSourceMappings: Record<string, Channel>;
  /** Join unknown click ids against synthetic platform click records (source-platform data). */
  usePlatformClickRecords: boolean;
  faults: SystemUnderTestFaults;
  external?: {
    ingestUrl?: string;
    resultsUrl?: string;
    /** For the file adapter: JSON document (AttributionResult[]) provided by the external system. */
    resultsDocument?: string;
  };
}

export interface WebsiteConfig {
  /** Absolute base URL of the instrumented website, e.g. http://localhost:4100/sites/store */
  baseUrl: string;
  kind: 'bundled_demo_store' | 'external';
  /** Demo store: production analytics tags are suppressed for synthetic sessions when true. */
  isolationGuard: boolean;
  /** Conversion scenarios on external sites require an authorized test checkout integration. */
  testCheckoutAuthorized: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  website: WebsiteConfig;
  attributionPolicy: AttributionPolicy;
  sut: SystemUnderTestConfig;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Journeys (graph definitions authored in the visual builder or as templates)
// ---------------------------------------------------------------------------

export type NodeType =
  | 'start'
  | 'email_open'
  | 'email_click'
  | 'ad_view'
  | 'ad_click'
  | 'message_receive'
  | 'message_click'
  | 'enter_segment'
  | 'visit_page'
  | 'navigate'
  | 'search'
  | 'view_product'
  | 'add_to_cart'
  | 'view_cart'
  | 'fill_form'
  | 'register'
  | 'login'
  | 'checkout'
  | 'conversion_event'
  | 'wait'
  | 'branch'
  | 'change_device'
  | 'new_session'
  | 'clear_cookies'
  | 'inject_failure'
  | 'end';

export type NodeCategory = 'marketing' | 'website' | 'logic';

export const NODE_CATEGORY: Record<NodeType, NodeCategory> = {
  start: 'logic',
  email_open: 'marketing',
  email_click: 'marketing',
  ad_view: 'marketing',
  ad_click: 'marketing',
  message_receive: 'marketing',
  message_click: 'marketing',
  enter_segment: 'marketing',
  visit_page: 'website',
  navigate: 'website',
  search: 'website',
  view_product: 'website',
  add_to_cart: 'website',
  view_cart: 'website',
  fill_form: 'website',
  register: 'website',
  login: 'website',
  checkout: 'website',
  conversion_event: 'website',
  wait: 'logic',
  branch: 'logic',
  change_device: 'logic',
  new_session: 'logic',
  clear_cookies: 'logic',
  inject_failure: 'logic',
  end: 'logic',
};

export interface CampaignConfig {
  channel: Channel;
  campaignId: string;
  campaignName?: string;
  creativeId?: string;
  adsetId?: string;
  /** utm_* values the marketer configured on the ad/email destination URL. */
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>>;
  /** Path on the website the touchpoint lands on, e.g. "index.html" or "product.html?id=jacket". */
  landingPath?: string;
  headline?: string;
  body?: string;
  subject?: string;
}

export type BranchCondition =
  | { kind: 'customer_index_in'; values: number[] }
  | { kind: 'customer_index_mod'; mod: number; equals: number }
  | { kind: 'attribute_equals'; key: string; value: string | number | boolean }
  | { kind: 'probability'; p: number };

export interface JourneyNode {
  id: string;
  type: NodeType;
  label?: string;
  /** Type-specific configuration. Keys documented in docs/JOURNEYS.md and journeys/node-config.ts. */
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface JourneyEdge {
  id: string;
  source: string;
  target: string;
  /** For branch nodes: which outcome this edge represents. */
  condition?: 'yes' | 'no';
  label?: string;
}

export interface JourneyDefinition {
  id: string;
  projectId: string | null;
  name: string;
  description?: string;
  version: 1;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  tags: string[];
  isTemplate: boolean;
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Scenarios & failure injection
// ---------------------------------------------------------------------------

export type ScenarioFault =
  /** The ad/email destination URL is missing UTM parameters (click id still present). */
  | { kind: 'missing_utm'; channel: Channel }
  /** The destination carries a wrong utm_campaign value. */
  | { kind: 'wrong_campaign_param'; channel: Channel; campaignId: string }
  /** The event collector loses these website events (simulates lost tags/network). */
  | { kind: 'drop_events'; eventTypes: string[] }
  /** The event collector receives these events twice (simulates double-firing tags). */
  | { kind: 'duplicate_events'; eventTypes: string[] }
  /** These events arrive late to the attribution system. */
  | { kind: 'delay_events'; eventTypes: string[]; delayMs: number }
  /** The website SDK never sends identify events (breaks email-based stitching). */
  | { kind: 'suppress_identify' };

export type ScenarioFaultKind = ScenarioFault['kind'];

export interface Scenario {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  journeyId: string;
  faults: ScenarioFault[];
  defaultCustomerCount: number;
  tags: string[];
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Simulation runs & synthetic customers
// ---------------------------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'finalizing' | 'awaiting_results' | 'completed' | 'failed' | 'stopped';

export interface RunAssignment {
  scenarioId: string;
  customerCount: number;
}

export interface RunProgress {
  total: number;
  completed: number;
  failed: number;
  running: number;
  stopped: number;
}

export interface SimulationRun {
  id: string;
  projectId: string;
  name: string;
  kind: 'simulation' | 'preflight';
  status: RunStatus;
  assignments: RunAssignment[];
  seed: number;
  concurrency: number;
  driver: string;
  parentRunId?: string;
  rerunMode?: 'all' | 'failed_only';
  progress: RunProgress;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Snapshot of the SUT configuration the run was validated against. */
  sutSnapshot: SystemUnderTestConfig;
  policySnapshot: AttributionPolicy;
  summary?: ValidationSummary;
  stopRequested?: boolean;
}

export type CustomerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

export interface SyntheticSession {
  id: string;
  /** Browser context (process-level isolation: Playwright context / sandboxed iframe). */
  contextId: string;
  /** Cookie jar epoch — a new jar id means first-party cookies were cleared or the device changed. */
  cookieJarId: string;
  device: DeviceProfile;
  startedAt: string;
  virtualStartedAt: string;
  reason: 'initial' | 'new_session' | 'change_device' | 'clear_cookies' | 'virtual_wait';
}

export interface SyntheticCustomer {
  id: string;
  runId: string;
  projectId: string;
  scenarioId: string;
  journeyId: string;
  /** 1-based index within the run. */
  index: number;
  firstName: string;
  lastName: string;
  /** Always under a reserved, non-routable domain — never deliverable to a real inbox. */
  email: string;
  /** Always in a fictional range — never dialable to a real person. */
  phone: string;
  device: DeviceProfile;
  attributes: Record<string, string | number | boolean>;
  sessions: SyntheticSession[];
  activeFaults: ScenarioFault[];
  status: CustomerStatus;
  currentStep?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

// ---------------------------------------------------------------------------
// Ground truth ledger
// ---------------------------------------------------------------------------

export type EvidenceKind =
  | 'screenshot'
  | 'dom_snapshot'
  | 'url'
  | 'log'
  | 'collected_event'
  | 'ledger'
  | 'attribution_result'
  | 'platform_record'
  | 'fault_injection'
  | 'configuration';

export interface Evidence {
  kind: EvidenceKind;
  label: string;
  /** Inline payload (JSON-serialisable). Screenshots are JPEG data URLs. */
  data?: unknown;
  /** Reference to a stored object (event id, ledger action id, result id). */
  ref?: string;
  ts?: string;
}

export interface IntendedStep {
  nodeId: string;
  type: NodeType;
  label: string;
}

export interface ExecutedAction {
  id: string;
  nodeId: string;
  type: NodeType;
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  attempts: number;
  startedAt: string;
  finishedAt: string;
  /** Virtual-clock timestamp used for attribution expectations. */
  virtualTs: string;
  sessionId?: string;
  details: Record<string, unknown>;
  evidence: Evidence[];
  error?: string;
}

export interface GroundTruthTouchpoint {
  id: string;
  nodeId: string;
  channel: Channel;
  /** Campaign the marketer intended. */
  campaignId: string;
  campaignName?: string;
  creativeId?: string;
  clickId?: string;
  clickIdParam?: string;
  /** UTM values actually present on the landing URL (after any destination-config fault). */
  observedUtm: Record<string, string>;
  /** UTM values the marketer intended. */
  intendedUtm: Record<string, string>;
  ts: string;
  sessionId: string;
  cookieJarId: string;
  landingUrl: string;
  faultApplied?: ScenarioFaultKind;
}

export interface GroundTruthImpression {
  id: string;
  nodeId: string;
  channel: Channel;
  campaignId: string;
  creativeId?: string;
  ts: string;
  sessionId: string;
}

export interface GroundTruthConversion {
  id: string;
  nodeId: string;
  type: 'purchase' | 'lead' | 'signup' | 'custom';
  eventType: string;
  value: number;
  orderId?: string;
  ts: string;
  sessionId: string;
  cookieJarId: string;
  items?: { productId: string; name: string; price: number; quantity: number }[];
}

export interface ExpectedIdentity {
  email: string;
  sessions: { sessionId: string; cookieJarId: string; contextId: string; identifiedWithEmail: boolean }[];
  /** Groups of cookie jar ids a correct attribution system should be able to link together. */
  linkGroups: string[][];
  /** True when the journey can only be attributed correctly with cross-cookie (email) stitching. */
  stitchRequired: boolean;
}

export interface Credit {
  channel: Channel;
  campaignId: string;
  /** Monetary credit (value × share). */
  credit: number;
  /** Fraction of the conversion, 0..1. */
  share: number;
}

export interface ExpectedAttribution {
  conversionId: string;
  model: AttributionModel;
  lookbackDays: number;
  credits: Credit[];
  eligibleTouchpointIds: string[];
  ineligibleTouchpointIds: string[];
  note?: string;
}

export type LedgerStatus = 'in_progress' | 'complete' | 'incomplete';

export interface LedgerEntry {
  id: string;
  runId: string;
  projectId: string;
  customerId: string;
  scenarioId: string;
  journeyId: string;
  intended: IntendedStep[];
  executed: ExecutedAction[];
  touchpoints: GroundTruthTouchpoint[];
  impressions: GroundTruthImpression[];
  conversions: GroundTruthConversion[];
  identity: ExpectedIdentity;
  expectedAttribution: ExpectedAttribution[];
  faults: ScenarioFault[];
  segments: { segmentId: string; ts: string }[];
  status: LedgerStatus;
  /** Production-analytics leakage check result captured at the end of the journey (demo store only). */
  isolationCheck?: { performed: boolean; productionEventsObserved: number; note: string };
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Observed tracking data (event collector)
// ---------------------------------------------------------------------------

export interface CollectedEvent {
  id: string;
  projectId: string;
  runId: string;
  scenarioId: string;
  syntheticCustomerId: string;
  sessionId: string;
  isSynthetic: true;
  eventType: string;
  source: 'website' | 'platform_feed';
  /** Client timestamp (virtual clock aware). */
  ts: string;
  receivedAt: string;
  anonymousId: string;
  userEmail?: string;
  /** SHA-256 of the lower-cased email — the only identity key the SUT receives. */
  userKey?: string;
  url: string;
  path: string;
  referrer: string;
  title?: string;
  utm: Record<string, string>;
  clickIds: Record<string, string>;
  campaignId?: string;
  revenue?: number;
  currency?: string;
  orderId?: string;
  items?: unknown[];
  props: Record<string, unknown>;
  device: { userAgent?: string; viewport?: string; declared?: DeviceProfile };
  delivery: { delayMs: number; duplicateOf?: string; deliveredToSut: boolean };
  faultsApplied: ScenarioFaultKind[];
  sdkVersion?: string;
}

export interface CollectorLogEntry {
  id: string;
  runId: string;
  customerId: string;
  ts: string;
  kind: 'accepted' | 'dropped' | 'duplicated' | 'delayed' | 'rejected';
  eventType: string;
  reason: string;
  eventId?: string;
}

/** Synthetic source-platform record (what an ad platform / CDP would log server-side). */
export interface PlatformRecord {
  id: string;
  runId: string;
  customerId: string;
  kind: 'ad_click' | 'ad_impression' | 'segment_membership' | 'message_delivery' | 'email_open';
  channel: Channel;
  campaignId: string;
  creativeId?: string;
  clickId?: string;
  ts: string;
  /** Hashed contact identifier, as platforms would expose it. */
  contactHash?: string;
  segmentId?: string;
}

// ---------------------------------------------------------------------------
// Attribution results (adapter contract output)
// ---------------------------------------------------------------------------

/** What the attribution system under test is allowed to see — no synthetic customer ids. */
export interface AttributionFacingEvent {
  eventId: string;
  ts: string;
  type: string;
  anonymousId: string;
  /** Hashed email when the user identified; never raw contact data. */
  userKey?: string;
  url: string;
  path: string;
  referrer: string;
  utm: Record<string, string>;
  clickIds: Record<string, string>;
  revenue?: number;
  orderId?: string;
}

export interface AttributedTouchpoint {
  touchpointId: string;
  channel: Channel;
  campaignId: string;
  ts: string;
  anonymousId: string;
  eligible: boolean;
  reason?: string;
}

export interface AttributionResult {
  id: string;
  runId: string;
  adapter: string;
  model: AttributionModel;
  lookbackDays: number;
  conversion: {
    id: string;
    orderId?: string;
    type: string;
    value: number;
    ts: string;
    anonymousId: string;
  };
  identity: { id: string; anonymousIds: string[]; userKey?: string };
  journey: AttributedTouchpoint[];
  credits: Credit[];
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Validation & diagnostics
// ---------------------------------------------------------------------------

export type TestStatus = 'pass' | 'fail' | 'inconclusive';
export type TestCategory = 'execution' | 'tracking' | 'identity' | 'attribution' | 'isolation';

export type FailureType =
  | 'execution_failure'
  | 'missing_touchpoint'
  | 'campaign_parameter_mismatch'
  | 'missing_utm_parameters'
  | 'lost_conversion_event'
  | 'duplicate_conversion'
  | 'delayed_event'
  | 'identity_stitching_failure'
  | 'unexpected_session_change'
  | 'conversion_not_attributed'
  | 'incorrect_attribution_credit'
  | 'incorrect_lookback_window'
  | 'wrong_campaign_attribution'
  | 'touchpoint_dropped_by_attribution'
  | 'production_leakage';

export type PointOfFailure =
  | 'journey_execution'
  | 'ad_destination_configuration'
  | 'website_sdk'
  | 'event_collector'
  | 'conversion_tracking'
  | 'attribution_ingestion'
  | 'identity_resolution'
  | 'attribution_model_configuration'
  | 'analytics_isolation'
  | 'unknown';

export interface FailureDiagnostic {
  type: FailureType;
  suspectedPointOfFailure: PointOfFailure;
  explanation: string;
  evidence: Evidence[];
  recommendedSteps: string[];
}

export interface TestResult {
  id: string;
  customerId: string;
  testId: string;
  name: string;
  category: TestCategory;
  status: TestStatus;
  expected: unknown;
  observed: unknown;
  summary: string;
  failure?: FailureDiagnostic;
}

export interface CustomerValidation {
  customerId: string;
  customerName: string;
  scenarioId: string;
  scenarioName: string;
  journeyId: string;
  status: TestStatus;
  tests: TestResult[];
}

export interface ExpectedVsActualRow {
  customerId: string;
  customerName: string;
  conversionId: string;
  orderId?: string;
  value: number;
  model: AttributionModel;
  expected: Credit[];
  actual: Credit[] | null;
  match: boolean;
  status: TestStatus;
}

export interface ValidationSummary {
  customers: number;
  scenarios: number;
  tests: number;
  passed: number;
  failed: number;
  inconclusive: number;
  customersPassed: number;
  customersFailed: number;
  customersInconclusive: number;
  /** Share of attribution tests that passed, null when no attribution test was conclusive. */
  attributionAccuracy: number | null;
  trackingAccuracy: number | null;
  failuresByType: Record<string, number>;
  failuresByPoint: Record<string, number>;
}

export interface ValidationReport {
  id: string;
  runId: string;
  projectId: string;
  createdAt: string;
  adapter: string;
  summary: ValidationSummary;
  customers: CustomerValidation[];
  expectedVsActual: ExpectedVsActualRow[];
}

// ---------------------------------------------------------------------------
// Execution logs & integrations
// ---------------------------------------------------------------------------

export interface ExecutionLogEntry {
  id: string;
  runId: string;
  customerId?: string;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

export type IntegrationMaturity = 'functional' | 'prototype' | 'not_implemented';

export interface IntegrationStatus {
  id: string;
  name: string;
  category: 'website' | 'tag_manager' | 'collector' | 'attribution' | 'channel' | 'execution';
  maturity: IntegrationMaturity;
  healthy: boolean | null;
  summary: string;
  details?: unknown;
}

export interface PreflightReport {
  id: string;
  projectId: string;
  ts: string;
  passed: boolean;
  checks: { id: string; name: string; status: TestStatus; detail: string }[];
}
