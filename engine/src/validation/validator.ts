import type {
  AttributionResult,
  CollectedEvent,
  CollectorLogEntry,
  CustomerValidation,
  Evidence,
  ExpectedAttribution,
  ExpectedVsActualRow,
  FailureDiagnostic,
  FailureType,
  GroundTruthConversion,
  GroundTruthTouchpoint,
  LedgerEntry,
  PointOfFailure,
  Project,
  Scenario,
  SimulationRun,
  SyntheticCustomer,
  TestResult,
  TestStatus,
  ValidationReport,
  ValidationSummary,
} from '../domain/types.ts';
import { creditsEqual, describeCredits } from '../attribution/reference.ts';
import { customerDisplayName } from '../customers/generate.ts';
import { randomId } from '../util/ids.ts';
import { ms, nowIso } from '../util/time.ts';
import { RECOMMENDATIONS, evidenceFromAction, evidenceFromConfig, evidenceFromEvent, evidenceFromFault, evidenceFromResult } from './diagnostics.ts';

/**
 * Attribution validation engine — compares three independent sources per customer:
 *   1. Ground truth (ledger: what the synthetic customer actually did),
 *   2. Observed tracking data (collector: what the website reported),
 *   3. Actual attribution results (adapter: what the attribution system concluded),
 * and turns every discrepancy into a classified, evidence-backed failure.
 */
export interface ValidationInput {
  run: SimulationRun;
  project: Project;
  customers: SyntheticCustomer[];
  scenarios: Scenario[];
  ledgers: LedgerEntry[];
  events: CollectedEvent[];
  collectorLog: CollectorLogEntry[];
  results: AttributionResult[];
  adapterId: string;
}

const TS_TOLERANCE_MS = 3 * 60 * 1000;

export function validateRun(input: ValidationInput): ValidationReport {
  const scenarioById = new Map(input.scenarios.map((s) => [s.id, s]));
  const ledgerByCustomer = new Map(input.ledgers.map((l) => [l.customerId, l]));
  const customers: CustomerValidation[] = [];
  const rows: ExpectedVsActualRow[] = [];

  for (const customer of input.customers) {
    const ledger = ledgerByCustomer.get(customer.id);
    const scenario = scenarioById.get(customer.scenarioId);
    const events = input.events.filter((e) => e.syntheticCustomerId === customer.id);
    const log = input.collectorLog.filter((l) => l.customerId === customer.id);
    const ctx = new CustomerContext(customer, scenario, ledger, events, log, input.results, input.run);
    const tests = ctx.runTests();
    customers.push({
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      scenarioId: customer.scenarioId,
      scenarioName: scenario?.name ?? customer.scenarioId,
      journeyId: customer.journeyId,
      status: rollup(tests.map((t) => t.status)),
      tests,
    });
    rows.push(...ctx.expectedVsActualRows());
  }

  return {
    id: randomId('rep'),
    runId: input.run.id,
    projectId: input.project.id,
    createdAt: nowIso(),
    adapter: input.adapterId,
    summary: summarise(customers, input.scenarios.length),
    customers,
    expectedVsActual: rows,
  };
}

export function rollup(statuses: TestStatus[]): TestStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('inconclusive')) return 'inconclusive';
  return 'pass';
}

function summarise(customers: CustomerValidation[], scenarioCount: number): ValidationSummary {
  const all = customers.flatMap((c) => c.tests);
  const attribution = all.filter((t) => t.category === 'attribution' && t.status !== 'inconclusive');
  const tracking = all.filter((t) => (t.category === 'tracking' || t.category === 'identity') && t.status !== 'inconclusive');
  const failuresByType: Record<string, number> = {};
  const failuresByPoint: Record<string, number> = {};
  for (const t of all) {
    if (t.status !== 'fail' || !t.failure) continue;
    failuresByType[t.failure.type] = (failuresByType[t.failure.type] ?? 0) + 1;
    failuresByPoint[t.failure.suspectedPointOfFailure] = (failuresByPoint[t.failure.suspectedPointOfFailure] ?? 0) + 1;
  }
  const ratio = (list: TestResult[]) => (list.length ? list.filter((t) => t.status === 'pass').length / list.length : null);
  return {
    customers: customers.length,
    scenarios: new Set(customers.map((c) => c.scenarioId)).size || scenarioCount,
    tests: all.length,
    passed: all.filter((t) => t.status === 'pass').length,
    failed: all.filter((t) => t.status === 'fail').length,
    inconclusive: all.filter((t) => t.status === 'inconclusive').length,
    customersPassed: customers.filter((c) => c.status === 'pass').length,
    customersFailed: customers.filter((c) => c.status === 'fail').length,
    customersInconclusive: customers.filter((c) => c.status === 'inconclusive').length,
    attributionAccuracy: ratio(attribution),
    trackingAccuracy: ratio(tracking),
    failuresByType,
    failuresByPoint,
  };
}

