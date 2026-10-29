import { createAttributionAdapter } from '../attribution/adapters/index.ts';
import { toAttributionFacing } from '../attribution/facing.ts';
import type { SimulationRun, SyntheticCustomer } from '../domain/types.ts';
import type { Store } from '../store/store.ts';
import type { SessionTokenService } from '../tokens/session-token.ts';
import { ms, nowIso } from '../util/time.ts';
import { validateRun } from '../validation/validator.ts';
import type { EngineConfig, EngineLogger } from './config.ts';
import type { BrowserDriver } from './driver.ts';
import { JourneyExecutor } from './executor.ts';

export interface RunnerDeps {
  store: Store;
  tokens: SessionTokenService;
  config: EngineConfig;
  logger: EngineLogger;
  driverFactory: () => Promise<BrowserDriver>;
  onRunUpdate?: (run: SimulationRun) => void;
}

/**
 * Simulation runner: executes every synthetic customer of a run with bounded parallelism
 * (one isolated browser context each), then finalises the run — feeds observed events to
 * the attribution adapter, retrieves the system's results and validates them.
 */
export class SimulationRunner {
  private readonly active = new Map<string, Promise<void>>();
  private readonly stopRequests = new Set<string>();
  private readonly executor: JourneyExecutor;

  constructor(private readonly deps: RunnerDeps) {
    this.executor = new JourneyExecutor({ store: deps.store, tokens: deps.tokens, config: deps.config, logger: deps.logger });
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  activeRunIds(): string[] {
    return Array.from(this.active.keys());
  }

  /** Start a run; the returned promise resolves when the run has been finalised. */
  start(runId: string): Promise<void> {
    const existing = this.active.get(runId);
    if (existing) return existing;
    const promise = this.execute(runId).finally(() => {
      this.active.delete(runId);
      this.stopRequests.delete(runId);
    });
    this.active.set(runId, promise);
    return promise;
  }

  wait(runId: string): Promise<void> {
    return this.active.get(runId) ?? Promise.resolve();
  }

  requestStop(runId: string): void {
    this.stopRequests.add(runId);
    const run = this.deps.store.runs.get(runId);
    if (run) {
      run.stopRequested = true;
      this.save(run);
    }
  }

  private async execute(runId: string): Promise<void> {
    const { store, logger } = this.deps;
    const run = store.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    const project = store.projects.get(run.projectId);
    if (!project) throw new Error(`Project ${run.projectId} not found`);
    const customers = store.customers.list((c) => c.runId === runId).sort((a, b) => a.index - b.index);

    run.status = 'running';
    run.startedAt = nowIso();
    run.progress = { total: customers.length, completed: 0, failed: 0, running: 0, stopped: 0 };
    this.save(run);
    logger.log('info', `Run started with ${customers.length} synthetic customers (concurrency ${run.concurrency})`, undefined, { runId });

    let driver: BrowserDriver | null = null;
    try {
      driver = await this.deps.driverFactory();
      run.driver = driver.name;
      this.save(run);

      const queue = [...customers];
      const shouldStop = () => this.stopRequests.has(runId);
      const worker = async () => {
        while (queue.length) {
          if (shouldStop()) break;
          const customer = queue.shift()!;
          const scenario = store.scenarios.get(customer.scenarioId);
          const journey = scenario ? store.journeys.get(scenario.journeyId) : undefined;
          if (!scenario || !journey) {
            customer.status = 'failed';
            customer.error = 'Scenario or journey no longer exists';
            store.customers.put(customer);
            this.bump(run, customer);
            continue;
          }
          run.progress.running++;
          this.save(run);
          try {
            await this.executor.execute({ run, project, scenario, journey, customer, driver: driver!, shouldStop });
          } catch (e) {
            customer.status = 'failed';
            customer.error = (e as Error).message;
            store.customers.put(customer);
            logger.log('error', `Executor crashed for ${customer.id}: ${(e as Error).message}`, undefined, { runId, customerId: customer.id });
          }
          run.progress.running--;
          this.bump(run, customer);
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, run.concurrency) }, () => worker()));

      for (const customer of queue) {
        customer.status = 'stopped';
        store.customers.put(customer);
        run.progress.stopped++;
      }

      if (shouldStop()) {
        run.status = 'stopped';
        run.finishedAt = nowIso();
        this.save(run);
        logger.log('warn', 'Run stopped by user', undefined, { runId });
        await this.finalize(runId);
        return;
      }
      await this.finalize(runId);
    } catch (e) {
      run.status = 'failed';
      run.error = (e as Error).message;
      run.finishedAt = nowIso();
      this.save(run);
      logger.log('error', `Run failed: ${(e as Error).message}`, undefined, { runId });
    } finally {
      await driver?.dispose().catch(() => undefined);
    }
  }

  private bump(run: SimulationRun, customer: SyntheticCustomer): void {
    if (customer.status === 'completed') run.progress.completed++;
    else if (customer.status === 'failed') run.progress.failed++;
    else if (customer.status === 'stopped') run.progress.stopped++;
    this.save(run);
  }

  /**
   * Finalise: deliver observed events to the attribution system under test, retrieve its
   * results and validate them against the ground truth ledger. Re-runnable (e.g. after an
   * external adapter's results arrive or after the SUT configuration changed).
   */
  async finalize(runId: string, opts: { sutOverride?: SimulationRun['sutSnapshot'] } = {}): Promise<SimulationRun> {
    const { store, logger } = this.deps;
    const run = store.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    const project = store.projects.get(run.projectId);
    if (!project) throw new Error(`Project ${run.projectId} not found`);
    const wasStopped = run.status === 'stopped';
    if (opts.sutOverride) run.sutSnapshot = opts.sutOverride;
    run.status = 'finalizing';
    this.save(run);

    try {
      const finalizeTime = Date.now();
      const events = store.events.list((e) => e.runId === runId);
      for (const e of events) {
        const delivered = ms(e.receivedAt) + e.delivery.delayMs <= finalizeTime;
        if (e.delivery.deliveredToSut !== delivered) {
          e.delivery.deliveredToSut = delivered;
          store.events.put(e);
        }
      }
      const platformRecords = store.platformRecords.list((r) => r.runId === runId);
      const adapter = createAttributionAdapter(run.sutSnapshot, runId);
      const facing = toAttributionFacing(events.filter((e) => e.delivery.deliveredToSut));
      await adapter.ingest(facing, platformRecords);
      logger.log('info', `Delivered ${facing.length} attribution-facing events to adapter "${adapter.id}"`, undefined, { runId });
      const results = await adapter.getResults();
      if (results === 'pending') {
        run.status = 'awaiting_results';
        this.save(run);
        logger.log('info', 'Attribution results pending from external adapter', undefined, { runId });
        return run;
      }
      for (const old of store.attributionResults.list((r) => r.runId === runId)) store.attributionResults.delete(old.id);
      for (const r of results) store.attributionResults.put(r);

      const customers = store.customers.list((c) => c.runId === runId);
      const report = validateRun({
        run,
        project,
        customers,
        scenarios: store.scenarios.list((s) => s.projectId === project.id),
        ledgers: store.ledger.list((l) => l.runId === runId),
        events,
        collectorLog: store.collectorLog.list((l) => l.runId === runId),
        results,
        adapterId: adapter.id,
      });
      for (const old of store.validationReports.list((r) => r.runId === runId)) store.validationReports.delete(old.id);
      store.validationReports.put(report);
      run.summary = report.summary;
      run.status = wasStopped ? 'stopped' : 'completed';
      run.finishedAt = run.finishedAt ?? nowIso();
      this.save(run);
      logger.log('info', `Validation complete: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.inconclusive} inconclusive`, undefined, { runId });
      return run;
    } catch (e) {
      run.status = 'failed';
      run.error = `Finalisation failed: ${(e as Error).message}`;
      run.finishedAt = nowIso();
      this.save(run);
      logger.log('error', run.error, undefined, { runId });
      return run;
    }
  }

  private save(run: SimulationRun): void {
    this.deps.store.runs.put(run);
    this.deps.onRunUpdate?.(run);
  }
}
