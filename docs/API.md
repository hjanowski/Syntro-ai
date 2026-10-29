# Syntro Engine API — v1

Transport: HTTP JSON under `/v1` (Node host, `server/src/api/http.ts`) or in-process (`EngineService`, browser host).
Types: `engine/src/contracts/v1.ts` and `engine/src/domain/types.ts`. Every response is enveloped:

```json
{ "ok": true,  "data": …, "version": "v1" }
{ "ok": false, "error": { "code": "not_found", "message": "…" }, "version": "v1" }
```

## Endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/v1/health`, `/v1/info` | | `EngineInfo` |
| GET | `/v1/overview` | | `OverviewStats` |
| GET/POST | `/v1/projects` | `CreateProjectRequest` | `Project[]` / `Project` |
| GET/PATCH/DELETE | `/v1/projects/:id` | `UpdateProjectRequest` | `Project` |
| POST | `/v1/projects/:id/seed` | | journeys + scenarios created from templates/presets |
| GET | `/v1/projects/:id/integrations` | | `IntegrationStatus[]` |
| POST/GET | `/v1/projects/:id/preflight` | | `PreflightReport` |
| POST | `/v1/projects/:id/customers/preview` | `PreviewCustomersRequest` | `SyntheticCustomer[]` (not stored) |
| GET | `/v1/journeys/templates` | | `JourneyTemplate[]` |
| POST | `/v1/journeys/validate` | `{ nodes, edges }` | `JourneyValidationResult` |
| POST | `/v1/journeys/from-template` | `{ templateKey, projectId }` | `JourneyDefinition` |
| GET/POST | `/v1/journeys?projectId=` | `CreateJourneyRequest` | `JourneyDefinition[]` / `JourneyDefinition` |
| GET/PATCH/DELETE | `/v1/journeys/:id` | `UpdateJourneyRequest` | `JourneyDefinition` |
| GET | `/v1/scenarios/presets` | | `ScenarioPreset[]` |
| GET/POST | `/v1/scenarios?projectId=` | `CreateScenarioRequest` | `Scenario[]` / `Scenario` |
| GET/PATCH/DELETE | `/v1/scenarios/:id` | `UpdateScenarioRequest` | `Scenario` |
| GET/POST | `/v1/simulations?projectId=` | `StartSimulationRequest` | `SimulationRun[]` / `SimulationRun` (queued; executes asynchronously) |
| GET | `/v1/simulations/:id` | | `RunDetail` (run, customers, project, scenarios) — poll for progress |
| POST | `/v1/simulations/:id/stop` | | `SimulationRun` |
| POST | `/v1/simulations/:id/rerun` | `RerunRequest { mode: 'all' \| 'failed_only' }` | new `SimulationRun` |
| POST | `/v1/simulations/:id/revalidate` | | `SimulationRun` (re-ingest + validate with current SUT config) |
| DELETE | `/v1/simulations/:id` | | |
| GET | `/v1/simulations/:id/customers` | | `SyntheticCustomer[]` |
| GET | `/v1/simulations/:id/ledger` | | `LedgerEntry[]` (ground truth) |
| GET | `/v1/simulations/:id/events` | | `CollectedEvent[]` (observed tracking data) |
| GET | `/v1/simulations/:id/attribution` | | `AttributionResult[]` (system under test) |
| GET | `/v1/simulations/:id/validation` | | `ValidationReport \| null` |
| GET | `/v1/simulations/:id/logs?customerId=` | | `ExecutionLogEntry[]` |
| GET | `/v1/simulations/compare?baseline=&candidate=` | | `RunComparison` |
| GET | `/v1/customers/:id` | | `CustomerDetail` (customer, ledger, events, collector log, platform records, results, logs) |
| POST | `/v1/collect` | `CollectRequest { token, events[] }` | `CollectResponse` — **the SDK endpoint** |
| POST | `/v1/demo/seed` | | the demo project |
| POST | `/v1/reset` | | |

## Running a test programmatically

```bash
# 1. project with preconfigured scenarios
curl -s -X POST localhost:4100/v1/projects -H 'content-type: application/json' \
  -d '{"name":"Acme","seedDemo":true}'
# 2. pick scenarios
curl -s "localhost:4100/v1/scenarios?projectId=proj_…"
# 3. start
curl -s -X POST localhost:4100/v1/simulations -H 'content-type: application/json' \
  -d '{"projectId":"proj_…","assignments":[{"scenarioId":"scn_…","customerCount":5}]}'
# 4. poll
curl -s localhost:4100/v1/simulations/run_…
# 5. results
curl -s localhost:4100/v1/simulations/run_…/validation
```

## Website SDK event envelope (`SdkEvent`)

```json
{
  "event_id": "ev_…", "type": "purchase", "ts": "2026-03-01T12:00:00.000Z",
  "url": "…", "path": "/store/order.html", "referrer": "…", "title": "…",
  "anonymous_id": "anon_…", "user": { "email": "…" },
  "utm": { "utm_source": "facebook", "utm_medium": "paid_social", "utm_campaign": "fb_retargeting_q2" },
  "click_ids": { "fbclid": "syn_fbclid_…" },
  "props": { "order_id": "ORD-…", "revenue": 120, "currency": "USD", "items": [] },
  "device": { "user_agent": "…", "viewport": "390x844" }, "sdk_version": "0.1.0"
}
```

The collector enriches each event into a `CollectedEvent` with `project_id`, `run_id`, `scenario_id`,
`synthetic_customer_id`, `session_id`, `is_synthetic: true`, `source`, delivery metadata and applied faults.

## Attribution adapter contract

Adapters implement `AttributionAdapter` (`engine/src/attribution/adapters/types.ts`):

```ts
ingest(events: AttributionFacingEvent[], platformRecords: PlatformRecord[]): Promise<{ accepted: number }>
getResults(): Promise<AttributionResult[] | 'pending'>
```

`AttributionFacingEvent` deliberately omits Syntro identifiers:

```json
{ "eventId": "evt_…", "ts": "…", "type": "page_view", "anonymousId": "anon_…", "userKey": "<sha256(email)>",
  "url": "…", "path": "…", "referrer": "…", "utm": {}, "clickIds": {}, "revenue": 120, "orderId": "ORD-…" }
```

External systems return one `AttributionResult` per conversion × model:

```json
{
  "model": "last_touch", "lookbackDays": 30,
  "conversion": { "id": "…", "orderId": "ORD-…", "type": "purchase", "value": 120, "ts": "…", "anonymousId": "anon_…" },
  "identity": { "id": "…", "anonymousIds": ["anon_a", "anon_b"], "userKey": "…" },
  "journey": [ { "touchpointId": "…", "channel": "meta", "campaignId": "fb_retargeting_q2", "ts": "…", "anonymousId": "anon_a", "eligible": true } ],
  "credits": [ { "channel": "meta", "campaignId": "fb_retargeting_q2", "credit": 120, "share": 1 } ]
}
```

- **local** (functional): bundled SUT, instantiated per run.
- **file** (prototype): paste the system's results document into the project's SUT settings; the run stays in
  `awaiting_results` until then; `revalidate` finishes it.
- **http** (prototype): `POST {ingestUrl}` with `{ run_id, events, platform_records }`, `GET {resultsUrl}?run_id=`
  returning `AttributionResult[]` (202/404 = pending).

Channels: `email | meta | google | linkedin | sms | whatsapp | direct | referral | unknown`. Models:
`first_touch | last_touch | linear`.