// ---------------------------------------------------------------------------

class CustomerContext {
  private tests: TestResult[] = [];
  private landingByTouchpoint = new Map<string, CollectedEvent | undefined>();
  private rows: ExpectedVsActualRow[] = [];
  private readonly anonIds: Set<string>;

  constructor(
    private readonly customer: SyntheticCustomer,
    private readonly scenario: Scenario | undefined,
    private readonly ledger: LedgerEntry | undefined,
    private readonly events: CollectedEvent[],
    private readonly log: CollectorLogEntry[],
    private readonly allResults: AttributionResult[],
    private readonly run: SimulationRun,
  ) {
    this.anonIds = new Set(events.map((e) => e.anonymousId));
  }

  runTests(): TestResult[] {
    const ledger = this.ledger;
    if (!ledger) {
      this.add('execution.journey_completed', 'Journey executed', 'execution', 'inconclusive', 'complete ledger', 'no ledger', 'No ground truth ledger was recorded for this customer.');
      return this.tests;
    }
    this.testExecution(ledger);
    ledger.touchpoints.forEach((tp, i) => this.testTouchpoint(tp, i));
    ledger.conversions.forEach((c, i) => this.testConversion(c, i));
    this.testSessionContinuity(ledger);
    if (ledger.identity.stitchRequired) this.testStitching(ledger);
    for (const conversion of ledger.conversions) {
      const expectations = ledger.expectedAttribution.filter((e) => e.conversionId === conversion.id);
      for (const expected of expectations) this.testAttribution(ledger, conversion, expected);
    }
    if (ledger.conversions.length) this.testNoDuplicateAttribution(ledger);
    if (ledger.isolationCheck?.performed) this.testIsolation(ledger);
    return this.tests;
  }

  expectedVsActualRows(): ExpectedVsActualRow[] {
    return this.rows;
  }

  // -- helpers -------------------------------------------------------------------

  private add(
    testId: string,
    name: string,
    category: TestResult['category'],
    status: TestStatus,
    expected: unknown,
    observed: unknown,
    summary: string,
    failure?: FailureDiagnostic,
  ): TestResult {
    const t: TestResult = { id: randomId('test'), customerId: this.customer.id, testId, name, category, status, expected, observed, summary, failure };
    this.tests.push(t);
    return t;
  }

  private diag(type: FailureType, point: PointOfFailure, explanation: string, evidence: Evidence[], extraSteps: string[] = []): FailureDiagnostic {
    return { type, suspectedPointOfFailure: point, explanation, evidence, recommendedSteps: [...RECOMMENDATIONS[type], ...extraSteps] };
  }

  private faultOfKind<K extends string>(kind: K) {
    return (this.scenario?.faults ?? []).find((f) => f.kind === kind) ?? this.customer.activeFaults.find((f) => f.kind === kind);
  }

  private findLandingEvent(tp: GroundTruthTouchpoint): CollectedEvent | undefined {
    if (this.landingByTouchpoint.has(tp.id)) return this.landingByTouchpoint.get(tp.id);
    const candidates = this.events.filter((e) => e.eventType === 'page_view' && e.sessionId === tp.sessionId && Math.abs(ms(e.ts) - ms(tp.ts)) < TS_TOLERANCE_MS);
    let match: CollectedEvent | undefined;
    if (tp.clickId) match = candidates.find((e) => Object.values(e.clickIds).includes(tp.clickId!));
    if (!match) {
      const landingPath = safePath(tp.landingUrl);
      const sameLanding = candidates.filter((e) => !landingPath || e.path.endsWith(landingPath));
      sameLanding.sort((a, b) => Math.abs(ms(a.ts) - ms(tp.ts)) - Math.abs(ms(b.ts) - ms(tp.ts)));
      match = sameLanding.find((e) => (e.utm.utm_campaign ?? '') === (tp.observedUtm.utm_campaign ?? '')) ?? sameLanding[0];
    }
    this.landingByTouchpoint.set(tp.id, match);
    return match;
  }

  private conversionEvents(c: GroundTruthConversion): CollectedEvent[] {
    if (c.orderId) return this.events.filter((e) => e.eventType === 'purchase' && e.orderId === c.orderId);
    return this.events.filter((e) => e.eventType === c.eventType && e.sessionId === c.sessionId && Math.abs(ms(e.ts) - ms(c.ts)) < TS_TOLERANCE_MS);
  }

