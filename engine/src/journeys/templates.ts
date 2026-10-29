import type { JourneyDefinition, JourneyEdge, JourneyNode, NodeType, ScenarioFault } from '../domain/types.ts';
import { randomId } from '../util/ids.ts';
import { nowIso } from '../util/time.ts';

/** Demo campaigns configured across the simulated channels. */
export const DEMO_CAMPAIGNS = {
  email: { campaignId: 'em_spring_launch', campaignName: 'Spring Launch Newsletter', subject: 'Your trail season starts here', landingPath: 'index.html' },
  google: { channel: 'google', campaignId: 'g_brand_search', campaignName: 'Brand Search — Trail Jacket', creativeId: 'g_rsa_01', headline: 'Trail Runner Jacket — Free Returns', landingPath: 'product.html?id=trail-jacket' },
  meta: { channel: 'meta', campaignId: 'fb_retargeting_q2', campaignName: 'Retargeting — Cart Reminder', creativeId: 'fb_carousel_03', headline: 'Your Trail Runner Jacket is waiting', landingPath: 'cart.html' },
  metaProspecting: { channel: 'meta', campaignId: 'fb_prospecting_spring', campaignName: 'Prospecting — Spring Collection', creativeId: 'fb_video_01', headline: 'Built for the ridge line', landingPath: 'product.html?id=trail-jacket' },
  linkedin: { channel: 'linkedin', campaignId: 'li_abm_q4', campaignName: 'ABM — Outdoor Teams', creativeId: 'li_sponsored_02', headline: 'Outfit your field team', landingPath: 'product.html?id=trail-jacket' },
  sms: { channel: 'sms', campaignId: 'sms_cart_recovery', campaignName: 'Cart Recovery SMS', body: 'Still thinking it over? Your Trail Runner Jacket is waiting in your cart.', landingPath: 'cart.html' },
  whatsapp: { channel: 'whatsapp', campaignId: 'wa_vip_promo', campaignName: 'WhatsApp VIP Promo', body: 'VIP early access: the Spring Collection is live. Join the newsletter for 10% off.', landingPath: 'index.html' },
} as const;

export const DEMO_PRODUCTS = [
  { id: 'trail-jacket', name: 'Trail Runner Jacket', price: 120 },
  { id: 'summit-pack', name: 'Summit Daypack', price: 85 },
  { id: 'ember-bottle', name: 'Ember Insulated Bottle', price: 28 },
  { id: 'ridge-boots', name: 'Ridge Hiking Boots', price: 160 },
  { id: 'aurora-tent', name: 'Aurora 2P Tent', price: 340 },
  { id: 'basecamp-hoodie', name: 'Basecamp Hoodie', price: 64 },
] as const;

type Step = [NodeType, Record<string, unknown>?, string?];

function chain(steps: Step[], opts: { startX?: number; y?: number; gap?: number } = {}): { nodes: JourneyNode[]; edges: JourneyEdge[] } {
  const nodes: JourneyNode[] = [];
  const edges: JourneyEdge[] = [];
  const startX = opts.startX ?? 40;
  const y = opts.y ?? 160;
  const gap = opts.gap ?? 230;
  steps.forEach(([type, config, label], i) => {
    const id = `n${i + 1}`;
    nodes.push({ id, type, label, config: config ?? {}, position: { x: startX + i * gap, y } });
    if (i > 0) edges.push({ id: `e${i}`, source: `n${i}`, target: id });
  });
  return { nodes, edges };
}

export interface JourneyTemplate {
  key: string;
  name: string;
  description: string;
  tags: string[];
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}

const C = DEMO_CAMPAIGNS;

