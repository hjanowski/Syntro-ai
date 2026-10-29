import type { NodeCategory, NodeType } from '../domain/types.ts';
import { NODE_CATEGORY } from '../domain/types.ts';

/**
 * Catalog of journey node types: labels, descriptions, defaults and editable fields.
 * Consumed by the executor (defaults) and the visual journey builder (palette + config panel).
 */
export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'json';
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
}

export interface NodeSpec {
  type: NodeType;
  label: string;
  description: string;
  category: NodeCategory;
  defaults: Record<string, unknown>;
  fields: FieldSpec[];
}

const AD_FIELDS: FieldSpec[] = [
  {
    key: 'channel',
    label: 'Simulated platform',
    type: 'select',
    options: [
      { value: 'meta', label: 'Meta Ads (simulated)' },
      { value: 'google', label: 'Google Ads (simulated)' },
      { value: 'linkedin', label: 'LinkedIn Ads (simulated)' },
    ],
  },
  { key: 'campaignId', label: 'Campaign ID', type: 'text', placeholder: 'fb_retargeting_q2' },
  { key: 'campaignName', label: 'Campaign name', type: 'text' },
  { key: 'creativeId', label: 'Creative ID', type: 'text' },
  { key: 'headline', label: 'Ad headline', type: 'text' },
  { key: 'landingPath', label: 'Landing page', type: 'text', placeholder: 'product.html?id=trail-jacket', help: 'Path on the instrumented website' },
  { key: 'utmCampaign', label: 'utm_campaign override', type: 'text', help: 'Defaults to the campaign ID' },
];

const EMAIL_FIELDS: FieldSpec[] = [
  { key: 'campaignId', label: 'Campaign ID', type: 'text', placeholder: 'em_spring_launch' },
  { key: 'campaignName', label: 'Campaign name', type: 'text' },
  { key: 'subject', label: 'Subject line', type: 'text' },
  { key: 'landingPath', label: 'Landing page', type: 'text', placeholder: 'index.html' },
  { key: 'utmCampaign', label: 'utm_campaign override', type: 'text' },
];

const MESSAGE_FIELDS: FieldSpec[] = [
  {
    key: 'channel',
    label: 'Channel',
    type: 'select',
    options: [
      { value: 'sms', label: 'SMS (simulated)' },
      { value: 'whatsapp', label: 'WhatsApp (simulated)' },
    ],
  },
  { key: 'campaignId', label: 'Campaign ID', type: 'text' },
  { key: 'campaignName', label: 'Campaign name', type: 'text' },
  { key: 'body', label: 'Message text', type: 'text' },
  { key: 'landingPath', label: 'Landing page', type: 'text' },
];