  private resultsFor(c: GroundTruthConversion, model: string): AttributionResult[] {
    return this.allResults.filter((r) => {
      if (r.runId !== this.run.id || r.model !== model) return false;
      if (c.orderId) return r.conversion.orderId === c.orderId;
      return r.conversion.type === c.eventType && this.anonIds.has(r.conversion.anonymousId) && Math.abs(ms(r.conversion.ts) - ms(c.ts)) < TS_TOLERANCE_MS;
    });
  }

  // -- tests -----------------------------------------------------------------------

  private testExecution(ledger: LedgerEntry): void {
    const failed = ledger.executed.find((a) => a.status === 'failed');
    const intendedCount = ledger.intended.length;
    const okCount = ledger.executed.filter((a) => a.status === 'ok').length;
    if (ledger.status === 'complete' && !failed) {
      this.add('execution.journey_completed', 'Journey executed end to end', 'execution', 'pass', `${intendedCount} steps`, `${okCount} steps ok`, `All ${okCount} journey steps executed successfully.`);
      return;
    }
    const observed = failed ? `Failed at "${failed.label}": ${failed.error ?? 'unknown error'}` : `Journey ${ledger.status}`;
    this.add(
      'execution.journey_completed',
      'Journey executed end to end',
      'execution',
      'fail',
      `${intendedCount} steps executed`,
      observed,
      observed,
      this.diag('execution_failure', 'journey_execution', observed, failed ? evidenceFromAction(failed) : [{ kind: 'ledger', label: 'Ledger', ref: ledger.id, data: { status: ledger.status } }]),
    );
  }

  private testTouchpoint(tp: GroundTruthTouchpoint, index: number): void {
    const testId = `tracking.touchpoint.${index + 1}`;
    const name = `Touchpoint captured: ${tp.channel} · ${tp.campaignId}`;
    const expectedDesc = `page_view with ${Object.keys(tp.intendedUtm).length ? describeUtm(tp.intendedUtm) : 'campaign parameters'}${tp.clickId ? ` and ${tp.clickIdParam}` : ''}`;
    const action = this.ledger?.executed.find((a) => a.nodeId === tp.nodeId);
    const event = this.findLandingEvent(tp);

    if (!event) {
      const dropFault = this.faultOfKind('drop_events');
      const dropped = this.log.find((l) => l.kind === 'dropped' && l.eventType === 'page_view');
      const point: PointOfFailure = dropFault || dropped ? 'event_collector' : 'website_sdk';
      const evidence: Evidence[] = action ? evidenceFromAction(action, `Executed ${tp.channel} click landing on ${safePath(tp.landingUrl)}`) : [];
      if (dropFault) evidence.push(evidenceFromFault(dropFault));
      if (dropped) evidence.push({ kind: 'log', label: 'Collector log: page_view dropped', data: dropped });
      this.add(testId, name, 'tracking', 'fail', expectedDesc, 'no matching page_view event', `The ${tp.channel} landing was executed but no page_view event reached the collector for session ${tp.sessionId}.`, this.diag('missing_touchpoint', point, `The synthetic customer landed on ${safePath(tp.landingUrl)} from the ${tp.channel} campaign ${tp.campaignId}, but the collector has no page_view for that session within the expected time window.`, evidence));
      return;
    }

    const evidence: Evidence[] = [...(action ? evidenceFromAction(action) : []), evidenceFromEvent(event, 'Observed landing page_view')];
    if (!event.utm.utm_source) {
      const fault = this.faultOfKind('missing_utm');
      if (fault) evidence.push(evidenceFromFault(fault));
      this.add(testId, name, 'tracking', 'fail', expectedDesc, `page_view captured without UTM parameters (${Object.keys(event.clickIds).join(', ') || 'no click id'})`, `The ${tp.channel} landing was captured, but the destination URL carried no UTM parameters.`, this.diag('missing_utm_parameters', 'ad_destination_configuration', `The landing page_view for ${tp.channel} campaign ${tp.campaignId} arrived without utm_source/utm_medium/utm_campaign. Only the click id (${Object.keys(event.clickIds).join(', ') || 'none'}) identifies the source, which the attribution system may not map.`, evidence));
      return;
    }
    if ((event.utm.utm_campaign ?? '') !== tp.campaignId && (tp.intendedUtm.utm_campaign ?? tp.campaignId) !== event.utm.utm_campaign) {
      const fault = this.faultOfKind('wrong_campaign_param');
      if (fault) evidence.push(evidenceFromFault(fault));
      this.add(testId, name, 'tracking', 'fail', expectedDesc, `utm_campaign=${event.utm.utm_campaign}`, `Landing captured with utm_campaign "${event.utm.utm_campaign}" instead of "${tp.campaignId}".`, this.diag('campaign_parameter_mismatch', 'ad_destination_configuration', `The ${tp.channel} ad for campaign ${tp.campaignId} sent the customer to a URL tagged utm_campaign=${event.utm.utm_campaign}. Attribution will credit the wrong campaign.`, evidence));
      return;
    }
    this.add(testId, name, 'tracking', 'pass', expectedDesc, `page_view ${event.id} with ${describeUtm(event.utm)}`, `Landing page_view captured with the expected campaign parameters.`);
  }

