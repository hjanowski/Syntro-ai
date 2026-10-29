import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { EngineError, fail, ok, type EngineService } from '@syntro/engine';

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

/**
 * HTTP transport for the Syntro Engine API v1. Every route maps 1:1 onto an EngineService
 * operation and returns an ApiResponse envelope. See docs/API.md.
 */
export function mountEngineApi(app: Express, engine: EngineService): void {
  const router = express.Router();

  const route = (method: 'get' | 'post' | 'patch' | 'delete', path: string, handler: Handler) => {
    router[method](path, async (req: Request, res: Response) => {
      try {
        const data = await handler(req, res);
        if (!res.headersSent) res.json(ok(data));
      } catch (e) {
        const err = e as EngineError;
        const status = err instanceof EngineError ? err.status : 500;
        if (!(err instanceof EngineError)) console.error('[syntro api]', err);
        res.status(status).json(fail(err instanceof EngineError ? err.code : 'internal_error', err.message ?? 'Internal error', err instanceof EngineError ? err.details : undefined));
      }
    });
  };

  const q = (req: Request, key: string): string | undefined => {
    const v = req.query[key];
    return typeof v === 'string' && v !== '' ? v : undefined;
  };

  // Health & info
  route('get', '/health', () => ({ status: 'ok', ...engine.info() }));
  route('get', '/info', () => engine.info());
  route('get', '/overview', () => engine.getOverview());

  // Projects
  route('get', '/projects', () => engine.listProjects());
  route('post', '/projects', (req) => engine.createProject(req.body));
  route('get', '/projects/:id', (req) => engine.getProject(req.params.id));
  route('patch', '/projects/:id', (req) => engine.updateProject(req.params.id, req.body));
  route('delete', '/projects/:id', (req) => {
    engine.deleteProject(req.params.id);
    return { deleted: true };
  });
  route('post', '/projects/:id/seed', (req) => engine.seedProjectFromPresets(req.params.id));
  route('get', '/projects/:id/integrations', (req) => engine.getIntegrations(req.params.id));
  route('post', '/projects/:id/preflight', (req) => engine.runPreflight(req.params.id));
  route('get', '/projects/:id/preflight', (req) => engine.getLatestPreflight(req.params.id));
  route('post', '/projects/:id/customers/preview', (req) => engine.previewCustomers(req.params.id, req.body));

  // Journeys
  route('get', '/journeys/templates', () => engine.listJourneyTemplates());
  route('post', '/journeys/validate', (req) => engine.validateJourneyDefinition(req.body));
  route('post', '/journeys/from-template', (req) => engine.createJourneyFromTemplate(req.body.templateKey, req.body.projectId ?? null));
  route('get', '/journeys', (req) => engine.listJourneys(q(req, 'projectId')));
  route('post', '/journeys', (req) => engine.createJourney(req.body));
  route('get', '/journeys/:id', (req) => engine.getJourney(req.params.id));
  route('patch', '/journeys/:id', (req) => engine.updateJourney(req.params.id, req.body));
  route('delete', '/journeys/:id', (req) => {
    engine.deleteJourney(req.params.id);
    return { deleted: true };
  });

  // Scenarios
  route('get', '/scenarios/presets', () => engine.listScenarioPresets());
  route('get', '/scenarios', (req) => engine.listScenarios(q(req, 'projectId')));
  route('post', '/scenarios', (req) => engine.createScenario(req.body));
  route('get', '/scenarios/:id', (req) => engine.getScenario(req.params.id));
  route('patch', '/scenarios/:id', (req) => engine.updateScenario(req.params.id, req.body));
  route('delete', '/scenarios/:id', (req) => {
    engine.deleteScenario(req.params.id);
    return { deleted: true };
  });

  // Simulations
  route('get', '/simulations/compare', (req) => {
    const baseline = q(req, 'baseline');
    const candidate = q(req, 'candidate');
    if (!baseline || !candidate) throw new EngineError('validation', 'baseline and candidate run ids are required');
    return engine.compareRuns(baseline, candidate);
  });
  route('get', '/simulations', (req) => engine.listRuns(q(req, 'projectId')));
  route('post', '/simulations', (req) => engine.startSimulation(req.body));
  route('get', '/simulations/:id', (req) => engine.getRun(req.params.id));
  route('post', '/simulations/:id/stop', (req) => engine.stopRun(req.params.id));
  route('post', '/simulations/:id/rerun', (req) => engine.rerun(req.params.id, req.body ?? { mode: 'all' }));
  route('post', '/simulations/:id/revalidate', (req) => engine.revalidate(req.params.id));
  route('delete', '/simulations/:id', (req) => {
    engine.deleteRun(req.params.id);
    return { deleted: true };
  });
  route('get', '/simulations/:id/customers', (req) => engine.listCustomers(req.params.id));
  route('get', '/simulations/:id/ledger', (req) => engine.getLedger(req.params.id));
  route('get', '/simulations/:id/events', (req) => engine.getEvents(req.params.id));
  route('get', '/simulations/:id/attribution', (req) => engine.getAttributionResults(req.params.id));
  route('get', '/simulations/:id/validation', (req) => engine.getValidation(req.params.id));
  route('get', '/simulations/:id/logs', (req) => engine.getLogs(req.params.id, q(req, 'customerId')));
  route('get', '/customers/:id', (req) => engine.getCustomerDetail(req.params.id));

  // Collector (website SDK → isolated test data collector)
  route('post', '/collect', (req) => engine.collect(req.body));

  // Demo & maintenance
  route('post', '/demo/seed', () => engine.ensureDemoProject());
  route('post', '/reset', () => {
    engine.resetAll();
    return { reset: true };
  });

  app.use('/v1', router);
}

export function corsMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
