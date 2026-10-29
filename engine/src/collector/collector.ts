import type { CollectRequest, CollectResponse, SdkEvent } from '../contracts/v1.ts';
import { EngineError } from '../contracts/v1.ts';
import type { CollectedEvent, CollectorLogEntry, ScenarioFault, ScenarioFaultKind, SyntheticCustomer } from '../domain/types.ts';
import type { Store } from '../store/store.ts';
import { SessionTokenService, TokenError } from '../tokens/session-token.ts';
import { sha256Hex } from '../util/encoding.ts';
import { randomId } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';

/**
 * Isolated test data collector.
 *
 * Receives event batches from the website SDK, verifies the signed synthetic session token,
 * binds each event to its project / run / scenario / customer / session, applies any active
 * tracking-path fault injections (lost, duplicated, delayed events) and stores the result as
 * *observed tracking data* — the second of the three sources the validator compares.
 */
export class EventCollector {
  constructor(
    private readonly store: Store,
    private readonly tokens: SessionTokenService,
  ) {}

  async collect(req: CollectRequest): Promise<CollectResponse> {
    if (!req || typeof req.token !== 'string' || !Array.isArray(req.events)) {
      throw new EngineError('bad_request', 'Expected { token, events[] }', 400);
    }
    let payload;
    try {
      payload = await this.tokens.verify(req.token);
    } catch (e) {
      const err = e as TokenError;
      throw new EngineError(`token_${err.code ?? 'invalid'}`, `Synthetic session token rejected: ${err.message}`, 401);
    }
    const customer = this.store.customers.get(payload.c);
    if (!customer || customer.runId !== payload.r) {
      throw new EngineError('unknown_customer', 'Token refers to an unknown synthetic customer', 404);
    }

    const receivedAt = nowIso();
    let accepted = 0;
    let rejected = 0;
    for (const raw of req.events) {
      if (!raw || typeof raw.type !== 'string' || typeof raw.anonymous_id !== 'string') {
        rejected++;
        this.log(customer, 'rejected', raw?.type ?? 'unknown', 'Malformed event envelope');
        continue;
      }
      const event = await this.normalise(raw, payload.p, payload.r, payload.s, customer.id, payload.sid, receivedAt);
      accepted++;
      await this.applyFaultsAndStore(event, customer);
    }
    return { accepted, rejected, runId: payload.r, customerId: customer.id };
  }

  private async normalise(
    raw: SdkEvent,
    projectId: string,
    runId: string,
    scenarioId: string,
    customerId: string,
    sessionId: string,
    receivedAt: string,
  ): Promise<CollectedEvent> {
    const props = raw.props ?? {};
    const email = raw.user?.email?.trim().toLowerCase();
    const utm = raw.utm ?? {};
    const revenue = typeof props.revenue === 'number' ? props.revenue : typeof props.value === 'number' ? props.value : undefined;
    return {
      id: randomId('evt'),
      projectId,
      runId,
      scenarioId,
      syntheticCustomerId: customerId,
      sessionId,
      isSynthetic: true,
      eventType: raw.type,
      source: 'website',
      ts: raw.ts && !Number.isNaN(Date.parse(raw.ts)) ? new Date(raw.ts).toISOString() : receivedAt,
      receivedAt,
      anonymousId: raw.anonymous_id,
      userEmail: email || undefined,
      userKey: email ? await sha256Hex(email) : undefined,
      url: raw.url ?? '',
      path: raw.path ?? '',
      referrer: raw.referrer ?? '',
      title: raw.title,
      utm,
      clickIds: raw.click_ids ?? {},
      campaignId: utm.utm_campaign,
      revenue,
      currency: typeof props.currency === 'string' ? props.currency : undefined,
      orderId: typeof props.order_id === 'string' ? props.order_id : undefined,
      items: Array.isArray(props.items) ? props.items : undefined,
      props,
      device: { userAgent: raw.device?.user_agent, viewport: raw.device?.viewport },
      delivery: { delayMs: 0, deliveredToSut: true },
      faultsApplied: [],
      sdkVersion: raw.sdk_version,
    };
  }

  private async applyFaultsAndStore(event: CollectedEvent, customer: SyntheticCustomer): Promise<void> {
    const faults = customer.activeFaults ?? [];
    const matching = (f: ScenarioFault): f is Extract<ScenarioFault, { eventTypes: string[] }> =>
      'eventTypes' in f && (f.eventTypes.includes(event.eventType) || f.eventTypes.includes('*'));

    for (const fault of faults) {
      if (fault.kind === 'drop_events' && matching(fault)) {
        this.log(customer, 'dropped', event.eventType, 'Fault injection: event lost before reaching the data pipeline', event.id);
        return;
      }
    }
    const applied: ScenarioFaultKind[] = [];
    for (const fault of faults) {
      if (fault.kind === 'delay_events' && matching(fault)) {
        event.delivery.delayMs = fault.delayMs;
        event.delivery.deliveredToSut = false;
        applied.push('delay_events');
        this.log(customer, 'delayed', event.eventType, `Fault injection: delivery delayed by ${Math.round(fault.delayMs / 60000)} min`, event.id);
      }
    }
    event.faultsApplied = applied;
    this.store.events.put(event);
    this.log(customer, 'accepted', event.eventType, 'Accepted with valid synthetic session token', event.id);

    for (const fault of faults) {
      if (fault.kind === 'duplicate_events' && matching(fault)) {
        const dup: CollectedEvent = {
          ...event,
          id: randomId('evt'),
          delivery: { ...event.delivery, duplicateOf: event.id },
          faultsApplied: [...applied, 'duplicate_events'],
        };
        this.store.events.put(dup);
        this.log(customer, 'duplicated', event.eventType, 'Fault injection: event received twice (double-firing tag)', dup.id);
      }
    }
  }

  private log(customer: SyntheticCustomer, kind: CollectorLogEntry['kind'], eventType: string, reason: string, eventId?: string): void {
    this.store.collectorLog.put({ id: randomId('clog'), runId: customer.runId, customerId: customer.id, ts: nowIso(), kind, eventType, reason, eventId });
  }
}