  private testConversion(c: GroundTruthConversion, index: number): void {
    const testId = `tracking.conversion.${index + 1}`;
    const name = `Conversion captured: ${c.eventType}${c.orderId ? ` ${c.orderId}` : ''}`;
    const action = this.ledger?.executed.find((a) => a.nodeId === c.nodeId);
    const events = this.conversionEvents(c);
    const expectedDesc = `1 × ${c.eventType} event, value ${c.value}`;
    const baseEvidence = action ? evidenceFromAction(action, `Executed conversion: ${action.label}`) : [];

    if (events.length === 0) {
      const dropFault = this.faultOfKind('drop_events');
      const dropped = this.log.find((l) => l.kind === 'dropped' && l.eventType === c.eventType);
      const evidence = [...baseEvidence];
      if (dropFault) evidence.push(evidenceFromFault(dropFault));
      if (dropped) evidence.push({ kind: 'log', label: `Collector log: ${c.eventType} dropped`, data: dropped });
      this.add(testId, name, 'tracking', 'fail', expectedDesc, 'no event', `The ${c.eventType} was completed on the website but never reached the collector.`, this.diag('lost_conversion_event', dropped || dropFault ? 'event_collector' : 'conversion_tracking', `The test checkout completed (order ${c.orderId ?? 'n/a'}, value ${c.value}) but no ${c.eventType} event exists in the collector.`, evidence));
      return;
    }
    const delayed = events.filter((e) => !e.delivery.deliveredToSut);
    if (events.length > 1) {
      const fault = this.faultOfKind('duplicate_events');
      const evidence = [...baseEvidence, ...events.map((e) => evidenceFromEvent(e))];
      if (fault) evidence.push(evidenceFromFault(fault));
      this.add(testId, name, 'tracking', 'fail', expectedDesc, `${events.length} × ${c.eventType} events`, `The ${c.eventType} event for ${c.orderId ?? 'this conversion'} was received ${events.length} times.`, this.diag('duplicate_conversion', fault ? 'event_collector' : 'website_sdk', `${events.length} ${c.eventType} events share order id ${c.orderId ?? 'n/a'}. Unless the attribution system deduplicates by order id, revenue will be double counted.`, evidence));
      return;
    }
    if (delayed.length) {
      const fault = this.faultOfKind('delay_events');
      const evidence = [...baseEvidence, ...events.map((e) => evidenceFromEvent(e))];
      if (fault) evidence.push(evidenceFromFault(fault));
      this.add(testId, name, 'tracking', 'fail', expectedDesc, `event delayed ${Math.round(events[0].delivery.delayMs / 60000)} min, not yet delivered`, `The ${c.eventType} event was captured but had not reached the attribution system when results were computed.`, this.diag('delayed_event', 'attribution_ingestion', `The ${c.eventType} event for ${c.orderId ?? 'this conversion'} is delayed by ${Math.round(events[0].delivery.delayMs / 60000)} minutes and was not part of the attribution computation.`, evidence));
      return;
    }
    const e = events[0];
    if (typeof e.revenue === 'number' && Math.abs(e.revenue - c.value) > 0.01) {
      this.add(testId, name, 'tracking', 'fail', expectedDesc, `revenue ${e.revenue}`, `Conversion captured with revenue ${e.revenue} instead of ${c.value}.`, this.diag('lost_conversion_event', 'conversion_tracking', `The ${c.eventType} event reports revenue ${e.revenue}, but the executed order total was ${c.value}.`, [...baseEvidence, evidenceFromEvent(e)]));
      return;
    }
    this.add(testId, name, 'tracking', 'pass', expectedDesc, `event ${e.id}, revenue ${e.revenue ?? 0}`, `Conversion event captured once with the expected value.`);
  }