export const NODE_CATALOG: Record<NodeType, NodeSpec> = {
  start: { type: 'start', label: 'Start', description: 'Journey entry point.', category: 'logic', defaults: {}, fields: [] },
  email_open: {
    type: 'email_open',
    label: 'Open email',
    description: 'The customer receives and opens a marketing email in the simulated inbox.',
    category: 'marketing',
    defaults: { campaignId: 'em_spring_launch', campaignName: 'Spring Launch Newsletter', subject: 'Your trail season starts here', landingPath: 'index.html' },
    fields: EMAIL_FIELDS,
  },
  email_click: {
    type: 'email_click',
    label: 'Click email link',
    description: 'The customer clicks the email call-to-action and lands on the website with campaign parameters.',
    category: 'marketing',
    defaults: { campaignId: 'em_spring_launch', campaignName: 'Spring Launch Newsletter', subject: 'Your trail season starts here', landingPath: 'index.html' },
    fields: EMAIL_FIELDS,
  },
  ad_view: {
    type: 'ad_view',
    label: 'View ad',
    description: 'The customer sees the ad in a simulated platform feed (impression only).',
    category: 'marketing',
    defaults: { channel: 'meta', campaignId: 'fb_retargeting_q2', campaignName: 'Retargeting — Cart Reminder', creativeId: 'fb_carousel_03', landingPath: 'cart.html' },
    fields: AD_FIELDS,
  },
  ad_click: {
    type: 'ad_click',
    label: 'Click ad',
    description: 'The customer clicks the ad and lands on the website with UTM parameters and a synthetic click id.',
    category: 'marketing',
    defaults: { channel: 'google', campaignId: 'g_brand_search', campaignName: 'Brand Search — Trail Jacket', creativeId: 'g_rsa_01', landingPath: 'product.html?id=trail-jacket' },
    fields: AD_FIELDS,
  },
  message_receive: {
    type: 'message_receive',
    label: 'Receive message',
    description: 'The customer receives a simulated SMS or WhatsApp message.',
    category: 'marketing',
    defaults: { channel: 'sms', campaignId: 'sms_cart_recovery', campaignName: 'Cart Recovery SMS', body: 'Still thinking it over? Your cart is waiting.', landingPath: 'cart.html' },
    fields: MESSAGE_FIELDS,
  },
  message_click: {
    type: 'message_click',
    label: 'Click message link',
    description: 'The customer taps the message link and lands on the website.',
    category: 'marketing',
    defaults: { channel: 'sms', campaignId: 'sms_cart_recovery', campaignName: 'Cart Recovery SMS', body: 'Still thinking it over? Your cart is waiting.', landingPath: 'cart.html' },
    fields: MESSAGE_FIELDS,
  },
  enter_segment: {
    type: 'enter_segment',
    label: 'Enter segment',
    description: 'The customer is added to a marketing segment (recorded via the synthetic platform data adapter).',
    category: 'marketing',
    defaults: { segmentId: 'seg_high_intent', segmentName: 'High intent' },
    fields: [
      { key: 'segmentId', label: 'Segment ID', type: 'text' },
      { key: 'segmentName', label: 'Segment name', type: 'text' },
    ],
  },
  visit_page: {
    type: 'visit_page',
    label: 'Visit page',
    description: 'Navigate directly to a page on the website.',
    category: 'website',
    defaults: { path: 'index.html' },
    fields: [{ key: 'path', label: 'Path', type: 'text', placeholder: 'index.html' }],
  },
  navigate: {
    type: 'navigate',
    label: 'Navigate',
    description: 'Click an on-page link (CSS selector) or go to a path.',
    category: 'website',
    defaults: { selector: '[data-nav="products"]' },
    fields: [
      { key: 'selector', label: 'Link selector', type: 'text' },
      { key: 'path', label: 'or path', type: 'text' },
    ],
  },
  search: {
    type: 'search',
    label: 'Search products',
    description: 'Use the site search.',
    category: 'website',
    defaults: { query: 'jacket' },
    fields: [{ key: 'query', label: 'Query', type: 'text' }],
  },
  view_product: {
    type: 'view_product',
    label: 'View product',
    description: 'Open a product detail page.',
    category: 'website',
    defaults: { productId: 'trail-jacket' },
    fields: [{ key: 'productId', label: 'Product ID', type: 'text', help: 'trail-jacket, summit-pack, ember-bottle, ridge-boots, aurora-tent, basecamp-hoodie' }],
  },
  add_to_cart: {
    type: 'add_to_cart',
    label: 'Add to cart',
    description: 'Add a product to the cart.',
    category: 'website',
    defaults: { productId: 'trail-jacket', quantity: 1 },
    fields: [
      { key: 'productId', label: 'Product ID', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
    ],
  },
  view_cart: { type: 'view_cart', label: 'View cart', description: 'Open the cart page.', category: 'website', defaults: {}, fields: [] },
  fill_form: {
    type: 'fill_form',
    label: 'Complete form',
    description: 'Submit a lead form (newsletter signup) using the synthetic identity.',
    category: 'website',
    defaults: { formId: 'newsletter', value: 25 },
    fields: [
      { key: 'formId', label: 'Form', type: 'select', options: [{ value: 'newsletter', label: 'Newsletter signup' }] },
      { key: 'value', label: 'Lead value', type: 'number' },
    ],
  },
  register: {
    type: 'register',
    label: 'Register account',
    description: 'Create an account with the synthetic email (identifies the customer).',
    category: 'website',
    defaults: { value: 0 },
    fields: [{ key: 'value', label: 'Signup value', type: 'number' }],
  },
  login: { type: 'login', label: 'Log in', description: 'Authenticate with the synthetic email (identifies the customer).', category: 'website', defaults: {}, fields: [] },
  checkout: {
    type: 'checkout',
    label: 'Test checkout',
    description: 'Complete the test checkout. No payment is processed; the order is flagged as a test order.',
    category: 'website',
    defaults: {},
    fields: [],
  },
  conversion_event: {
    type: 'conversion_event',
    label: 'Custom conversion',
    description: 'Fire a custom conversion event through the website SDK.',
    category: 'website',
    defaults: { eventType: 'quote_request', value: 50 },
    fields: [
      { key: 'eventType', label: 'Event type', type: 'text' },
      { key: 'value', label: 'Value', type: 'number' },
    ],
  },
  wait: {
    type: 'wait',
    label: 'Wait',
    description: 'Pause in real time and/or advance the virtual clock (new session starts).',
    category: 'logic',
    defaults: { seconds: 0, virtualHours: 0, virtualDays: 0 },
    fields: [
      { key: 'seconds', label: 'Real seconds', type: 'number' },
      { key: 'virtualHours', label: 'Virtual hours', type: 'number' },
      { key: 'virtualDays', label: 'Virtual days', type: 'number', help: 'Advances event timestamps without waiting' },
    ],
  },
  branch: {
    type: 'branch',
    label: 'Branch',
    description: 'Conditional split: connect a "yes" and a "no" edge.',
    category: 'logic',
    defaults: { condition: { kind: 'customer_index_mod', mod: 2, equals: 0 } },
    fields: [{ key: 'condition', label: 'Condition', type: 'json', help: '{"kind":"customer_index_mod","mod":2,"equals":0} | {"kind":"probability","p":0.5} | {"kind":"customer_index_in","values":[1]}' }],
  },
  change_device: {
    type: 'change_device',
    label: 'Change device',
    description: 'Continue on a different device: new browser context, new cookies.',
    category: 'logic',
    defaults: { to: 'mobile' },
    fields: [
      {
        key: 'to',
        label: 'Device',
        type: 'select',
        options: [
          { value: 'mobile', label: 'Mobile' },
          { value: 'desktop', label: 'Desktop' },
          { value: 'tablet', label: 'Tablet' },
        ],
      },
    ],
  },
  new_session: { type: 'new_session', label: 'New session', description: 'Start a new visit with the same cookies.', category: 'logic', defaults: {}, fields: [] },
  clear_cookies: { type: 'clear_cookies', label: 'Clear cookies', description: 'Simulate cookie loss: first-party identity is reset.', category: 'logic', defaults: {}, fields: [] },
  inject_failure: {
    type: 'inject_failure',
    label: 'Inject failure',
    description: 'Activate a tracking fault from this point on.',
    category: 'logic',
    defaults: { fault: { kind: 'drop_events', eventTypes: ['purchase'] } },
    fields: [{ key: 'fault', label: 'Fault', type: 'json', help: '{"kind":"drop_events","eventTypes":["purchase"]}' }],
  },
  end: { type: 'end', label: 'End', description: 'Journey ends.', category: 'logic', defaults: {}, fields: [] },
};

export const NODE_TYPES = Object.keys(NODE_CATALOG) as NodeType[];

export function nodeSpec(type: NodeType): NodeSpec {
  return NODE_CATALOG[type];
}

export function nodeCategory(type: NodeType): NodeCategory {
  return NODE_CATEGORY[type];
}

export function describeNode(type: NodeType, config: Record<string, unknown>): string {
  const c = config as Record<string, string | number | undefined>;
  switch (type) {
    case 'email_open':
      return `Open "${c.subject ?? c.campaignName ?? c.campaignId}"`;
    case 'email_click':
      return `Click email · ${c.campaignId}`;
    case 'ad_view':
      return `View ${c.channel} ad · ${c.campaignId}`;
    case 'ad_click':
      return `Click ${c.channel} ad · ${c.campaignId}`;
    case 'message_receive':
      return `Receive ${c.channel} · ${c.campaignId}`;
    case 'message_click':
      return `Click ${c.channel} link · ${c.campaignId}`;
    case 'enter_segment':
      return `Enter segment ${c.segmentId}`;
    case 'visit_page':
      return `Visit ${c.path}`;
    case 'navigate':
      return c.path ? `Go to ${c.path}` : `Click ${c.selector}`;
    case 'search':
      return `Search "${c.query}"`;
    case 'view_product':
      return `View product ${c.productId}`;
    case 'add_to_cart':
      return `Add ${c.quantity ?? 1} × ${c.productId ?? 'current product'}`;
    case 'fill_form':
      return `Submit ${c.formId} form`;
    case 'conversion_event':
      return `Fire ${c.eventType} (${c.value})`;
    case 'wait': {
      const parts = [];
      if (c.seconds) parts.push(`${c.seconds}s`);
      if (c.virtualHours) parts.push(`${c.virtualHours}h virtual`);
      if (c.virtualDays) parts.push(`${c.virtualDays}d virtual`);
      return `Wait ${parts.join(' + ') || '0s'}`;
    }
    case 'change_device':
      return `Switch to ${c.to}`;
    case 'inject_failure':
      return `Inject ${(config.fault as { kind?: string } | undefined)?.kind ?? 'fault'}`;
    default:
      return NODE_CATALOG[type].label;
  }
}
