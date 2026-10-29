import type { CampaignConfig, Channel, ScenarioFault, ScenarioFaultKind } from '../domain/types.ts';
import { randomHex } from '../util/ids.ts';

/**
 * Simulated marketing environments are static pages under `${siteBaseUrl}/channels/`.
 * They are explicitly NOT the real platforms: they render a recognisable feed/inbox,
 * show the configured creative, and on click navigate the synthetic customer to the
 * instrumented website with the configured destination URL plus a synthetic click id.
 */
export interface ChannelMeta {
  label: string;
  page: string;
  clickIdParam?: string;
  defaultUtmSource: string;
  defaultUtmMedium: string;
  ctaSelector: string;
}

export const CHANNEL_META: Record<Channel, ChannelMeta> = {
  meta: { label: 'Meta Ads (simulated)', page: 'meta.html', clickIdParam: 'fbclid', defaultUtmSource: 'facebook', defaultUtmMedium: 'paid_social', ctaSelector: '#ad-cta' },
  google: { label: 'Google Ads (simulated)', page: 'google.html', clickIdParam: 'gclid', defaultUtmSource: 'google', defaultUtmMedium: 'cpc', ctaSelector: '#ad-cta' },
  linkedin: { label: 'LinkedIn Ads (simulated)', page: 'linkedin.html', clickIdParam: 'li_fat_id', defaultUtmSource: 'linkedin', defaultUtmMedium: 'paid_social', ctaSelector: '#ad-cta' },
  email: { label: 'Email (simulated inbox)', page: 'email.html', defaultUtmSource: 'email', defaultUtmMedium: 'email', ctaSelector: '#email-cta' },
  sms: { label: 'SMS (simulated)', page: 'messaging.html', defaultUtmSource: 'sms', defaultUtmMedium: 'sms', ctaSelector: '#message-cta' },
  whatsapp: { label: 'WhatsApp (simulated)', page: 'messaging.html', defaultUtmSource: 'whatsapp', defaultUtmMedium: 'messaging', ctaSelector: '#message-cta' },
  direct: { label: 'Direct', page: '', defaultUtmSource: '', defaultUtmMedium: '', ctaSelector: '' },
  referral: { label: 'Referral', page: '', defaultUtmSource: '', defaultUtmMedium: '', ctaSelector: '' },
  unknown: { label: 'Unknown', page: '', defaultUtmSource: '', defaultUtmMedium: '', ctaSelector: '' },
};

export function intendedUtm(campaign: CampaignConfig): Record<string, string> {
  const meta = CHANNEL_META[campaign.channel];
  const utm: Record<string, string> = {
    utm_source: campaign.utm?.source ?? meta.defaultUtmSource,
    utm_medium: campaign.utm?.medium ?? meta.defaultUtmMedium,
    utm_campaign: campaign.utm?.campaign ?? campaign.campaignId,
  };
  if (campaign.utm?.content ?? campaign.creativeId) utm.utm_content = campaign.utm?.content ?? campaign.creativeId!;
  if (campaign.utm?.term) utm.utm_term = campaign.utm.term;
  return utm;
}

export interface LandingUrlBuild {
  url: string;
  observedUtm: Record<string, string>;
  intendedUtm: Record<string, string>;
  faultApplied?: ScenarioFaultKind;
  clickId?: string;
  clickIdParam?: string;
}

/** Build the website destination URL exactly as the (possibly misconfigured) ad/email would carry it. */
export function buildLandingUrl(siteBaseUrl: string, campaign: CampaignConfig, token: string, faults: ScenarioFault[]): LandingUrlBuild {
  const base = siteBaseUrl.replace(/\/$/, '');
  const landingPath = campaign.landingPath ?? 'index.html';
  const url = new URL(`${base}/${landingPath.replace(/^\//, '')}`);
  const intended = intendedUtm(campaign);
  let observed: Record<string, string> = { ...intended };
  let faultApplied: ScenarioFaultKind | undefined;

  for (const fault of faults) {
    if (fault.kind === 'missing_utm' && fault.channel === campaign.channel) {
      observed = {};
      faultApplied = 'missing_utm';
    }
    if (fault.kind === 'wrong_campaign_param' && fault.channel === campaign.channel) {
      observed = { ...observed, utm_campaign: fault.campaignId };
      faultApplied = 'wrong_campaign_param';
    }
  }

  for (const [k, v] of Object.entries(observed)) url.searchParams.set(k, v);
  url.searchParams.set('syntro_token', token);

  const meta = CHANNEL_META[campaign.channel];
  const clickId = meta.clickIdParam ? `syn_${meta.clickIdParam}_${randomHex(8)}` : undefined;
  return { url: url.toString(), observedUtm: observed, intendedUtm: intended, faultApplied, clickId, clickIdParam: meta.clickIdParam };
}

export interface ChannelPageInput {
  siteBaseUrl: string;
  campaign: CampaignConfig;
  destination: LandingUrlBuild;
  customerFirstName: string;
  /** For messaging channels: sms | whatsapp */
  messagingChannel?: 'sms' | 'whatsapp';
}

/** URL of the simulated channel page that renders the ad / email / message. */
export function buildChannelPageUrl(input: ChannelPageInput): string {
  const base = input.siteBaseUrl.replace(/\/$/, '');
  const meta = CHANNEL_META[input.campaign.channel];
  const url = new URL(`${base}/channels/${meta.page}`);
  url.searchParams.set('campaign_id', input.campaign.campaignId);
  url.searchParams.set('campaign_name', input.campaign.campaignName ?? input.campaign.campaignId);
  if (input.campaign.creativeId) url.searchParams.set('creative_id', input.campaign.creativeId);
  if (input.campaign.adsetId) url.searchParams.set('adset_id', input.campaign.adsetId);
  if (input.campaign.headline) url.searchParams.set('headline', input.campaign.headline);
  if (input.campaign.body) url.searchParams.set('body', input.campaign.body);
  if (input.campaign.subject) url.searchParams.set('subject', input.campaign.subject);
  url.searchParams.set('dest', input.destination.url);
  if (input.destination.clickId && input.destination.clickIdParam) {
    url.searchParams.set('click_param', input.destination.clickIdParam);
    url.searchParams.set('click_id', input.destination.clickId);
  }
  url.searchParams.set('customer', input.customerFirstName);
  if (input.messagingChannel) url.searchParams.set('channel', input.messagingChannel);
  return url.toString();
}

export function storeUrl(siteBaseUrl: string, path: string, token?: string): string {
  const base = siteBaseUrl.replace(/\/$/, '');
  const url = new URL(`${base}/${path.replace(/^\//, '')}`);
  if (token) url.searchParams.set('syntro_token', token);
  return url.toString();
}

export function extractTrackingParams(urlString: string): { utm: Record<string, string>; clickIds: Record<string, string> } {
  const utm: Record<string, string> = {};
  const clickIds: Record<string, string> = {};
  try {
    const url = new URL(urlString);
    url.searchParams.forEach((value, key) => {
      if (key.startsWith('utm_')) utm[key] = value;
      if (['fbclid', 'gclid', 'li_fat_id', 'msclkid', 'ttclid'].includes(key)) clickIds[key] = value;
    });
  } catch {
    /* ignore */
  }
  return { utm, clickIds };
}