  private testSessionContinuity(ledger: LedgerEntry): void {
    const jars = new Map<string, Set<string>>();
    const sessionJar = new Map(ledger.identity.sessions.map((s) => [s.sessionId, s.cookieJarId]));
    for (const e of this.events) {
      const jar = sessionJar.get(e.sessionId);
      if (!jar) continue;
      if (!jars.has(jar)) jars.set(jar, new Set());
      jars.get(jar)!.add(e.anonymousId);
    }
    if (jars.size === 0) return;
    const broken = Array.from(jars.entries()).filter(([, ids]) => ids.size > 1);
    if (broken.length === 0) {
      this.add('identity.session_continuity', 'First-party identity stable across sessions', 'identity', 'pass', 'one anonymous id per cookie jar', `${jars.size} jar(s), stable`, 'The website kept a single anonymous id for every cookie jar.');
      return;
    }
    const [jar, ids] = broken[0];
    this.add('identity.session_continuity', 'First-party identity stable across sessions', 'identity', 'fail', 'one anonymous id per cookie jar', `${ids.size} anonymous ids in jar ${jar}`, 'The anonymous id changed although cookies were never cleared.', this.diag('unexpected_session_change', 'website_sdk', `Cookie jar ${jar} produced ${ids.size} different anonymous ids (${Array.from(ids).join(', ')}) without any cookie clearing or device change in the journey.`, this.events.filter((e) => sessionJar.get(e.sessionId) === jar).slice(0, 6).map((e) => evidenceFromEvent(e))));
  }

  private testStitching(ledger: LedgerEntry): void {
    const identifiedSessions = ledger.identity.sessions.filter((s) => s.identifiedWithEmail);
    const identifyEvents = this.events.filter((e) => e.userKey && identifiedSessions.some((s) => s.sessionId === e.sessionId));
    const jarsIdentified = new Set(identifyEvents.map((e) => ledger.identity.sessions.find((s) => s.sessionId === e.sessionId)?.cookieJarId));
    const expectedJars = new Set(identifiedSessions.map((s) => s.cookieJarId));
    const missingJars = Array.from(expectedJars).filter((j) => !jarsIdentified.has(j));

    if (missingJars.length) {
      const fault = this.faultOfKind('suppress_identify');
      const evidence: Evidence[] = identifiedSessions
        .filter((s) => missingJars.includes(s.cookieJarId))
        .map((s) => ({ kind: 'ledger', label: `Session ${s.sessionId} identified on site, but no identify event`, data: s }));
      if (fault) evidence.push(evidenceFromFault(fault));
      this.add('identity.stitching', 'Cross-device identity stitching', 'identity', 'fail', 'identify events on every identified device', `no identify event for ${missingJars.length} device(s)`, 'The website never sent an identify event for a device where the customer logged in.', this.diag('identity_stitching_failure', 'website_sdk', `The customer identified with ${ledger.identity.email} on ${expectedJars.size} device(s), but identify events were only received for ${jarsIdentified.size}. Without them no attribution system can stitch the journey.`, evidence));
      return;
    }

    const anyResult = this.allResults.find((r) => r.runId === this.run.id && ledger.conversions.some((c) => c.orderId && r.conversion.orderId === c.orderId));
    if (!anyResult) {
      this.add('identity.stitching', 'Cross-device identity stitching', 'identity', 'inconclusive', 'stitched identity in attribution results', 'no attribution result to inspect', 'Identify events were captured, but no attribution result is available to verify stitching.');
      return;
    }
    const group = new Set(ledger.identity.linkGroups.find((g) => g.includes(ledger.identity.sessions.find((s) => s.sessionId === ledger.conversions[0]?.sessionId)?.cookieJarId ?? '')) ?? []);
    const expectedAnon = new Set(this.events.filter((e) => group.has(ledger.identity.sessions.find((s) => s.sessionId === e.sessionId)?.cookieJarId ?? '')).map((e) => e.anonymousId));
    const missing = Array.from(expectedAnon).filter((a) => !anyResult.identity.anonymousIds.includes(a));
    if (missing.length === 0) {
      this.add('identity.stitching', 'Cross-device identity stitching', 'identity', 'pass', `${expectedAnon.size} anonymous ids stitched`, `identity ${anyResult.identity.id} holds ${anyResult.identity.anonymousIds.length} ids`, 'The attribution system linked every device of this customer into one identity.');
      return;
    }
    this.add('identity.stitching', 'Cross-device identity stitching', 'identity', 'fail', `${expectedAnon.size} anonymous ids in one identity`, `${anyResult.identity.anonymousIds.length} ids; missing ${missing.join(', ')}`, 'The attribution system did not stitch all devices of this customer.', this.diag('identity_stitching_failure', 'identity_resolution', `Identify events linked anonymous ids ${Array.from(expectedAnon).join(', ')} to the same hashed email, but the attribution system resolved the conversion to identity ${anyResult.identity.id} containing only ${anyResult.identity.anonymousIds.join(', ')}.`, [evidenceFromResult(anyResult), ...identifyEvents.slice(0, 4).map((e) => evidenceFromEvent(e, 'Identify evidence')), evidenceFromConfig('SUT identity resolution', { identityResolution: this.run.sutSnapshot.identityResolution })]));
  }

