import { DEMO_RUN_ASSIGNMENTS, FAILURE_LABELS, POINT_LABELS, SCENARIO_PRESETS, describeCredits, type EngineService, type SimulationRun, type ValidationReport } from '@syntro/engine';
import { createNodeEngine, type NodeEngine } from './create-engine.ts';

/**
 * Syntro CLI — drives the full Layer 1 engine without the Layer 2 interface.
 *
 *   syntro serve                       start the engine host (API, collector, demo sites, app if built)
 *   syntro demo [--fix] [--headed]     investor demo: 9 happy-path + 1 cross-device customers
 *   syntro run --scenario a,b --count 5 [--project <id>] [--headed]
 *   syntro preflight [--project <id>]
 *   syntro report <runId>
 *   syntro scenarios
 */
const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
};
const has = (name: string) => flag(name) !== undefined;

async function main(): Promise<void> {
  switch (command) {
    case 'serve': {
      const node = await boot();
      node.engine.ensureDemoProject();
      console.log(`Syntro engine listening on ${node.baseUrl} (Ctrl+C to stop)`);
      await new Promise(() => undefined);
      return;
    }
    case 'demo':
      return withNode(demo);
    case 'run':
      return withNode(run);
    case 'preflight':
      return withNode(preflight);
    case 'report':
      return withNode(async (node) => {
        const runId = args[1];
        if (!runId) throw new Error('Usage: syntro report <runId>');
        const report = node.engine.getValidation(runId);
        if (!report) throw new Error(`No validation report for ${runId}`);
        printReport(node.engine.getRunRecord(runId), report, node.engine);
      }, false);
    case 'scenarios':
      console.log('\nScenario presets:\n');
      for (const p of SCENARIO_PRESETS) console.log(`  ${p.key.padEnd(28)} ${p.name}${p.faults.length ? `  [faults: ${p.faults.map((f) => f.kind).join(', ')}]` : ''}`);
      console.log('');
      return;
    default:
      console.log(`
Syntro CLI

  syntro serve                        Start the engine host (API, collector, demo sites, app if built)
  syntro demo [--fix] [--headed]      Investor demonstration: 10 synthetic customers, one deliberate stitching failure
  syntro run --scenario <keys> --count <n> [--project <id>] [--headed]
  syntro preflight [--project <id>]   Verify synthetic session routing and production isolation
  syntro report <runId>               Print a stored validation report
  syntro scenarios                    List scenario presets

Options: --port <n> (default 4100) --headed (show the browser) --verbose --no-persist
`);
  }
}

async function boot(): Promise<NodeEngine> {
  return createNodeEngine({
    port: Number(flag('port') ?? process.env.PORT ?? 4100),
    headless: !has('headed'),
    verbose: has('verbose'),
    persist: !has('no-persist'),
  });
}

async function withNode(fn: (node: NodeEngine) => Promise<void>, needBrowser = true): Promise<void> {
  const node = await boot();
  try {
    await fn(node);
  } finally {
    await node.close();
  }
  void needBrowser;
}

async function demo(node: NodeEngine): Promise<void> {
  const { engine } = node;
  const project = engine.ensureDemoProject();
  // The enterprise "believes" this configuration is correct: cookie-only identity resolution.
  engine.updateProject(project.id, { sut: { identityResolution: 'cookie_only' } });
  const scenarios = engine.listScenarios(project.id);
  const assignments = DEMO_RUN_ASSIGNMENTS.map((a) => {
    const scenario = scenarios.find((s) => s.templateKey === a.presetKey);
    if (!scenario) throw new Error(`Preset ${a.presetKey} missing`);
    return { scenarioId: scenario.id, customerCount: a.customerCount };
  });

  banner('Syntro investor demonstration');
  console.log(`Project: ${project.name}\nWebsite: ${project.website.baseUrl}\nSUT: local attribution system — identity resolution = ${project.sut.identityResolution}, lookback ${project.sut.lookbackDays}d\n`);
  console.log('Launching 10 synthetic customers (9 × Email → Google → Meta → Purchase, 1 × cross-device login)…\n');

  const started = engine.startSimulation({ projectId: project.id, name: 'Investor demo', assignments, seed: 42 });
  const run = await watch(engine, started.id);
  const report = engine.getValidation(run.id);
  if (!report) throw new Error(`Run ${run.id} finished with status ${run.status}: ${run.error ?? 'no report'}`);
  printReport(run, report, engine);

  if (has('fix')) {
    banner('Correcting the configuration and re-running the failed scenario');
    engine.updateProject(project.id, { sut: { identityResolution: 'cookie_and_email' } });
    console.log('SUT identity resolution → cookie_and_email\n');
    const rerun = engine.rerun(run.id, { mode: 'failed_only', name: 'Investor demo · after fix' });
    const finished = await watch(engine, rerun.id);
    const rerunReport = engine.getValidation(finished.id);
    if (rerunReport) printReport(finished, rerunReport, engine);
    const cmp = engine.compareRuns(run.id, finished.id);
    console.log(`Δ passed ${fmtDelta(cmp.deltas.passed)}  Δ failed ${fmtDelta(cmp.deltas.failed)}\n`);
  } else {
    console.log('Tip: run with --fix to correct the SUT identity resolution and re-run the failed scenario.\n');
  }
}

