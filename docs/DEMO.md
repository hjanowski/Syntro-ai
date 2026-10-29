# Investor demonstration script

**Story.** Aurora Supply Co. runs email, Google Ads, Meta Ads and an e-commerce website. The team believes its
attribution setup is correct. Syntro proves whether it is.

Works identically in the hosted demo (browser-hosted engine) and locally (`npm run dev`, Playwright engine).
From the terminal: `npm run demo -- --fix`.

## 1. Set up (30 s)

- Open the app. On the empty overview click **Set up the Aurora Supply Co. demo** (or Overview → *Run the investor
  demo* if the project exists). The Simulation Control Centre opens with the demo preset: **9 × Happy path
  (Email → Google → Meta → Purchase)** and **1 × Cross-device purchase with login**, and *Start from the enterprise's
  original attribution setup* checked (identity resolution = cookie only).

## 2. Launch and watch (1–2 min)

- Click **Launch simulation**. The live run page shows actual execution: each customer card advances step by step;
  in the hosted demo the *Live synthetic browsers* dock shows the real pages being driven (feed → ad → store →
  cart → checkout). Nothing is animated.
- Open any customer while it runs: the journey timeline interleaves executed steps with the events the website
  actually sent to the collector.

## 3. Results (2 min)

- Click **View results**. 9 customers pass; **1 fails**: the cross-device customer.
- Failures by type: *Identity stitching failure*; suspected point: *Identity resolution in the attribution system*.
- Open a failed attribution test. Expected (reference model): Meta $120 last-touch (and Email first-touch, $40/$40/$40
  linear). Actual: *direct $120*. The explanation states that the Meta touchpoint was captured under the desktop
  anonymous id, identify events linking both devices were received, and the attribution system is configured for
  cookie-only identity resolution. Evidence: the ground-truth click with its landing page, the captured touchpoint
  event, the identify events, the attribution result and the SUT configuration.
- *Expected vs actual attribution* tab: every other customer matches on all three models.

## 4. Fix and re-run (1 min)

- Project → *Attribution & website setup* → Identity resolution → **Cookie + hashed email** → Save.
- Back on the results page click **Re-run failed scenarios** (real re-execution) — or **Re-validate with current
  config** to re-attribute the same observed data without browsers.
- The new run passes. Results → *Compare runs* shows the delta (+ passed, − failed, accuracy 93 % → 100 %) against the
  baseline.

## Talking points

- Three independent sources: what the synthetic customer did (ledger), what the website reported (collector), what
  the attribution system concluded (adapter). Discrepancies are classified from evidence.
- Fault injection scenarios (Simulation Control Centre) show the same machinery catching missing UTMs, duplicate,
  lost and delayed conversions, wrong campaign parameters, lookback errors and SDK misconfiguration.
- The engine is the product: everything in the UI is driven through the versioned v1 API, which is also usable from
  the CLI and CI (`.github/workflows/ci.yml` runs real browser journeys on every push).
