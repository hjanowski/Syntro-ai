# Journey definitions

A journey is a directed graph (`JourneyDefinition`): nodes with a `type` and `config`, edges between them, exactly one
`start`. Branch nodes have `yes`/`no` edges. Journeys are authored in the visual builder (React Flow) or as templates
(`engine/src/journeys/templates.ts`); the executor walks the graph per customer, evaluating branch conditions
deterministically from the run seed.

## Node types

| Type | Category | Config | Effect |
| --- | --- | --- | --- |
| `start`, `end` | logic | | |
| `email_open` | marketing | `campaignId, campaignName, subject, landingPath, utmCampaign` | Opens the simulated inbox (impression + `email_open` platform record). |
| `email_click` | marketing | same | Clicks the CTA → lands on the website with `utm_source=email…` → ground-truth touchpoint. |
| `ad_view` | marketing | `channel (meta/google/linkedin), campaignId, campaignName, creativeId, headline, landingPath, utmCampaign` | Views the ad in the simulated feed/SERP (impression). |
| `ad_click` | marketing | same | Clicks the ad → lands with UTMs + synthetic click id (`fbclid`/`gclid`/`li_fat_id`) → touchpoint + `ad_click` platform record. |
| `message_receive` / `message_click` | marketing | `channel (sms/whatsapp), campaignId, body, landingPath` | Simulated messaging thread; click lands on the website. |
| `enter_segment` | marketing | `segmentId, segmentName` | Records segment membership through the platform data adapter (no browser). |
| `visit_page` | website | `path` | Navigate to a store page. |
| `navigate` | website | `selector` or `path` | Click an on-page link or go to a path. |
| `search` | website | `query` | Site search. |
| `view_product` | website | `productId` | Product detail page (`view_item`). |
| `add_to_cart` | website | `productId, quantity` | Adds to cart (`add_to_cart`). |
| `view_cart` | website | | |
| `fill_form` | website | `formId: newsletter, value` | Newsletter signup → identify + `lead` conversion. |
| `register` | website | `value` | Creates an account → identify + `signup` conversion. |
| `login` | website | | Signs in → identify. |
| `checkout` | website | | Test checkout → identify + `purchase` conversion (order id, revenue). |
| `conversion_event` | website | `eventType, value` | Fires a custom conversion through the SDK. |
| `wait` | logic | `seconds, virtualHours, virtualDays` | Real pause and/or virtual clock advance (virtual waits start a new session). |
| `branch` | logic | `condition` | `customer_index_in`, `customer_index_mod`, `attribute_equals`, `probability`. |
| `change_device` | logic | `to` | New browser context (new cookies). |
| `new_session` | logic | | New session, same cookies. |
| `clear_cookies` | logic | | Cookie loss; new cookie jar. |
| `inject_failure` | logic | `fault` | Activates a tracking fault from this point (see below). |

## Scenario faults (`ScenarioFault`)

| Kind | Where it acts | What the validator should report |
| --- | --- | --- |
| `missing_utm` | ad/email destination URL | `missing_utm_parameters` (ad destination configuration) |
| `wrong_campaign_param` | destination URL | `campaign_parameter_mismatch` + `wrong_campaign_attribution` |
| `drop_events` | collector | `missing_touchpoint` / `lost_conversion_event` (event collector) |
| `duplicate_events` | collector | `duplicate_conversion` at tracking and (without SUT dedupe) attribution level |
| `delay_events` | collector → SUT delivery | `delayed_event`; attribution tests inconclusive |
| `suppress_identify` | website SDK | `identity_stitching_failure` (website SDK) |

System-under-test faults live in the project's SUT configuration: `identityResolution: cookie_only`, wrong
`lookbackDays`, missing click-id mappings, `faults.ignoreChannels`, `faults.misattributeCampaign`,
`dedupeConversionsByOrderId: false`.

## Templates and presets

Ten journey templates (`JOURNEY_TEMPLATES`) and thirteen scenario presets (`SCENARIO_PRESETS`) cover: multi-touch
purchase, cross-device login stitching, lookback expiry, LinkedIn with missing UTMs, duplicate / lost / delayed
purchases, cart abandon + SMS recovery, cookie loss, WhatsApp lead, wrong campaign parameter, suppressed identify,
registration + segment, and conditional branching. `DEMO_RUN_ASSIGNMENTS` defines the investor demo population.