export const JOURNEY_TEMPLATES: JourneyTemplate[] = [
  {
    key: 'email_google_meta_purchase',
    name: 'Email → Google Ads → Meta Ads → Purchase',
    description: 'Multi-touch purchase in a single browser: newsletter click, branded search ad, retargeting ad, $120 test checkout.',
    tags: ['multi-touch', 'purchase', 'demo'],
    ...chain([
      ['start'],
      ['email_open', { ...C.email }],
      ['email_click', { ...C.email }],
      ['view_product', { productId: 'trail-jacket' }],
      ['ad_view', { ...C.google }],
      ['ad_click', { ...C.google }],
      ['add_to_cart', { productId: 'trail-jacket', quantity: 1 }],
      ['ad_view', { ...C.meta }],
      ['ad_click', { ...C.meta }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'cross_device_purchase',
    name: 'Cross-device purchase (login stitching)',
    description: 'Email, Google and Meta touches on a logged-in desktop; the customer then logs in on mobile and buys. Correct attribution requires identity stitching.',
    tags: ['cross-device', 'identity', 'purchase', 'demo'],
    ...chain([
      ['start'],
      ['email_click', { ...C.email }],
      ['visit_page', { path: 'account.html' }],
      ['login'],
      ['view_product', { productId: 'trail-jacket' }],
      ['ad_click', { ...C.google }],
      ['ad_click', { ...C.meta }],
      ['change_device', { to: 'mobile' }],
      ['visit_page', { path: 'account.html' }],
      ['login'],
      ['view_product', { productId: 'trail-jacket' }],
      ['add_to_cart', { productId: 'trail-jacket', quantity: 1 }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'lookback_expiry',
    name: 'Lookback window expiry',
    description: 'Meta prospecting click, then a direct return visit 45 virtual days later. With a 30-day lookback the purchase should be direct.',
    tags: ['lookback', 'purchase'],
    ...chain([
      ['start'],
      ['ad_click', { ...C.metaProspecting }],
      ['view_product', { productId: 'summit-pack' }],
      ['wait', { virtualDays: 45 }],
      ['visit_page', { path: 'index.html' }],
      ['view_product', { productId: 'summit-pack' }],
      ['add_to_cart', { productId: 'summit-pack', quantity: 1 }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'linkedin_purchase',
    name: 'LinkedIn ad → Purchase',
    description: 'Single-touch LinkedIn sponsored content click leading to a $160 test checkout.',
    tags: ['single-touch', 'linkedin', 'purchase'],
    ...chain([
      ['start'],
      ['ad_view', { ...C.linkedin, landingPath: 'product.html?id=ridge-boots' }],
      ['ad_click', { ...C.linkedin, landingPath: 'product.html?id=ridge-boots' }],
      ['add_to_cart', { productId: 'ridge-boots', quantity: 1 }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'google_search_purchase',
    name: 'Google Ads → Purchase',
    description: 'Branded search click straight to the product page and a test checkout.',
    tags: ['single-touch', 'google', 'purchase'],
    ...chain([
      ['start'],
      ['ad_click', { ...C.google }],
      ['add_to_cart', { productId: 'trail-jacket', quantity: 1 }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'cart_abandon_sms_recovery',
    name: 'Cart abandon → SMS recovery',
    description: 'Email click, add to cart, leave; 20 virtual hours later an SMS reminder brings the customer back to complete checkout.',
    tags: ['multi-touch', 'sms', 'multi-session', 'purchase'],
    ...chain([
      ['start'],
      ['email_click', { ...C.email }],
      ['view_product', { productId: 'trail-jacket' }],
      ['add_to_cart', { productId: 'trail-jacket', quantity: 1 }],
      ['wait', { virtualHours: 20 }],
      ['message_receive', { ...C.sms }],
      ['message_click', { ...C.sms }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'cookie_loss_purchase',
    name: 'Cookie loss before purchase',
    description: 'Meta click, cookies cleared, purchase without logging in. The Meta touch becomes unlinkable by design — the expected result is direct.',
    tags: ['identity', 'cookie-loss', 'purchase'],
    ...chain([
      ['start'],
      ['ad_click', { ...C.metaProspecting }],
      ['view_product', { productId: 'trail-jacket' }],
      ['clear_cookies'],
      ['visit_page', { path: 'product.html?id=trail-jacket' }],
      ['add_to_cart', { productId: 'trail-jacket', quantity: 1 }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'whatsapp_newsletter_lead',
    name: 'WhatsApp promo → Newsletter lead',
    description: 'WhatsApp message click followed by a newsletter signup (lead conversion, $25 value).',
    tags: ['single-touch', 'whatsapp', 'lead'],
    ...chain([
      ['start'],
      ['message_receive', { ...C.whatsapp }],
      ['message_click', { ...C.whatsapp }],
      ['fill_form', { formId: 'newsletter', value: 25 }],
      ['end'],
    ]),
  },
  {
    key: 'registered_browse_segment',
    name: 'Register → Segment → Google → Purchase',
    description: 'Account registration, entry into a high-intent segment, Google ad click and purchase. Exercises registration and segment adapters.',
    tags: ['identity', 'segment', 'purchase'],
    ...chain([
      ['start'],
      ['visit_page', { path: 'index.html' }],
      ['search', { query: 'tent' }],
      ['view_product', { productId: 'aurora-tent' }],
      ['register', { value: 0 }],
      ['enter_segment', { segmentId: 'seg_high_intent', segmentName: 'High intent' }],
      ['ad_click', { ...C.google, landingPath: 'product.html?id=aurora-tent' }],
      ['add_to_cart', { productId: 'aurora-tent', quantity: 1 }],
      ['checkout'],
      ['end'],
    ]),
  },
  {
    key: 'branching_meta_or_google',
    name: 'Branch: Meta or Google → Purchase',
    description: 'Even-indexed customers click a Meta ad, odd-indexed customers click a Google ad, then everyone buys the same product.',
    tags: ['branch', 'purchase'],
    nodes: [
      { id: 'n1', type: 'start', config: {}, position: { x: 40, y: 160 } },
      { id: 'n2', type: 'branch', config: { condition: { kind: 'customer_index_mod', mod: 2, equals: 0 } }, position: { x: 270, y: 160 } },
      { id: 'n3', type: 'ad_click', config: { ...C.metaProspecting }, position: { x: 500, y: 40 } },
      { id: 'n4', type: 'ad_click', config: { ...C.google }, position: { x: 500, y: 280 } },
      { id: 'n5', type: 'add_to_cart', config: { productId: 'trail-jacket', quantity: 1 }, position: { x: 730, y: 160 } },
      { id: 'n6', type: 'checkout', config: {}, position: { x: 960, y: 160 } },
      { id: 'n7', type: 'end', config: {}, position: { x: 1190, y: 160 } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', condition: 'yes', label: 'even' },
      { id: 'e3', source: 'n2', target: 'n4', condition: 'no', label: 'odd' },
      { id: 'e4', source: 'n3', target: 'n5' },
      { id: 'e5', source: 'n4', target: 'n5' },
      { id: 'e6', source: 'n5', target: 'n6' },
      { id: 'e7', source: 'n6', target: 'n7' },
    ],
  },
  {
    key: 'preflight',
    name: 'Preflight check',
    description: 'Internal: single page view and product view to verify synthetic routing and production isolation.',
    tags: ['internal'],
    ...chain([
      ['start'],
      ['visit_page', { path: 'index.html' }],
      ['view_product', { productId: 'ember-bottle' }],
      ['end'],
    ]),
  },
];

export function getTemplate(key: string): JourneyTemplate | undefined {
  return JOURNEY_TEMPLATES.find((t) => t.key === key);
}

export function instantiateTemplate(template: JourneyTemplate, projectId: string | null): JourneyDefinition {
  const ts = nowIso();
  return {
    id: randomId('jrn'),
    projectId,
    name: template.name,
    description: template.description,
    version: 1,
    nodes: template.nodes.map((n) => ({ ...n, config: { ...n.config } })),
    edges: template.edges.map((e) => ({ ...e })),
    tags: [...template.tags],
    isTemplate: false,
    templateKey: template.key,
    createdAt: ts,
    updatedAt: ts,
  };
}

export interface ScenarioPreset {
  key: string;
  name: string;
  description: string;
  journeyTemplateKey: string;
  faults: ScenarioFault[];
  defaultCustomerCount: number;
  tags: string[];
}

/** Preconfigured scenarios for common attribution testing workflows. */
export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    key: 'happy_path_multitouch',
    name: 'Happy path — Email → Google → Meta → Purchase',
    description: 'Baseline multi-touch purchase. Every touchpoint should be captured and attributed.',
    journeyTemplateKey: 'email_google_meta_purchase',
    faults: [],
    defaultCustomerCount: 9,
    tags: ['baseline', 'demo'],
  },
  {
    key: 'cross_device_login',
    name: 'Cross-device purchase with login',
    description: 'Attribution is only correct if the attribution system stitches the desktop and mobile identities via the login.',
    journeyTemplateKey: 'cross_device_purchase',
    faults: [],
    defaultCustomerCount: 1,
    tags: ['identity', 'demo'],
  },
  {
    key: 'lookback_expiry',
    name: 'Lookback window expiry',
    description: 'A 45-day-old Meta click must not receive credit under a 30-day lookback.',
    journeyTemplateKey: 'lookback_expiry',
    faults: [],
    defaultCustomerCount: 2,
    tags: ['lookback'],
  },
  {
    key: 'linkedin_missing_utm',
    name: 'LinkedIn ad with missing UTM parameters',
    description: 'The LinkedIn destination URL was built without UTMs. Only the click id survives.',
    journeyTemplateKey: 'linkedin_purchase',
    faults: [{ kind: 'missing_utm', channel: 'linkedin' }],
    defaultCustomerCount: 2,
    tags: ['utm', 'fault'],
  },
  {
    key: 'duplicate_purchase_events',
    name: 'Duplicate purchase events',
    description: 'The purchase tag fires twice for the same order.',
    journeyTemplateKey: 'google_search_purchase',
    faults: [{ kind: 'duplicate_events', eventTypes: ['purchase'] }],
    defaultCustomerCount: 2,
    tags: ['conversion', 'fault'],
  },
  {
    key: 'lost_purchase_event',
    name: 'Lost purchase event',
    description: 'The purchase event never reaches the data pipeline.',
    journeyTemplateKey: 'google_search_purchase',
    faults: [{ kind: 'drop_events', eventTypes: ['purchase'] }],
    defaultCustomerCount: 1,
    tags: ['conversion', 'fault'],
  },
  {
    key: 'cart_abandon_sms',
    name: 'Cart abandon → SMS recovery',
    description: 'Multi-session journey where the SMS reminder should be the last touch.',
    journeyTemplateKey: 'cart_abandon_sms_recovery',
    faults: [],
    defaultCustomerCount: 2,
    tags: ['sms', 'multi-session'],
  },
  {
    key: 'cookie_loss',
    name: 'Cookie loss before purchase',
    description: 'Demonstrates the difference between an executed touchpoint and a linkable one.',
    journeyTemplateKey: 'cookie_loss_purchase',
    faults: [],
    defaultCustomerCount: 1,
    tags: ['identity'],
  },
  {
    key: 'whatsapp_lead',
    name: 'WhatsApp promo → newsletter lead',
    description: 'Lead conversion attributed to a messaging channel.',
    journeyTemplateKey: 'whatsapp_newsletter_lead',
    faults: [],
    defaultCustomerCount: 1,
    tags: ['whatsapp', 'lead'],
  },
  {
    key: 'wrong_campaign_param',
    name: 'Wrong campaign parameter on Google ad',
    description: 'The ad destination carries an outdated utm_campaign value.',
    journeyTemplateKey: 'google_search_purchase',
    faults: [{ kind: 'wrong_campaign_param', channel: 'google', campaignId: 'g_brand_search_OLD' }],
    defaultCustomerCount: 1,
    tags: ['utm', 'fault'],
  },
  {
    key: 'delayed_purchase_event',
    name: 'Delayed purchase event',
    description: 'The purchase event arrives six hours late — after attribution has been computed.',
    journeyTemplateKey: 'google_search_purchase',
    faults: [{ kind: 'delay_events', eventTypes: ['purchase'], delayMs: 6 * 60 * 60 * 1000 }],
    defaultCustomerCount: 1,
    tags: ['conversion', 'fault'],
  },
  {
    key: 'suppressed_identify',
    name: 'SDK never sends identify',
    description: 'Cross-device journey where the website SDK is misconfigured and never identifies the user.',
    journeyTemplateKey: 'cross_device_purchase',
    faults: [{ kind: 'suppress_identify' }],
    defaultCustomerCount: 1,
    tags: ['identity', 'fault'],
  },
  {
    key: 'register_segment_purchase',
    name: 'Register → segment → Google → purchase',
    description: 'Registration, segment entry and a purchase attributed to Google.',
    journeyTemplateKey: 'registered_browse_segment',
    faults: [],
    defaultCustomerCount: 1,
    tags: ['identity', 'segment'],
  },
  {
    key: 'branching',
    name: 'Branching: Meta or Google',
    description: 'Conditional journey — half the population converts via Meta, half via Google.',
    journeyTemplateKey: 'branching_meta_or_google',
    faults: [],
    defaultCustomerCount: 2,
    tags: ['branch'],
  },
];

/** The investor demo run: 9 happy-path customers plus 1 cross-device customer. */
export const DEMO_RUN_ASSIGNMENTS: { presetKey: string; customerCount: number }[] = [
  { presetKey: 'happy_path_multitouch', customerCount: 9 },
  { presetKey: 'cross_device_login', customerCount: 1 },
];
