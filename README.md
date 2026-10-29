# Syntro — Simulate the journey. Trust the attribution.

Syntro is an AI-powered attribution testing platform. It creates synthetic customers, runs them through
real marketing touchpoints and an instrumented website in real browsers, records what actually happened in
an independent **Ground Truth Ledger**, and verifies — against an independently computed reference — whether
the tracking, identity resolution and attribution system under test produced the right answer.

> Your attribution may look right. Syntro proves whether it actually is.

**Live demo (GitHub Pages, no install):** https://hjanowski.github.io/Syntro-ai/
The hosted demo runs the full Layer 1 engine inside your browser tab (see [Hosting modes](#hosting-modes)).

## What is in the box

| Layer | Package | What it is |
| --- | --- | --- |
| **Layer 1 — Simulation & Validation Engine** | `engine/` | Isomorphic TypeScript core: synthetic customer engine, journey orchestrator, simulated marketing environments, signed synthetic sessions, isolated event collector, ground truth ledger, reference attribution model, local attribution system under test, attribution adapters, validation & diagnostics engine, versioned API contracts. |
| **Layer 1 host — Node** | `server/` | HTTP API (`/v1`), event collector, Playwright execution workers (real headless Chromium, one isolated context per customer, screenshots), JSON persistence, CLI. |
| **Layer 2 — Commercial SaaS experience** | `app/` | React + Vite + Tailwind + React Flow: overview dashboard, projects, visual journey builder, synthetic customer manager, simulation control centre with live execution, results & diagnostics with evidence, run comparison, integrations. Talks to Layer 1 only through the v1 API. |
| Instrumented demo website | `sites/store/` | "Aurora Supply Co." e-commerce test store with search, product pages, cart, test checkout (no payments), account and newsletter, instrumented with the Syntro SDK and a guarded mock production analytics tag. |
| Simulated marketing environments | `sites/channels/` | Clearly labelled mocks of Meta Ads, Google Ads, LinkedIn Ads, an email inbox and SMS/WhatsApp. Not the real platforms. |
| Website SDK | `sdk/syntro.js` | Lightweight tracking SDK + GTM recipe (`sdk/gtm/`). |
| Docs | `docs/` | [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [Integrations & what is real](docs/INTEGRATIONS.md), [Journey definitions](docs/JOURNEYS.md), [Investor demo script](docs/DEMO.md). |

## Quick start (local, full Playwright engine)

Requirements: Node.js 20.19+ (22 recommended). No database, Docker or third-party credentials needed.

```bash
npm install
npx playwright install chromium      # one-time browser download
npm run demo -- --fix                # investor demonstration from the terminal (Layer 1 only, no UI)
```

Run the full product locally:

```bash
npm run build        # builds the Layer 2 app
npm run dev          # starts the engine host on http://localhost:4100 (API, collector, demo sites, app)
```

Open http://localhost:4100 — the app connects to the Node engine automatically and journeys execute in headless
Chromium. For UI development with hot reload run `npm run dev:app` (Vite on :5173; it proxies `/v1` to :4100 when the
engine is running and otherwise falls back to the embedded engine).

### CLI

```
npm run cli -- demo [--fix] [--headed]        # 9 happy-path + 1 cross-device customer; --fix repairs the SUT and re-runs failures
npm run cli -- run --scenario linkedin_missing_utm,duplicate_purchase_events --count 2
npm run cli -- preflight                      # synthetic routing + production isolation check
npm run cli -- scenarios                      # list scenario presets
npm run cli -- report <runId>
```

### Tests

```bash
npm test             # engine unit tests (vitest): reference model, SUT, tokens, collector, graph, templates
npm run typecheck
```

CI (`.github/workflows/ci.yml`) additionally runs an end-to-end regression in real Chromium with fault injection.

## Hosting modes

The engine has one core and two execution drivers:

| Mode | Where the engine runs | Browser automation | Screenshots | Persistence |
| --- | --- | --- | --- | --- |
| **Node host** (`npm run dev`) | Node.js process | Playwright — real headless Chromium, isolated context per customer, real cookie jars and device emulation | yes | JSON files in `server/data/` (PostgreSQL is the production path) |
| **Browser-hosted** (GitHub Pages, `vite preview`) | Inside the browser tab | Sandboxed iframes (opaque origin ⇒ isolated storage per customer) driven through a harness agent on the demo pages | DOM snapshots | `localStorage` |

Both modes run the same executor, collector, ledger, reference model, system under test and validator. Nothing is
animated or fabricated: every result comes from pages that were actually loaded, clicked and tracked.

## How a test works

1. **Synthetic customers** are generated with unique ids, names, non-deliverable emails (`*.synthetic.syntro.invalid`),
   fictional phone numbers (555-01xx), device profiles and a scenario.
2. The **journey executor** opens an isolated browser context per customer and walks the journey graph: simulated
   ad/email/message environments, clicks that land on the website with UTMs and synthetic click ids, product views,
   cart, login/registration, test checkout, waits (real or virtual-clock), device changes, cookie loss, fault injection.
3. The customer carries a **signed, short-lived synthetic session token**. The website **SDK** binds every event to it
   and routes events to the **isolated collector**, which verifies the signature and applies tracking-path faults
   (lost / duplicated / delayed events).
4. The **Ground Truth Ledger** records intended steps, executed actions (with evidence), touchpoints, conversions,
   expected identity link groups and the **expected attribution** computed by the independent reference model.
5. Observed events are projected to what an attribution system may legitimately see (no Syntro ids) and delivered to
   the **attribution adapter**; the bundled local attribution system (configurable, with deliberate faults) or an
   external system returns journeys and credits.
6. The **validation engine** compares ground truth, observed tracking data and attribution results, classifies every
   discrepancy (missing touchpoint, missing UTMs, lost/duplicate/delayed conversion, identity stitching failure,
   wrong lookback, wrong campaign, …) with a suspected point of failure, evidence and recommended troubleshooting.

## Deploying the hosted demo

Pushing to `main` runs `.github/workflows/deploy-pages.yml`, which builds the app with `VITE_BASE=/<repository name>/`
and publishes `app/dist` (app + demo sites + SDK) to GitHub Pages.

**One-time setup by the repository owner.** GitHub only lets a repository administrator switch Pages on, so the
workflow cannot do it by itself. Open `https://github.com/<owner>/<repository>/settings/pages` (for this repository:
https://github.com/hjanowski/Syntro-ai/settings/pages) and under **Build and deployment → Source** choose
**GitHub Actions**. Until that is done the workflow stops early with an error that repeats this instruction. Afterwards
re-run the failed workflow (Actions → Deploy to GitHub Pages → Re-run all jobs) or push any commit; the site is live a
minute or two later.

`.github/workflows/ci.yml` runs the typecheck, the engine unit tests, the app build and a real-browser end-to-end
regression (six scenarios through the CLI, headless Chromium) on every push and pull request.

## Status

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for the precise list of what is functional, simulated, prototype or not
yet implemented, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the roadmap status (Phases 1–4).