  private testAttribution(ledger: LedgerEntry, conversion: GroundTruthConversion, expected: ExpectedAttribution): void {
    const idx = ledger.conversions.indexOf(conversion) + 1;
    const testId = `attribution.${expected.model}.${idx}`;
    const name = `${modelLabel(expected.model)} attribution · ${conversion.eventType}${conversion.orderId ? ` ${conversion.orderId}` : ''}`;
    const expectedDesc = describeCredits(expected.credits);
    const conversionEvents = this.conversionEvents(conversion);
    const results = this.resultsFor(conversion, expected.model);
    const row = (actual: AttributionResult | null, status: TestStatus, match: boolean) =>
      this.rows.push({ customerId: this.customer.id, customerName: customerDisplayName(this.customer), conversionId: conversion.id, orderId: conversion.orderId, value: conversion.value, model: expected.model, expected: expected.credits, actual: actual?.credits ?? null, match, status });

    if (results.length === 0) {
      if (conversionEvents.length === 0 || conversionEvents.every((e) => !e.delivery.deliveredToSut)) {
        row(null, 'inconclusive', false);
        this.add(testId, name, 'attribution', 'inconclusive', expectedDesc, 'no attribution result (conversion never reached the attribution system)', 'Attribution could not be evaluated because the conversion event did not reach the attribution system; see the tracking failure.');
        return;
      }
      row(null, 'fail', false);
      this.add(testId, name, 'attribution', 'fail', expectedDesc, 'no attribution result', 'The conversion reached the collector but the attribution system produced no result for it.', this.diag('conversion_not_attributed', 'attribution_ingestion', `A ${conversion.eventType} event (${conversion.orderId ?? conversion.id}) exists in the collected data, but the attribution system returned no ${expected.model} result for it.`, conversionEvents.map((e) => evidenceFromEvent(e))));
      return;
    }

    const result = results[0];
    if (creditsEqual(expected.credits, result.credits)) {
      row(result, 'pass', true);
      this.add(testId, name, 'attribution', 'pass', expectedDesc, describeCredits(result.credits), `Attribution matches the independent reference model${expected.note ? ` (${expected.note})` : ''}.`);
      return;
    }
    row(result, 'fail', false);
    const diagnostic = this.diagnoseAttributionMismatch(ledger, conversion, expected, result);
    this.add(testId, name, 'attribution', 'fail', expectedDesc, describeCredits(result.credits), `Expected ${expectedDesc}; attribution system reported ${describeCredits(result.credits)}.`, diagnostic);
  }

