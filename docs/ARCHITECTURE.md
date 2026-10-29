# Syntro architecture

```
LAYER 2 — SYNTRO SAAS EXPERIENCE  (app/)
┌────────────────────────────────────────────────────────────┐
│ Overview · Projects · Journey Builder (React Flow)          │
│ Synthetic Customers · Simulation Control Centre (live)      │
│ Results & Diagnostics · Run comparison · Integrations       │
└───────────────┬────────────────────────────────────────────┘
                │ EngineClient (app/src/engine/client.ts)
                │   ├─ HttpEngineClient      → /v1/* (Node host)
                │   └─ EmbeddedEngineClient  → in-process EngineService (browser host)
                │ v1 contracts: engine/src/contracts/v1.ts
LAYER 1 — SYNTRO ENGINE  (engine/ — isomorphic TypeScript, no DOM/Node dependencies)
┌────────────────────────────────────────────────────────────┐
│ EngineService (service/engine-service.ts) — the API façade  │
│  ├ SimulationRunner (execution/runner.ts)                   │
│  │   └ JourneyExecutor (execution/executor.ts)              │
│  │       └ BrowserDriver interface (execution/driver.ts)    │
│  │           ├ PlaywrightDriver   server/src/drivers/        │
│  │           └ IframeDriver       app/src/engine/            │
│  ├ Synthetic Customer Engine (customers/generate.ts)        │
│  ├ Journey graph + node catalog + templates (journeys/)     │
│  ├ Simulated channel URL builders (channels/urls.ts)        │
│  ├ Session tokens, HMAC-SHA256 (tokens/session-token.ts)    │
│  ├ Event Collector (collector/collector.ts)                 │
│  ├ Ground Truth Ledger expectations (ledger/expectations.ts)│
│  ├ Reference attribution model (attribution/reference.ts)   │
│  ├ Local attribution SUT (attribution/sut/)                 │
│  ├ Attribution adapters: local · file · http (adapters/)    │
│  ├ Synthetic platform data feed (attribution/platform-feed) │
│  ├ Validation & diagnostics (validation/)                   │
│  └ Store interface + MemoryStore (store/store.ts)           │
└───────────────┬────────────────────────────────────────────┘
                │
EXTERNAL / INSTRUMENTED SYSTEMS
┌────────────────────────────────────────────────────────────┐
│ sites/store      Aurora Supply Co. demo store + SDK + guard │
│ sites/channels   Simulated Meta / Google / LinkedIn / email │
│                  / SMS / WhatsApp environments              │
│ sdk/syntro.js    Website SDK (also for external websites)   │
│ Attribution solution: local SUT, or external via adapters   │
└────────────────────────────────────────────────────────────┘
```

## Design principles and how they are enforced

**Functionality before presentation.** Layer 1 runs entirely from the CLI (`server/src/cli.ts`) with no UI; the
Phase 1 and Phase 2 success criteria were met before Layer 2 existed.

**Real execution.** `JourneyExecutor` only acts through `BrowserDriver`; both drivers load real pages, click real
elements and wait for real navigations. Progress shown in the UI is read from the store the executor writes to.

**Independent verification.** Three sources are kept apart and compared by the validator:

| Source | Written by | Reads |
| --- | --- | --- |
| Ground truth ledger (`LedgerEntry`) | `JourneyExecutor` only | the browser (what the customer did) |
| Observed tracking data (`CollectedEvent`) | `EventCollector` only | the website SDK |
| Attribution results (`AttributionResult`) | the adapter / system under test | attribution-facing events only |

The **reference model** (`attribution/reference.ts`) computes expected credits from the ledger. The **system under
test** (`attribution/sut/local-attribution-system.ts`) is a separate implementation that resolves identities and
classifies touchpoints from `AttributionFacingEvent`s, which carry no Syntro identifiers (`attribution/facing.ts`).
It cannot join on synthetic customer ids; it must stitch like a real system.

**Test isolation.** Synthetic sessions carry an HMAC-signed token (`tokens/session-token.ts`); the collector rejects
anything else. The SDK is inert without a valid token, pushes `syntro_synthetic` to the data layer, and the demo store
guards its mock production tag exactly like a GTM blocking trigger. The executor reads the mock production tag's event
count at the end of each journey (`isolationCheck`) and the preflight (`EngineService.runPreflight`) verifies routing
and leakage before a project is trusted. Test checkout creates flagged test orders only; external websites must set
`testCheckoutAuthorized` before conversion scenarios run.

**Evidence-based diagnostics.** Every `FailureDiagnostic` carries the ledger actions (with screenshots / DOM
snapshots), the collected events, the attribution result, the injected fault and the relevant configuration that led
to the classification (`validation/validator.ts`, `validation/diagnostics.ts`).

**Modular architecture.** New channels: add a page under `sites/channels/` and an entry in `CHANNEL_META`. New
website actions: a node type in `journeys/node-catalog.ts` + a handler in the executor. New attribution platforms:
implement `AttributionAdapter`. New execution environments: implement `BrowserDriver`. New storage: implement `Store`.

## Execution model

- A **run** holds scenario assignments; customers are generated deterministically from the run seed.
- `SimulationRunner` executes customers with bounded parallelism (one browser context each), then **finalises**:
  marks delayed events as delivered or not, projects events for the adapter, ingests, retrieves results, validates,
  stores the report and summary. Finalisation is re-runnable (`revalidate`) against the project's *current* SUT
  configuration without re-executing browsers; `rerun` executes again (all scenarios or failed ones only).
- **Virtual clock.** `wait` nodes with virtual hours/days advance a per-customer offset carried in the token; the SDK
  stamps events with it, so lookback windows can be exercised without waiting. A virtual wait starts a new session.
- **Identity model.** Each session has a *cookie jar id*; `clear_cookies` and `change_device` start a new jar. Sessions
  that identified (login, registration, newsletter, checkout) link their jar to the customer's email. The ledger's
  *link groups* are the jars a correct system should be able to stitch; expected attribution only uses touchpoints in
  the converting jar's link group, which is how "executed but unlinkable by design" (cookie loss) is distinguished
  from a stitching failure.

## Roadmap status

| Phase | Status |
| --- | --- |
| 1 — Functional engine MVP | **Done.** One synthetic customer completes a real automated journey; the engine verifies attribution from the CLI. |
| 2 — Scale & validation | **Done.** Parallel customers, 10 journey templates / 13 scenario presets, 6 simulated channels, identity continuity, 6 fault kinds, customer-level diagnostics, file/http adapter contracts, unit + e2e regression tests. |
| 3 — Commercial experience | **Done (prototype quality).** Dashboard, journey builder, customer manager, control centre with live execution, results dashboard, timelines, failure investigation, run comparison, integrations. |
| 4 — External website readiness | **Partial.** Packaged SDK, GTM recipe, signed session authorization, routing verification (preflight), test-checkout gate and documentation exist; the demonstration against an independently deployed external website has **not** been performed, so production isolation must be verified per customer configuration. |

Not implemented: vendor adapters (Salesforce, Adobe), LLM-driven navigation of unfamiliar websites, PostgreSQL store,
authentication / multi-tenancy, view-through attribution.
