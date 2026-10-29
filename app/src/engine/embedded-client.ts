import type { EngineService } from '@syntro/engine';
import type { EngineClient } from './client.ts';

/** In-process client: calls the engine service directly and returns detached copies (the UI never shares engine state). */
export class EmbeddedEngineClient implements EngineClient {
  readonly mode = 'embedded' as const;

  constructor(private readonly engine: EngineService) {}

  private wrap<T>(fn: () => T | Promise<T>): Promise<T> {
    return Promise.resolve().then(fn).then((v) => (v === undefined || v === null ? v : structuredClone(v)) as T);
  }

  info() {
    return this.wrap(() => this.engine.info());
  }
  overview() {
    return this.wrap(() => this.engine.getOverview());
  }
  listProjects() {
    return this.wrap(() => this.engine.listProjects());
  }
  getProject(id: string) {
    return this.wrap(() => this.engine.getProject(id));
  }
  createProject(req: Parameters<EngineClient['createProject']>[0]) {
    return this.wrap(() => this.engine.createProject(req));
  }
  updateProject(id: string, req: Parameters<EngineClient['updateProject']>[1]) {
    return this.wrap(() => this.engine.updateProject(id, req));
  }
  deleteProject(id: string) {
    return this.wrap(() => this.engine.deleteProject(id));
  }
  seedProject(id: string) {
    return this.wrap(() => this.engine.seedProjectFromPresets(id));
  }
  getIntegrations(projectId: string) {
    return this.wrap(() => this.engine.getIntegrations(projectId));
  }
  runPreflight(projectId: string) {
    return this.wrap(() => this.engine.runPreflight(projectId));
  }
  getLatestPreflight(projectId: string) {
    return this.wrap(() => this.engine.getLatestPreflight(projectId));
  }
  previewCustomers(projectId: string, req: Parameters<EngineClient['previewCustomers']>[1]) {
    return this.wrap(() => this.engine.previewCustomers(projectId, req));
  }
  listJourneyTemplates() {
    return this.wrap(() => this.engine.listJourneyTemplates());
  }
  listJourneys(projectId?: string) {
    return this.wrap(() => this.engine.listJourneys(projectId));
  }
  getJourney(id: string) {
    return this.wrap(() => this.engine.getJourney(id));
  }
  createJourney(req: Parameters<EngineClient['createJourney']>[0]) {
    return this.wrap(() => this.engine.createJourney(req));
  }
  createJourneyFromTemplate(templateKey: string, projectId: string | null) {
    return this.wrap(() => this.engine.createJourneyFromTemplate(templateKey, projectId));
  }
  updateJourney(id: string, req: Parameters<EngineClient['updateJourney']>[1]) {
    return this.wrap(() => this.engine.updateJourney(id, req));
  }
  deleteJourney(id: string) {
    return this.wrap(() => this.engine.deleteJourney(id));
  }
  validateJourney(def: Parameters<EngineClient['validateJourney']>[0]) {
    return this.wrap(() => this.engine.validateJourneyDefinition(def));
  }
  listScenarioPresets() {
    return this.wrap(() => this.engine.listScenarioPresets());
  }
  listScenarios(projectId?: string) {
    return this.wrap(() => this.engine.listScenarios(projectId));
  }
  getScenario(id: string) {
    return this.wrap(() => this.engine.getScenario(id));
  }
  createScenario(req: Parameters<EngineClient['createScenario']>[0]) {
    return this.wrap(() => this.engine.createScenario(req));
  }
  updateScenario(id: string, req: Parameters<EngineClient['updateScenario']>[1]) {
    return this.wrap(() => this.engine.updateScenario(id, req));
  }
  deleteScenario(id: string) {
    return this.wrap(() => this.engine.deleteScenario(id));
  }
  listRuns(projectId?: string) {
    return this.wrap(() => this.engine.listRuns(projectId));
  }
  getRun(runId: string) {
    return this.wrap(() => this.engine.getRun(runId));
  }
  startSimulation(req: Parameters<EngineClient['startSimulation']>[0]) {
    return this.wrap(() => this.engine.startSimulation(req));
  }
  stopRun(runId: string) {
    return this.wrap(() => this.engine.stopRun(runId));
  }
  rerun(runId: string, req: Parameters<EngineClient['rerun']>[1]) {
    return this.wrap(() => this.engine.rerun(runId, req));
  }
  revalidate(runId: string) {
    return this.wrap(() => this.engine.revalidate(runId));
  }
  deleteRun(runId: string) {
    return this.wrap(() => this.engine.deleteRun(runId));
  }
  listCustomers(runId: string) {
    return this.wrap(() => this.engine.listCustomers(runId));
  }
  getCustomer(customerId: string) {
    return this.wrap(() => this.engine.getCustomerDetail(customerId));
  }
  getLedger(runId: string) {
    return this.wrap(() => this.engine.getLedger(runId));
  }
  getEvents(runId: string) {
    return this.wrap(() => this.engine.getEvents(runId));
  }
  getAttribution(runId: string) {
    return this.wrap(() => this.engine.getAttributionResults(runId));
  }
  getValidation(runId: string) {
    return this.wrap(() => this.engine.getValidation(runId));
  }
  getLogs(runId: string, customerId?: string) {
    return this.wrap(() => this.engine.getLogs(runId, customerId));
  }
  compareRuns(baseline: string, candidate: string) {
    return this.wrap(() => this.engine.compareRuns(baseline, candidate));
  }
  ensureDemoProject() {
    return this.wrap(() => this.engine.ensureDemoProject());
  }
  resetAll() {
    return this.wrap(() => this.engine.resetAll());
  }
}
