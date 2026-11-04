import { describe, expect, it } from 'vitest';
import { channelOf, formatFbc } from '../../leads/attribution.js';
import { addDays, previousRange, rangeToInstants, resolveRange } from './dates.js';
import { googlePhoneHash, metaPhoneHash, normalizeEmail, normalizePhone, sha256 } from './identity.js';
import { withRatios } from './metrics.js';

describe('normalizePhone', () => {
  it('adds the default country code to national numbers', () => {
    expect(normalizePhone('98765 43210', '91')).toBe('919876543210');
    expect(normalizePhone('098765-43210', '91')).toBe('919876543210');
  });
  it('keeps explicit international numbers', () => {
    expect(normalizePhone('+91 98765 43210', '1')).toBe('919876543210');
    expect(normalizePhone('0091 9876543210', '1')).toBe('919876543210');
    expect(normalizePhone('+1 (415) 555-0100', '91')).toBe('14155550100');
  });
  it('keeps numbers that already carry the country code without "+"', () => {
    expect(normalizePhone('919876543210', '91')).toBe('919876543210');
  });
  it('rejects junk', () => {
    expect(normalizePhone('12', '91')).toBeNull();
    expect(normalizePhone('', '91')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('hashing', () => {
  it('normalises email before hashing', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
  it('uses the platform-specific phone formats', () => {
    expect(metaPhoneHash('919876543210')).toBe(sha256('919876543210'));
    expect(googlePhoneHash('919876543210')).toBe(sha256('+919876543210'));
  });
});

describe('dates', () => {
  it('defaults to the last 30 days inclusive', () => {
    const r = resolveRange(undefined, '2026-03-31', 'UTC');
    expect(r).toEqual({ from: '2026-03-02', to: '2026-03-31' });
  });
  it('computes the previous period of equal length', () => {
    expect(previousRange({ from: '2026-03-08', to: '2026-03-14' })).toEqual({ from: '2026-03-01', to: '2026-03-07' });
  });
  it('maps a day range to UTC instants in the workspace zone', () => {
    const { start, end } = rangeToInstants({ from: '2026-03-01', to: '2026-03-01' }, 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-02-28T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-03-01T18:30:00.000Z');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
  it('rejects inverted ranges', () => {
    expect(() => resolveRange('2026-03-02', '2026-03-01', 'UTC')).toThrow();
  });
});

describe('withRatios', () => {
  it('derives ratios and returns null for zero divisors', () => {
    const t = withRatios({ spend: 1000, impressions: 50_000, clicks: 500, conversions: 0, conversionValue: 0, leads: 20, wonLeads: 2, revenue: 5000 });
    expect(t.ctr).toBe(1);
    expect(t.cpc).toBe(2);
    expect(t.cpl).toBe(50);
    expect(t.cpa).toBe(500);
    expect(t.roas).toBe(5);
    const empty = withRatios({ spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, leads: 0, wonLeads: 0, revenue: 0 });
    expect(empty.ctr).toBeNull();
    expect(empty.cpl).toBeNull();
  });
  it('falls back to platform conversions when there are no pipeline leads', () => {
    const t = withRatios({ spend: 300, impressions: 0, clicks: 0, conversions: 3, conversionValue: 0, leads: 0, wonLeads: 0, revenue: 0 });
    expect(t.cpl).toBe(100);
  });
});

describe('attribution', () => {
  it('prefers click ids over UTMs', () => {
    expect(channelOf({ gclid: 'abc', utm: { source: 'facebook' } })).toBe('google');
    expect(channelOf({ fbclid: 'x' })).toBe('meta');
  });
  it('maps common utm_source spellings', () => {
    expect(channelOf({ utm: { source: 'Fb_Ads' } })).toBe('meta');
    expect(channelOf({ utm: { source: 'google' } })).toBe('google');
    expect(channelOf({ utm: { source: 'newsletter' } })).toBe('other');
    expect(channelOf({})).toBe('organic');
  });
  it('builds the fbc value', () => {
    expect(formatFbc('IwAR', new Date(1_700_000_000_000))).toBe('fb.1.1700000000000.IwAR');
  });
});
