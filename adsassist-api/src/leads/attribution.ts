import type { Channel, Touch, Utm } from '../database/schemas/tracking.schema.js';

export interface TouchSignals {
  gclid?: string | null;
  fbclid?: string | null;
  fbp?: string | null;
  utm?: Utm;
  referrer?: string | null;
  landingPage?: string | null;
}

const GOOGLE_SOURCES = /^(google|adwords|gads|google_ads|googleads|youtube|gdn)$/i;
const META_SOURCES = /^(facebook|fb|fb_ads|facebook_ads|meta|instagram|ig|an|audience_network|messenger)$/i;

/**
 * Which ad platform a visit came from. Click ids win over UTMs because they
 * are added by the platform itself; UTMs are hand-written and inconsistent.
 */
export function channelOf(s: TouchSignals): Channel {
  if (s.gclid) return 'google';
  if (s.fbclid) return 'meta';
  const src = (s.utm?.source ?? '').trim();
  if (src) {
    if (GOOGLE_SOURCES.test(src)) return 'google';
    if (META_SOURCES.test(src)) return 'meta';
    return 'other';
  }
  return 'organic';
}

export const hasAdSignal = (s: TouchSignals) => Boolean(s.gclid || s.fbclid || s.utm?.source || s.utm?.campaign || s.utm?.id);

export function toTouch(s: TouchSignals, at = new Date()): Touch {
  return {
    channel: channelOf(s),
    source: s.utm?.source,
    medium: s.utm?.medium,
    campaign: s.utm?.campaign,
    campaignId: s.utm?.id,
    gclid: s.gclid ?? undefined,
    fbclid: s.fbclid ?? undefined,
    fbp: s.fbp ?? undefined,
    landingPage: s.landingPage ?? undefined,
    at,
  };
}

/** Meta's fbc cookie format, rebuilt from a stored fbclid. */
export const formatFbc = (fbclid: string, at: Date) => `fb.1.${at.getTime()}.${fbclid}`;