  private diagnoseAttributionMismatch(ledger: LedgerEntry, conversion: GroundTruthConversion, expected: ExpectedAttribution, result: AttributionResult): FailureDiagnostic {
    const baseEvidence: Evidence[] = [evidenceFromResult(result, 'Attribution system result'), { kind: 'ledger', label: 'Expected attribution (reference model)', ref: ledger.id, data: expected }];
    const expectedTps = ledger.touchpoints.filter((tp) => expected.eligibleTouchpointIds.includes(tp.id));

    // Map SUT journey entries back to collected events / ground-truth touchpoints.
    const journeyEventIds = new Set(result.journey.map((j) => j.touchpointId.replace(/^tp_/, '')));
    const journeyFor = (event: CollectedEvent) =>
      result.journey.find((j) => j.touchpointId.replace(/^tp_/, '') === event.id) ??
      result.journey.find((j) => j.anonymousId === event.anonymousId && Math.abs(ms(j.ts) - ms(event.ts)) < TS_TOLERANCE_MS);

    for (const tp of expectedTps) {
      const event = this.findLandingEvent(tp);
      const tpAction = ledger.executed.find((a) => a.nodeId === tp.nodeId);
      const tpEvidence = tpAction ? evidenceFromAction(tpAction, `Ground truth: ${tp.channel} click (${tp.campaignId})`) : [];
      if (!event) {
        return this.diag('missing_touchpoint', this.faultOfKind('drop_events') ? 'event_collector' : 'website_sdk', `The ${tp.channel} touchpoint (${tp.campaignId}) was executed but never captured by the website, so the attribution system could not credit it.`, [...baseEvidence, ...tpEvidence]);
      }
      const entry = journeyFor(event);
      if (!entry) {
        if (!result.identity.anonymousIds.includes(event.anonymousId)) {
          const identifyEvents = this.events.filter((e) => e.eventType === 'identify' && e.userKey).slice(0, 4);
          const sdkFault = this.faultOfKind('suppress_identify');
          const sdkSide = identifyEvents.length === 0;
          return this.diag(
            'identity_stitching_failure',
            sdkSide ? 'website_sdk' : 'identity_resolution',
            sdkSide
              ? `The ${tp.channel} touchpoint (${tp.campaignId}) was captured under anonymous id ${event.anonymousId}, but the conversion happened under ${result.conversion.anonymousId}. No identify events were received from the website, so no attribution system could link the two devices.`
              : `The ${tp.channel} touchpoint (${tp.campaignId}) was captured under anonymous id ${event.anonymousId}, but the conversion was attributed to identity ${result.identity.id} containing only [${result.identity.anonymousIds.join(', ')}]. Identify events linking the devices were received; the attribution system is configured for ${this.run.sutSnapshot.identityResolution} identity resolution.`,
            [...baseEvidence, ...tpEvidence, evidenceFromEvent(event, 'Captured touchpoint (different anonymous id)'), ...identifyEvents.map((e) => evidenceFromEvent(e, 'Identify evidence')), ...(sdkFault ? [evidenceFromFault(sdkFault)] : []), evidenceFromConfig('SUT identity resolution', { identityResolution: this.run.sutSnapshot.identityResolution })],
          );
        }
        if (!event.utm.utm_source) {
          const fault = this.faultOfKind('missing_utm');
          return this.diag('missing_utm_parameters', 'ad_destination_configuration', `The ${tp.channel} landing carried no UTM parameters (only ${Object.keys(event.clickIds).join(', ') || 'no click id'}), so the attribution system did not classify it as a ${tp.channel} touchpoint.`, [...baseEvidence, ...tpEvidence, evidenceFromEvent(event), ...(fault ? [evidenceFromFault(fault)] : []), evidenceFromConfig('SUT click-id mappings', this.run.sutSnapshot.clickIdMappings)]);
        }
        return this.diag('touchpoint_dropped_by_attribution', 'attribution_ingestion', `The ${tp.channel} touchpoint (${tp.campaignId}) was captured with ${describeUtm(event.utm)} under the conversion's identity, yet the attribution system's journey does not contain it.`, [...baseEvidence, ...tpEvidence, evidenceFromEvent(event), evidenceFromConfig('SUT faults', this.run.sutSnapshot.faults)]);
      }
      if (!event.utm.utm_source && (entry.channel !== tp.channel || entry.campaignId !== tp.campaignId)) {
        const fault = this.faultOfKind('missing_utm');
        return this.diag('missing_utm_parameters', 'ad_destination_configuration', `The ${tp.channel} landing carried no UTM parameters (only ${Object.keys(event.clickIds).join(', ') || 'no click id'}), so the attribution system classified it as "${entry.channel} · ${entry.campaignId}" instead of ${tp.channel} · ${tp.campaignId}.`, [...baseEvidence, ...tpEvidence, evidenceFromEvent(event), ...(fault ? [evidenceFromFault(fault)] : []), evidenceFromConfig('SUT click-id mappings', this.run.sutSnapshot.clickIdMappings)]);
      }
      if (entry.campaignId !== tp.campaignId) {
        const urlWrong = (event.utm.utm_campaign ?? '') !== tp.campaignId;
        const fault = this.faultOfKind('wrong_campaign_param');
        return this.diag('wrong_campaign_attribution', urlWrong ? 'ad_destination_configuration' : 'attribution_ingestion', urlWrong ? `The ${tp.channel} ad destination carried utm_campaign=${event.utm.utm_campaign} instead of ${tp.campaignId}; the attribution system credited campaign ${entry.campaignId}.` : `The landing URL carried the correct campaign (${tp.campaignId}) but the attribution system credited ${entry.campaignId}.`, [...baseEvidence, ...tpEvidence, evidenceFromEvent(event), ...(fault ? [evidenceFromFault(fault)] : []), evidenceFromConfig('SUT faults', this.run.sutSnapshot.faults)]);
      }
      if (!entry.eligible) {
        return this.diag('incorrect_lookback_window', 'attribution_model_configuration', `The ${tp.channel} touchpoint is within the ${expected.lookbackDays}-day policy window but the attribution system marked it ineligible (${entry.reason ?? 'no reason'}; configured lookback ${result.lookbackDays} days).`, [...baseEvidence, ...tpEvidence, evidenceFromEvent(event), evidenceFromConfig('Lookback configuration', { policy: expected.lookbackDays, sut: result.lookbackDays })]);
      }
    }

    // Touchpoints the SUT credited that the reference model excluded.
    for (const entry of result.journey.filter((j) => j.eligible)) {
      const event = this.events.find((e) => e.id === entry.touchpointId.replace(/^tp_/, '')) ?? this.events.find((e) => e.anonymousId === entry.anonymousId && Math.abs(ms(e.ts) - ms(entry.ts)) < TS_TOLERANCE_MS);
      const tp = event ? ledger.touchpoints.find((t) => this.findLandingEvent(t)?.id === event.id) : undefined;
      if (tp && expected.ineligibleTouchpointIds.includes(tp.id)) {
        const outsideWindow = ms(conversion.ts) - ms(tp.ts) > expected.lookbackDays * 24 * 3600 * 1000;
        if (outsideWindow) {
          return this.diag('incorrect_lookback_window', 'attribution_model_configuration', `The ${tp.channel} touchpoint (${tp.campaignId}) is ${Math.round((ms(conversion.ts) - ms(tp.ts)) / 86400000)} days before the conversion — outside the ${expected.lookbackDays}-day policy — but the attribution system (lookback ${result.lookbackDays} days) credited it.`, [...baseEvidence, ...(event ? [evidenceFromEvent(event)] : []), evidenceFromConfig('Lookback configuration', { policy: expected.lookbackDays, sut: result.lookbackDays })]);
        }
        return this.diag('incorrect_attribution_credit', 'identity_resolution', `The attribution system credited the ${tp.channel} touchpoint (${tp.campaignId}) although it belongs to a cookie jar that was never linked to the converting identity.`, [...baseEvidence, ...(event ? [evidenceFromEvent(event)] : [])]);
      }
      if (!tp && !journeyEventIds.has(event?.id ?? '')) {
        return this.diag('incorrect_attribution_credit', 'attribution_ingestion', `The attribution system credited a touchpoint (${entry.channel} · ${entry.campaignId}) that does not correspond to any executed marketing interaction.`, [...baseEvidence]);
      }
    }

    return this.diag('incorrect_attribution_credit', 'attribution_model_configuration', `The attribution system considered the same touchpoints as the reference model but split credit differently (expected ${describeCredits(expected.credits)}, got ${describeCredits(result.credits)}).`, baseEvidence);
  }

