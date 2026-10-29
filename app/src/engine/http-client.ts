import type { ApiResponse } from '@syntro/engine';
import type { EngineClient } from './client.ts';

export class HttpEngineClient implements EngineClient {
  readonly mode = 'remote' as const;

  constructor(readonly baseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: ApiResponse<T>;
    try {
      json = (await res.json()) as ApiResponse<T>;
    } catch {
      throw new Error(`Engine returned HTTP ${res.status} without a JSON body`);
    }
    if (!json.ok) throw new Error(json.error.message);
    return json.data;
  }

  private get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  private post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {});
  }
  private patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  private del(path: string) {
    return this.request<unknown>('DELETE', path).then(() => undefined);
  }

  info() {
    return this.get<Awaited<ReturnType<EngineClient['info']>>>('/info');
  }
  overview() {
    return this.get<Awaited<ReturnType<EngineClient['overview']>>>('/overview');
  }

  listProjects() {
    return this.get<Awaited<ReturnType<EngineClient['listProjects']>>>('/projects');
  }
  getProject(id: string) {
    return this.get<Awaited<ReturnType<EngineClient['getProject']>>>(`/projects/${id}`);
  }
  createProject(req: Parameters<EngineClient['createProject']>[0]) {
    return this.post<Awaited<ReturnType<EngineClient['createProject']>>>('/projects', req);
  }
  updateProject(id: string, req: Parameters<EngineClient['updateProject']>[1]) {
    return this.patch<Awaited<ReturnType<EngineClient['updateProject']>>>(`/projects/${id}`, req);
  }
  deleteProject(id: string) {
    return this.del(`/projects/${id}`);
  }
  seedProject(id: string) {
    return this.post<Awaited<ReturnType<EngineClient['seedProject']>>>(`/projects/${id}/seed`);
  }
  getIntegrations(projectId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getIntegrations']>>>(`/projects/${projectId}/integrations`);
  }
  runPreflight(projectId: string) {
    return this.post<Awaited<ReturnType<EngineClient['runPreflight']>>>(`/projects/${projectId}/preflight`);
  }
  getLatestPreflight(projectId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getLatestPreflight']>>>(`/projects/${projectId}/preflight`);
  }
  previewCustomers(projectId: string, req: Parameters<EngineClient['previewCustomers']>[1]) {
    return this.post<Awaited<ReturnType<EngineClient['previewCustomers']>>>(`/projects/${projectId}/customers/preview`, req);
  }

  listJourneyTemplates() {
    return this.get<Awaited<ReturnType<EngineClient['listJourneyTemplates']>>>('/journeys/templates');
  }
  listJourneys(projectId?: string) {
    return this.get<Awaited<ReturnType<EngineClient['listJourneys']>>>(`/journeys${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
  }
  getJourney(id: string) {
    return this.get<Awaited<ReturnType<EngineClient['getJourney']>>>(`/journeys/${id}`);
  }
  createJourney(req: Parameters<EngineClient['createJourney']>[0]) {
    return this.post<Awaited<ReturnType<EngineClient['createJourney']>>>('/journeys', req);
  }
  createJourneyFromTemplate(templateKey: string, projectId: string | null) {
    return this.post<Awaited<ReturnType<EngineClient['createJourneyFromTemplate']>>>('/journeys/from-template', { templateKey, projectId });
  }
  updateJourney(id: string, req: Parameters<EngineClient['updateJourney']>[1]) {
    return this.patch<Awaited<ReturnType<EngineClient['updateJourney']>>>(`/journeys/${id}`, req);
  }
  deleteJourney(id: string) {
    return this.del(`/journeys/${id}`);
  }
  validateJourney(def: Parameters<EngineClient['validateJourney']>[0]) {
    return this.post<Awaited<ReturnType<EngineClient['validateJourney']>>>('/journeys/validate', def);
  }

  listScenarioPresets() {
    return this.get<Awaited<ReturnType<EngineClient['listScenarioPresets']>>>('/scenarios/presets');
  }
  listScenarios(projectId?: string) {
    return this.get<Awaited<ReturnType<EngineClient['listScenarios']>>>(`/scenarios${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
  }
  getScenario(id: string) {
    return this.get<Awaited<ReturnType<EngineClient['getScenario']>>>(`/scenarios/${id}`);
  }
  createScenario(req: Parameters<EngineClient['createScenario']>[0]) {
    return this.post<Awaited<ReturnType<EngineClient['createScenario']>>>('/scenarios', req);
  }
  updateScenario(id: string, req: Parameters<EngineClient['updateScenario']>[1]) {
    return this.patch<Awaited<ReturnType<EngineClient['updateScenario']>>>(`/scenarios/${id}`, req);
  }
  deleteScenario(id: string) {
    return this.del(`/scenarios/${id}`);
  }

  listRuns(projectId?: string) {
    return this.get<Awaited<ReturnType<EngineClient['listRuns']>>>(`/simulations${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
  }
  getRun(runId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getRun']>>>(`/simulations/${runId}`);
  }
  startSimulation(req: Parameters<EngineClient['startSimulation']>[0]) {
    return this.post<Awaited<ReturnType<EngineClient['startSimulation']>>>('/simulations', req);
  }
  stopRun(runId: string) {
    return this.post<Awaited<ReturnType<EngineClient['stopRun']>>>(`/simulations/${runId}/stop`);
  }
  rerun(runId: string, req: Parameters<EngineClient['rerun']>[1]) {
    return this.post<Awaited<ReturnType<EngineClient['rerun']>>>(`/simulations/${runId}/rerun`, req);
  }
  revalidate(runId: string) {
    return this.post<Awaited<ReturnType<EngineClient['revalidate']>>>(`/simulations/${runId}/revalidate`);
  }
  deleteRun(runId: string) {
    return this.del(`/simulations/${runId}`);
  }
  listCustomers(runId: string) {
    return this.get<Awaited<ReturnType<EngineClient['listCustomers']>>>(`/simulations/${runId}/customers`);
  }
  getCustomer(customerId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getCustomer']>>>(`/customers/${customerId}`);
  }
  getLedger(runId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getLedger']>>>(`/simulations/${runId}/ledger`);
  }
  getEvents(runId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getEvents']>>>(`/simulations/${runId}/events`);
  }
  getAttribution(runId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getAttribution']>>>(`/simulations/${runId}/attribution`);
  }
  getValidation(runId: string) {
    return this.get<Awaited<ReturnType<EngineClient['getValidation']>>>(`/simulations/${runId}/validation`);
  }
  getLogs(runId: string, customerId?: string) {
    return this.get<Awaited<ReturnType<EngineClient['getLogs']>>>(`/simulations/${runId}/logs${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`);
  }
  compareRuns(baseline: string, candidate: string) {
    return this.get<Awaited<ReturnType<EngineClient['compareRuns']>>>(`/simulations/compare?baseline=${encodeURIComponent(baseline)}&candidate=${encodeURIComponent(candidate)}`);
  }

  ensureDemoProject() {
    return this.post<Awaited<ReturnType<EngineClient['ensureDemoProject']>>>('/demo/seed');
  }
  resetAll() {
    return this.post<unknown>('/reset').then(() => undefined);
  }
}
