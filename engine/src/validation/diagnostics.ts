import type {
  AttributionResult,
  CollectedEvent,
  Evidence,
  ExecutedAction,
  FailureType,
  PointOfFailure,
  ScenarioFault,
} from '../domain/types.ts';

export const FAILURE_LABELS: Record<FailureType, string> = {
  execution_failure: 'Journey execution failed',
  missing_touchpoint: 'Missing touchpoint',
  campaign_parameter_mismatch: 'Campaign parameter mismatch',
  missing_utm_parameters: 'Missing UTM parameters',
  lost_conversion_event: 'Lost conversion event',
  duplicate_conversion: 'Duplicate conversion',
  delayed_event: 'Delayed event',
  identity_stitching_failure: 'Identity stitching failure',
  unexpected_session_change: 'Unexpected session change',
  conversion_not_attributed: 'Conversion not attributed',
  incorrect_attribution_credit: 'Incorrect attribution credit',
  incorrect_lookback_window: 'Incorrect lookback window',
  wrong_campaign_attribution: 'Wrong campaign attribution',
  touchpoint_dropped_by_attribution: 'Touchpoint dropped by attribution system',
  production_leakage: 'Synthetic traffic leaked to production analytics',
};

export const POINT_LABELS: Record<PointOfFailure, string> = {
  journey_execution: 'Journey execution (browser automation)',
  ad_destination_configuration: 'Ad / email destination URL configuration',
  website_sdk: 'Website tracking (SDK / tag)',
  event_collector: 'Event collection pipeline',
  conversion_tracking: 'Conversion tracking',
  attribution_ingestion: 'Attribution system ingestion / classification',
  identity_resolution: 'Identity resolution in the attribution system',
  attribution_model_configuration: 'Attribution model configuration',
  analytics_isolation: 'Production analytics isolation',
  unknown: 'Unknown',
};

export const RECOMMENDATIONS: Record<FailureType, string[]> = {
  execution_failure: [
    'Open the failed step evidence (screenshot / DOM snapshot) and confirm the page and selector still exist.',
    'Re-run the scenario; transient navigation timeouts are retried automatically but persistent failures indicate a site change.',
    'If the website changed, update the journey definition or the SDK integration.',
  ],
  missing_touchpoint: [
    'Confirm the landing page loads the website SDK before any redirect or consent gate.',
    'Check the collector log for rejected or dropped events for this session.',
    'Verify the synthetic session token survives the landing redirect (it must be present in the landing URL or storage).',
  ],
  campaign_parameter_mismatch: [
    'Compare the configured ad destination URL with the campaign naming convention; the utm_campaign value does not match the campaign.',
    'Fix the destination URL in the ad platform and re-run the scenario.',
  ],
  missing_utm_parameters: [
    'Add UTM parameters to the ad destination URL (utm_source, utm_medium, utm_campaign).',
    'Alternatively, map the platform click id (e.g. li_fat_id) to the channel in the attribution system, or enable platform click-record ingestion.',
  ],
  lost_conversion_event: [
    'Check whether the purchase tag fires on the order confirmation page for test orders.',
    'Review collector logs: the event may have been dropped, rejected (invalid token) or blocked by consent/ad-blocking rules.',
    'Verify the test checkout redirects to a page where the SDK is loaded.',
  ],
  duplicate_conversion: [
    'Deduplicate conversions by order id in the attribution system.',
    'Check the tag trigger: the purchase tag should fire once per order, not on every confirmation page load.',
  ],
  delayed_event: [
    'Measure end-to-end latency between website event and attribution ingestion.',
    'Schedule attribution computation after the ingestion SLA, or re-run attribution for late-arriving conversions.',
  ],
  identity_stitching_failure: [
    'Enable email/user-id based identity resolution in the attribution system (currently cookie-only).',
    'Verify identify events carry the same hashed identifier on every device.',
    'Re-run the cross-device scenario after the configuration change.',
  ],
  unexpected_session_change: [
    'The first-party anonymous id changed within a session group where no cookie clearing was executed.',
    'Check cookie domain/path settings and storage partitioning on the website.',
  ],
  conversion_not_attributed: [
    'The conversion reached the collector but the attribution system produced no result for it.',
    'Check the ingestion job and conversion event mapping (event type, revenue field, order id).',
  ],
  incorrect_attribution_credit: [
    'Compare the expected and actual credit split; verify the model configuration (first/last/linear) in the attribution system.',
    'Check rounding and currency handling for multi-touch splits.',
  ],
  incorrect_lookback_window: [
    'Align the attribution system lookback window with the agreed policy.',
    'Verify touchpoint timestamps are ingested in the correct timezone.',
  ],
  wrong_campaign_attribution: [
    'Check the campaign id mapping between the ad platform, UTM values and the attribution system.',
    'Fix the destination URL or the mapping table and re-run.',
  ],
  touchpoint_dropped_by_attribution: [
    'The touchpoint was captured by the website but the attribution system ignored it.',
    'Review channel classification rules and any channel filters in the attribution system.',
  ],
  production_leakage: [
    'Synthetic sessions reached production analytics. Ensure the synthetic-session check runs before production tags fire (GTM blocking trigger).',
    'Do not treat any production destination as isolated until this check passes for the customer configuration.',
  ],
};

export function evidenceFromAction(action: ExecutedAction, label?: string): Evidence[] {
  const out: Evidence[] = [
    {
      kind: 'ledger',
      label: label ?? `Executed: ${action.label}`,
      ref: action.id,
      ts: action.virtualTs,
      data: { status: action.status, attempts: action.attempts, details: action.details, error: action.error },
    },
  ];
  for (const ev of action.evidence) if (ev.kind === 'screenshot' || ev.kind === 'dom_snapshot' || ev.kind === 'url') out.push(ev);
  return out;
}

export function evidenceFromEvent(e: CollectedEvent, label?: string): Evidence {
  return {
    kind: 'collected_event',
    label: label ?? `Collected ${e.eventType}`,
    ref: e.id,
    ts: e.ts,
    data: {
      event_type: e.eventType,
      anonymous_id: e.anonymousId,
      session_id: e.sessionId,
      url: e.url,
      utm: e.utm,
      click_ids: e.clickIds,
      revenue: e.revenue,
      order_id: e.orderId,
      user_key: e.userKey,
      delivery: e.delivery,
      faults_applied: e.faultsApplied,
    },
  };
}

export function evidenceFromResult(r: AttributionResult, label?: string): Evidence {
  return {
    kind: 'attribution_result',
    label: label ?? `${r.adapter} · ${r.model} result`,
    ref: r.id,
    ts: r.computedAt,
    data: { conversion: r.conversion, identity: r.identity, journey: r.journey, credits: r.credits, lookbackDays: r.lookbackDays },
  };
}

export function evidenceFromFault(f: ScenarioFault): Evidence {
  return { kind: 'fault_injection', label: `Injected fault: ${f.kind}`, data: f };
}

export function evidenceFromConfig(label: string, data: unknown): Evidence {
  return { kind: 'configuration', label, data };
}
