/** Additive counters that every report row carries. */
export interface BaseCounts {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  leads: number;
  wonLeads: number;
  revenue: number;
}

export interface Totals extends BaseCounts {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  cpa: number | null;
  roas: number | null;
  conversionRate: number | null;
}

export const emptyCounts = (): BaseCounts => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  conversionValue: 0,
  leads: 0,
  wonLeads: 0,
  revenue: 0,
});

const ratio = (a: number, b: number, scale = 1): number | null => (b > 0 ? round((a / b) * scale) : null);

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Derived ratios. CPL and CPA use our own lead pipeline (leads / won leads)
 * when it has data, and fall back to platform-reported conversions otherwise,
 * so a workspace without the pixel still sees a cost per result.
 */
export function withRatios(c: BaseCounts): Totals {
  const leadsBase = c.leads > 0 ? c.leads : c.conversions;
  const wonBase = c.wonLeads > 0 ? c.wonLeads : c.conversions;
  const revenue = c.revenue > 0 ? c.revenue : c.conversionValue;
  return {
    spend: round(c.spend),
    impressions: c.impressions,
    clicks: c.clicks,
    conversions: round(c.conversions),
    conversionValue: round(c.conversionValue),
    leads: c.leads,
    wonLeads: c.wonLeads,
    revenue: round(c.revenue),
    ctr: ratio(c.clicks, c.impressions, 100),
    cpc: ratio(c.spend, c.clicks),
    cpm: ratio(c.spend, c.impressions, 1000),
    cpl: ratio(c.spend, leadsBase),
    cpa: ratio(c.spend, wonBase),
    roas: ratio(revenue, c.spend),
    conversionRate: ratio(c.leads > 0 ? c.leads : c.conversions, c.clicks, 100),
  };
}

export function addCounts(into: BaseCounts, from: Partial<BaseCounts>): BaseCounts {
  for (const k of Object.keys(into) as (keyof BaseCounts)[]) into[k] += from[k] ?? 0;
  return into;
}