async function run(node: NodeEngine): Promise<void> {
  const { engine } = node;
  const projectId = flag('project');
  const project = projectId ? engine.getProject(projectId) : engine.ensureDemoProject();
  const keys = (flag('scenario') ?? 'happy_path_multitouch').split(',').map((k) => k.trim()).filter(Boolean);
  const count = Number(flag('count') ?? 0);
  const scenarios = engine.listScenarios(project.id);
  const assignments = keys.map((key) => {
    const scenario = scenarios.find((s) => s.templateKey === key || s.id === key);
    if (!scenario) throw new Error(`Scenario ${key} not found (use "syntro scenarios")`);
    return { scenarioId: scenario.id, customerCount: count > 0 ? count : scenario.defaultCustomerCount };
  });
  banner(`Running ${assignments.reduce((s, a) => s + a.customerCount, 0)} synthetic customers across ${assignments.length} scenario(s)`);
  const started = engine.startSimulation({ projectId: project.id, assignments, seed: Number(flag('seed') ?? 7) });
  const finished = await watch(engine, started.id);
  const report = engine.getValidation(finished.id);
  if (!report) throw new Error(`Run ${finished.id} finished with status ${finished.status}: ${finished.error ?? 'no report'}`);
  printReport(finished, report, engine);
}

async function preflight(node: NodeEngine): Promise<void> {
  const { engine } = node;
  const projectId = flag('project');
  const project = projectId ? engine.getProject(projectId) : engine.ensureDemoProject();
  banner(`Preflight check — ${project.name}`);
  const report = await engine.runPreflight(project.id);
  for (const c of report.checks) console.log(`  ${icon(c.status)} ${c.name}\n      ${c.detail}`);
  console.log(`\n  Preflight ${report.passed ? 'PASSED' : 'FAILED'}\n`);
}

async function watch(engine: EngineService, runId: string): Promise<SimulationRun> {
  let last = '';
  const timer = setInterval(() => {
    const r = engine.getRunRecord(runId);
    const line = `  ${r.status.padEnd(10)} ${r.progress.completed + r.progress.failed + r.progress.stopped}/${r.progress.total} customers done · ${r.progress.running} running`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
  }, 1500);
  try {
    return await engine.waitForRun(runId);
  } finally {
    clearInterval(timer);
  }
}

function printReport(run: SimulationRun, report: ValidationReport, engine: EngineService): void {
  const s = report.summary;
  banner(`Validation report — ${run.name} (${run.id})`);
  console.log(`  Status: ${run.status}   Driver: ${run.driver}   Adapter: ${report.adapter}`);
  console.log(`  Customers: ${s.customers}   Scenarios: ${s.scenarios}   Tests: ${s.tests}`);
  console.log(`  Passed: ${s.passed}   Failed: ${s.failed}   Inconclusive: ${s.inconclusive}`);
  console.log(`  Attribution accuracy: ${pct(s.attributionAccuracy)}   Tracking accuracy: ${pct(s.trackingAccuracy)}\n`);

  console.log('  Customers:');
  for (const c of report.customers) {
    const customer = engine.store.customers.get(c.customerId);
    console.log(`    ${icon(c.status)} #${customer?.index ?? '?'} ${c.customerName.padEnd(22)} ${c.scenarioName}`);
  }

  const rows = report.expectedVsActual.filter((r) => r.model === 'last_touch');
  if (rows.length) {
    console.log('\n  Expected vs actual (last-touch):');
    for (const r of rows) console.log(`    ${icon(r.status)} ${r.customerName.padEnd(22)} expected ${describeCredits(r.expected)}  |  actual ${r.actual ? describeCredits(r.actual) : '—'}`);
  }

  const failures = report.customers.flatMap((c) => c.tests.filter((t) => t.status === 'fail').map((t) => ({ c, t })));
  if (failures.length) {
    console.log('\n  Failures:');
    for (const { c, t } of failures) {
      const f = t.failure!;
      console.log(`\n    ✖ ${c.customerName} — ${t.name}`);
      console.log(`      Type:      ${FAILURE_LABELS[f.type]}`);
      console.log(`      Suspected: ${POINT_LABELS[f.suspectedPointOfFailure]}`);
      console.log(`      Expected:  ${String(t.expected)}`);
      console.log(`      Observed:  ${String(t.observed)}`);
      console.log(`      Why:       ${f.explanation}`);
      console.log(`      Evidence:  ${f.evidence.map((e) => e.label).join(' · ')}`);
      console.log(`      Next:      ${f.recommendedSteps[0]}`);
    }
  }
  console.log('');
}

function banner(text: string): void {
  console.log(`\n${'─'.repeat(78)}\n  ${text}\n${'─'.repeat(78)}\n`);
}

function icon(status: string): string {
  return status === 'pass' ? '✔' : status === 'fail' ? '✖' : '◌';
}

function pct(v: number | null): string {
  return v == null ? 'n/a' : `${Math.round(v * 1000) / 10}%`;
}

function fmtDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

main().catch((e) => {
  console.error(`\nError: ${(e as Error).message}\n`);
  process.exit(1);
});
