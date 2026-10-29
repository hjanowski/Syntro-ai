# Integrations — what is real, simulated, prototype, or not implemented

| Component | Status | Notes |
| --- | --- | --- |
| Browser execution — Playwright (Node host) | **Functional** | Real headless Chromium, one isolated `BrowserContext` per synthetic customer, UA/viewport/touch emulation, JPEG screenshots as evidence. |
| Browser execution — sandboxed iframes (browser host) | **Functional** | Used by the GitHub Pages demo. Opaque-origin frames give per-customer storage isolation; device characteristics are declared via the token rather than emulated; DOM snapshots instead of screenshots. Browsers that refuse to load subresources into opaque frames from local/private hosts (Chromium local-network access policy when the app itself runs on `localhost`) are detected by a runtime probe; the driver then falls back to same-origin frames whose state the harness confines to each frame's `window.name` (isolation by convention rather than enforcement — reported in Settings). |
| Website SDK `sdk/syntro.js` | **Functional** | Signed-token session identification, anonymous id (cookie/storage), page/track/identify, dedupe, preflight(), data-layer flag. Does not block third-party tags by itself. |
| Google Tag Manager | **Prototype** | Recipe and container template (`sdk/gtm/`). Not verified against a live container. |
| Isolated test data collector | **Functional** | `/v1/collect` (HTTP) or postMessage (browser host). Verifies HMAC signatures, binds events to run/customer/session, applies tracking-path faults, logs accept/drop/dup/delay. |
| Preflight verification | **Functional (demo store)** | Executes a synthetic session and checks token acceptance, run binding and production isolation. For external sites the isolation check is inconclusive unless the site exposes the same guard. |
| Test checkout | **Functional (demo store)** | Flagged test orders; no payment, fulfilment or revenue. External sites require `testCheckoutAuthorized`. |
| Demo e-commerce website | **Functional** | `sites/store/` — Aurora Supply Co. |
| Simulated Meta / Google / LinkedIn / email / SMS / WhatsApp | **Simulated** | Mock environments reproducing click-through behaviour and synthetic click ids (`syn_fbclid_…`, `syn_gclid_…`, `syn_li_fat_id_…`). They do not reproduce genuine platform identifiers or APIs. |
| Synthetic source-platform data adapter | **Functional** | Emits approved synthetic `ad_click`, `ad_impression`, `email_open`, `message_delivery`, `segment_membership` records for test ingestion (`PlatformRecord`). The SUT can optionally join click ids against them. |
| Ground truth ledger | **Functional** | Independent of the attribution system; intended vs executed vs observed are kept distinct. |
| Reference attribution model | **Functional** | First-touch, last-touch, linear, configurable lookback; computed from ground truth only. |
| Local attribution system under test | **Functional** | Separate implementation over attribution-facing events; configurable identity resolution, lookback, dedupe, click-id and utm_source mappings, platform-record joins, deliberate faults. |
| Generic attribution adapter — file | **Prototype** | Contract implemented; results document supplied manually. |
| Generic attribution adapter — HTTP | **Prototype** | Contract implemented; not verified against any vendor. |
| Salesforce / Adobe adapters | **Not implemented** | Planned on top of the HTTP contract. |
| Validation & diagnostics engine | **Functional** | 15 failure types, 9 suspected points of failure, evidence and recommended steps. |
| Persistence | **Prototype** | JSON files (Node) / localStorage (browser) behind a `Store` interface; PostgreSQL is the production path. |
| Multi-tenancy, auth, LLM agents | **Not implemented** | Architecture leaves room: `BrowserDriver` can be backed by an LLM-navigating agent; scenario generation and diagnosis are natural LLM extension points. |

## Installing the SDK on an external website

```html
<script src="https://<syntro-host>/sdk/syntro.js" data-syntro-collector="auto"></script>
```

- Load it **before** production analytics tags (GTM: Initialization – All Pages).
- Ordinary visitors: no token ⇒ nothing is sent, `syntro.isSynthetic()` is `false`.
- Synthetic customers arrive with `?syntro_token=…` on the landing URL; the SDK stores it, strips it from the address
  bar where allowed, and keeps it across navigation.
- Use `syntro.isSynthetic()` / the `syntro_synthetic` data-layer variable as an **exception trigger** on GA4, pixels,
  CDP and attribution tags. **Syntro cannot block tags it does not control**; verify with the preflight and never
  assume production isolation for a configuration that has not passed it.
- Point the project at the site (`website.kind = external`, `baseUrl`) and authorize the test checkout before running
  conversion scenarios. Journeys use the demo store's selectors; external sites need journey nodes adjusted to their
  DOM (a dedicated external-site journey template is Phase 4 work).

## Synthetic contact data safety

- Emails: `first.last.N@synthetic.syntro.invalid` — `.invalid` is reserved by RFC 2606 and never resolves.
- Phones: `+1 555 01xx` — reserved for fictional use.
- User agents carry a `Syntro-Synthetic/1.0` marker.