  private testNoDuplicateAttribution(ledger: LedgerEntry): void {
    for (const conversion of ledger.conversions) {
      for (const model of this.run.sutSnapshot.models) {
        const results = this.resultsFor(conversion, model);
        if (results.length > 1) {
          this.add(`attribution.no_duplicates.${model}`, `No duplicate attributed conversions · ${modelLabel(model)}`, 'attribution', 'fail', '1 attributed conversion', `${results.length} attributed conversions for ${conversion.orderId ?? conversion.id}`, 'The attribution system counted the same conversion more than once.', this.diag('duplicate_conversion', 'attribution_ingestion', `${results.length} ${model} results exist for order ${conversion.orderId ?? conversion.id}; the attribution system does not deduplicate conversions by order id (dedupeConversionsByOrderId=${this.run.sutSnapshot.dedupeConversionsByOrderId}).`, [...results.map((r) => evidenceFromResult(r)), evidenceFromConfig('SUT dedupe setting', { dedupeConversionsByOrderId: this.run.sutSnapshot.dedupeConversionsByOrderId })]));
          return;
        }
      }
    }
    this.add('attribution.no_duplicates', 'No duplicate attributed conversions', 'attribution', 'pass', '1 attributed conversion per order', 'no duplicates', 'Each conversion was attributed exactly once per model.');
  }

  private testIsolation(ledger: LedgerEntry): void {
    const check = ledger.isolationCheck!;
    if (check.productionEventsObserved === 0) {
      this.add('isolation.production_leakage', 'No synthetic traffic in production analytics', 'isolation', 'pass', '0 production analytics events', '0', check.note);
      return;
    }
    this.add('isolation.production_leakage', 'No synthetic traffic in production analytics', 'isolation', 'fail', '0 production analytics events', `${check.productionEventsObserved} events`, 'Synthetic sessions reached the production analytics tag.', this.diag('production_leakage', 'analytics_isolation', `${check.productionEventsObserved} production analytics event(s) fired during a synthetic session. ${check.note}`, [evidenceFromConfig('Isolation check', check)]));
  }
}

function describeUtm(utm: Record<string, string>): string {
  const parts = Object.entries(utm).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join('&') : 'no UTM parameters';
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return url;
  }
}

export function modelLabel(model: string): string {
  return model === 'first_touch' ? 'First-touch' : model === 'last_touch' ? 'Last-touch' : model === 'linear' ? 'Linear' : model;
}
