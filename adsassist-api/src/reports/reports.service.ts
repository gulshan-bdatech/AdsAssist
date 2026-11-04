import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { escapeRegex } from '../common/dto.js';
import { addDays, dayInZone, DayRange, eachDay, previousRange, rangeToInstants } from '../common/utils/dates.js';
import { addCounts, BaseCounts, emptyCounts, round, Totals, withRatios } from '../common/utils/metrics.js';
import { Ad, AdGroup, Campaign, CampaignDoc, MetricDaily, MetricLevel } from '../database/schemas/ads.schema.js';
import { AdAccount, AdAccountDoc, Platform } from '../database/schemas/integration.schema.js';
import { ConversionPush, Lead } from '../database/schemas/leads.schema.js';
import { WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { LeadsService } from '../leads/leads.service.js';
import { TrackingService } from '../tracking/tracking.service.js';

export interface ReportFilter {
  platform?: Platform;
  adAccountId?: string;
}

interface MetricAgg {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

interface LeadAgg {
  leads: number;
  wonLeads: number;
  revenue: number;
}

const metricSums = {
  spend: { $sum: '$spend' },
  impressions: { $sum: '$impressions' },
  clicks: { $sum: '$clicks' },
  conversions: { $sum: '$conversions' },
  conversionValue: { $sum: '$conversionValue' },
};

const toCounts = (m?: Partial<MetricAgg>, l?: Partial<LeadAgg>): BaseCounts =>
  addCounts(emptyCounts(), { ...(m ?? {}), ...(l ?? {}) });

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(MetricDaily.name) private readonly metrics: Model<MetricDaily>,
    @InjectModel(Campaign.name) private readonly campaigns: Model<Campaign>,
    @InjectModel(AdGroup.name) private readonly adGroups: Model<AdGroup>,
    @InjectModel(Ad.name) private readonly ads: Model<Ad>,
    @InjectModel(AdAccount.name) private readonly adAccounts: Model<AdAccount>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(ConversionPush.name) private readonly pushes: Model<ConversionPush>,
    private readonly leadsService: LeadsService,
    private readonly tracking: TrackingService,
    private readonly config: ConfigService,
  ) {}

  // ── Building blocks ───────────────────────────────────────────────────────

  /** Accounts whose data is reported: everything not disconnected, narrowed by the filter. */
  private async accounts(ws: WorkspaceDoc, f: ReportFilter): Promise<AdAccountDoc[]> {
    const q: Record<string, unknown> = { workspaceId: ws._id, status: { $ne: 'disconnected' } };
    if (f.platform) q.platform = f.platform;
    if (f.adAccountId && isValidObjectId(f.adAccountId)) q._id = new Types.ObjectId(f.adAccountId);
    return this.adAccounts.find(q);
  }

  private metricMatch(ws: WorkspaceDoc, accounts: AdAccountDoc[], range: DayRange, level: MetricLevel = 'campaign', extra: Record<string, unknown> = {}) {
    return {
      workspaceId: ws._id,
      adAccountId: { $in: accounts.map((a) => a._id) },
      level,
      date: { $gte: range.from, $lte: range.to },
      ...extra,
    };
  }

  /** Leads are a cohort: created in the range, counted as won if they are in a won stage now. */
  private leadMatch(ws: WorkspaceDoc, range: DayRange, f: ReportFilter, extra: Record<string, unknown> = {}) {
    const { start, end } = rangeToInstants(range, ws.timezone);
    const m: Record<string, unknown> = { workspaceId: ws._id, createdAt: { $gte: start, $lt: end }, ...extra };
    if (f.platform) m.channel = f.platform;
    if (f.adAccountId && isValidObjectId(f.adAccountId)) m.adAccountId = new Types.ObjectId(f.adAccountId);
    return m;
  }

  private leadGroup(ws: WorkspaceDoc, key: unknown) {
    const won = ws.pipeline.filter((s) => s.kind === 'won').map((s) => s.key);
    return {
      $group: {
        _id: key,
        leads: { $sum: 1 },
        wonLeads: { $sum: { $cond: [{ $in: ['$stage', won] }, 1, 0] } },
        revenue: { $sum: { $cond: [{ $in: ['$stage', won] }, { $ifNull: ['$value', 0] }, 0] } },
      },
    };
  }

  private async totals(ws: WorkspaceDoc, accounts: AdAccountDoc[], range: DayRange, f: ReportFilter): Promise<Totals> {
    const [[m], [l]] = await Promise.all([
      this.metrics.aggregate<MetricAgg>([{ $match: this.metricMatch(ws, accounts, range) }, { $group: { _id: null, ...metricSums } }]),
      this.leads.aggregate<LeadAgg>([{ $match: this.leadMatch(ws, range, f) }, this.leadGroup(ws, null)]),
    ]);
    return withRatios(toCounts(m, l));
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async overview(ws: WorkspaceDoc, range: DayRange, f: ReportFilter) {
    const accounts = await this.accounts(ws, f);
    const prev = previousRange(range);
    const tz = ws.timezone;
    const [totals, previous, byPlatformMetrics, byPlatformLeads, dailyMetrics, dailyLeads, funnel, campaigns] = await Promise.all([
      this.totals(ws, accounts, range, f),
      this.totals(ws, accounts, prev, f),
      this.metrics.aggregate<MetricAgg & { _id: Platform }>([
        { $match: this.metricMatch(ws, accounts, range) },
        { $group: { _id: '$platform', ...metricSums } },
      ]),
      this.leads.aggregate<LeadAgg & { _id: string }>([{ $match: this.leadMatch(ws, range, f) }, this.leadGroup(ws, '$channel')]),
      this.metrics.aggregate<MetricAgg & { _id: { date: string; platform: Platform } }>([
        { $match: this.metricMatch(ws, accounts, range) },
        { $group: { _id: { date: '$date', platform: '$platform' }, ...metricSums } },
      ]),
      this.leads.aggregate<LeadAgg & { _id: string }>([
        { $match: this.leadMatch(ws, range, f) },
        this.leadGroup(ws, { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: tz } }),
      ]),
      this.funnel(ws, range, f),
      this.campaignRows(ws, range, f, {}),
    ]);

    const platforms: Platform[] = f.platform ? [f.platform] : ['google', 'meta'];
    const byPlatform = platforms.map((p) => ({
      platform: p,
      ...withRatios(toCounts(byPlatformMetrics.find((r) => r._id === p), byPlatformLeads.find((r) => r._id === p))),
    }));

    const timeseries = eachDay(range.from, range.to).map((date) => {
      const rows = dailyMetrics.filter((r) => r._id.date === date);
      const sum = (k: keyof MetricAgg) => round(rows.reduce((s, r) => s + r[k], 0));
      const l = dailyLeads.find((r) => r._id === date);
      return {
        date,
        spend: sum('spend'),
        impressions: sum('impressions'),
        clicks: sum('clicks'),
        conversions: sum('conversions'),
        leads: l?.leads ?? 0,
        wonLeads: l?.wonLeads ?? 0,
        googleSpend: round(rows.find((r) => r._id.platform === 'google')?.spend ?? 0),
        metaSpend: round(rows.find((r) => r._id.platform === 'meta')?.spend ?? 0),
      };
    });

    return {
      range,
      previousRange: prev,
      currency: ws.currency,
      lastSyncedAt: this.lastSynced(accounts),
      totals,
      previous,
      byPlatform,
      timeseries,
      funnel,
      topCampaigns: [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5),
    };
  }

  private lastSynced(accounts: AdAccountDoc[]): Date | null {
    const times = accounts.map((a) => a.lastSyncedAt?.getTime() ?? 0).filter(Boolean);
    return times.length ? new Date(Math.max(...times)) : null;
  }

  /** How many leads from the range reached each stage at any point (from stage history). */
  private async funnel(ws: WorkspaceDoc, range: DayRange, f: ReportFilter) {
    const rows = await this.leads.aggregate<{ _id: string; n: number }>([
      { $match: this.leadMatch(ws, range, f) },
      { $project: { stages: { $setUnion: ['$history.stage', ['$stage']] } } },
      { $unwind: '$stages' },
      { $group: { _id: '$stages', n: { $sum: 1 } } },
    ]);
    const counts = new Map(rows.map((r) => [r._id, r.n]));
    const stages = [...ws.pipeline].sort((a, b) => a.order - b.order);
    const total = await this.leads.countDocuments(this.leadMatch(ws, range, f));
    return stages.map((s, i) => ({ key: s.key, label: s.label, kind: s.kind, count: i === 0 ? total : (counts.get(s.key) ?? 0) }));
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────

  private campaignView(c: CampaignDoc, accountName: string, counts: BaseCounts) {
    return {
      id: c.id as string,
      platform: c.platform,
      externalId: c.externalId,
      name: c.name,
      status: c.status,
      rawStatus: c.rawStatus,
      adAccountId: String(c.adAccountId),
      adAccountName: accountName,
      objective: c.objective,
      dailyBudget: c.dailyBudget,
      ...withRatios(counts),
    };
  }

  async campaignRows(ws: WorkspaceDoc, range: DayRange, f: ReportFilter, q: { status?: string; search?: string }) {
    const accounts = await this.accounts(ws, f);
    const campaignFilter: Record<string, unknown> = { workspaceId: ws._id, adAccountId: { $in: accounts.map((a) => a._id) } };
    if (q.status && q.status !== 'all') campaignFilter.status = q.status;
    if (q.search?.trim()) campaignFilter.name = new RegExp(escapeRegex(q.search.trim()), 'i');
    const [campaigns, metricRows, leadRows] = await Promise.all([
      this.campaigns.find(campaignFilter),
      this.metrics.aggregate<MetricAgg & { _id: { a: Types.ObjectId; c: string } }>([
        { $match: this.metricMatch(ws, accounts, range) },
        { $group: { _id: { a: '$adAccountId', c: '$campaignExternalId' }, ...metricSums } },
      ]),
      this.leads.aggregate<LeadAgg & { _id: Types.ObjectId }>([
        { $match: this.leadMatch(ws, range, f, { campaignId: { $ne: null } }) },
        this.leadGroup(ws, '$campaignId'),
      ]),
    ]);
    const names = new Map(accounts.map((a) => [a.id as string, a.name]));
    const metricsBy = new Map(metricRows.map((r) => [`${r._id.a}:${r._id.c}`, r]));
    const leadsBy = new Map(leadRows.map((r) => [String(r._id), r]));
    return campaigns
      .map((c) =>
        this.campaignView(c, names.get(String(c.adAccountId)) ?? '', toCounts(metricsBy.get(`${c.adAccountId}:${c.externalId}`), leadsBy.get(c.id))),
      )
      // Default view: active campaigns plus anything that spent or produced leads in the range.
      .filter((r) => Boolean(q.status) || r.status === 'active' || r.spend > 0 || r.leads > 0)
      .sort((a, b) => b.spend - a.spend || b.leads - a.leads);
  }

  async campaignDetail(ws: WorkspaceDoc, id: string, range: DayRange) {
    const campaign = isValidObjectId(id) ? await this.campaigns.findOne({ _id: id, workspaceId: ws._id }) : null;
    if (!campaign) throw new NotFoundException('Campaign not found');
    const account = await this.adAccounts.findById(campaign.adAccountId);
    const accounts = account ? [account] : [];
    const byCampaign = { campaignExternalId: campaign.externalId };
    const leadExtra = { campaignId: campaign._id };
    const [daily, dailyLeads, totalsM, totalsL, groupMetrics, adMetrics, groups, ads, recent] = await Promise.all([
      this.metrics.aggregate<MetricAgg & { _id: string }>([
        { $match: this.metricMatch(ws, accounts, range, 'campaign', byCampaign) },
        { $group: { _id: '$date', ...metricSums } },
      ]),
      this.leads.aggregate<LeadAgg & { _id: string }>([
        { $match: this.leadMatch(ws, range, {}, leadExtra) },
        this.leadGroup(ws, { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: ws.timezone } }),
      ]),
      this.metrics.aggregate<MetricAgg>([
        { $match: this.metricMatch(ws, accounts, range, 'campaign', byCampaign) },
        { $group: { _id: null, ...metricSums } },
      ]),
      this.leads.aggregate<LeadAgg>([{ $match: this.leadMatch(ws, range, {}, leadExtra) }, this.leadGroup(ws, null)]),
      this.metrics.aggregate<MetricAgg & { _id: string }>([
        { $match: this.metricMatch(ws, accounts, range, 'ad_group', byCampaign) },
        { $group: { _id: '$entityExternalId', ...metricSums } },
      ]),
      this.metrics.aggregate<MetricAgg & { _id: string }>([
        { $match: this.metricMatch(ws, accounts, range, 'ad', byCampaign) },
        { $group: { _id: '$entityExternalId', ...metricSums } },
      ]),
      this.adGroups.find({ adAccountId: campaign.adAccountId, campaignExternalId: campaign.externalId }),
      this.ads.find({ adAccountId: campaign.adAccountId, campaignExternalId: campaign.externalId }),
      this.leads.find({ workspaceId: ws._id, campaignId: campaign._id }).sort({ createdAt: -1 }).limit(20),
    ]);
    const gm = new Map(groupMetrics.map((r) => [r._id, r]));
    const am = new Map(adMetrics.map((r) => [r._id, r]));
    return {
      campaign: this.campaignView(campaign, account?.name ?? '', toCounts(totalsM[0], totalsL[0])),
      timeseries: eachDay(range.from, range.to).map((date) => {
        const m = daily.find((r) => r._id === date);
        const l = dailyLeads.find((r) => r._id === date);
        return {
          date,
          spend: round(m?.spend ?? 0),
          impressions: m?.impressions ?? 0,
          clicks: m?.clicks ?? 0,
          conversions: round(m?.conversions ?? 0),
          leads: l?.leads ?? 0,
          wonLeads: l?.wonLeads ?? 0,
          googleSpend: campaign.platform === 'google' ? round(m?.spend ?? 0) : 0,
          metaSpend: campaign.platform === 'meta' ? round(m?.spend ?? 0) : 0,
        };
      }),
      adGroups: groups
        .map((g) => ({ id: g.id as string, externalId: g.externalId, name: g.name, status: g.status, ...withRatios(toCounts(gm.get(g.externalId))) }))
        .sort((a, b) => b.spend - a.spend),
      ads: ads
        .map((a) => ({
          id: a.id as string,
          externalId: a.externalId,
          adGroupExternalId: a.adGroupExternalId,
          name: a.name,
          status: a.status,
          headline: a.headline,
          body: a.body,
          imageUrl: a.imageUrl,
          finalUrl: a.finalUrl,
          ...withRatios(toCounts(am.get(a.externalId))),
        }))
        .sort((a, b) => b.spend - a.spend),
      recentLeads: await this.leadsService.view(ws, recent),
    };
  }

  // ── Live ──────────────────────────────────────────────────────────────────

  async live(ws: WorkspaceDoc) {
    const accounts = await this.accounts(ws, {});
    const today = dayInZone(new Date(), ws.timezone);
    const yesterday = addDays(today, -1);
    const todayRange = { from: today, to: today };
    const [t, y, campaigns, recentEvents] = await Promise.all([
      this.totals(ws, accounts, todayRange, {}),
      this.totals(ws, accounts, { from: yesterday, to: yesterday }, {}),
      this.campaignRows(ws, todayRange, {}, { status: 'active' }),
      this.tracking.recentEvents(ws._id, 20),
    ]);
    const lastSyncedAt = this.lastSynced(accounts);
    const interval = (this.config.get<number>('SYNC_INTERVAL_MINUTES') ?? 15) * 60_000;
    return {
      lastSyncedAt,
      nextSyncAt: lastSyncedAt ? new Date(lastSyncedAt.getTime() + interval) : null,
      today: t,
      yesterday: y,
      activeCampaigns: campaigns,
      recentEvents,
    };
  }

  // ── Insights ──────────────────────────────────────────────────────────────

  /**
   * Rule-based recommendations over the selected range. Thresholds are
   * relative to the workspace's own averages so they work at any budget.
   */
  async insights(ws: WorkspaceDoc, range: DayRange) {
    type Insight = {
      id: string;
      severity: 'critical' | 'warning' | 'info' | 'success';
      title: string;
      detail: string;
      campaignId?: string;
      platform?: Platform;
      metric?: string;
      value?: number | null;
      benchmark?: number | null;
    };
    const out: Insight[] = [];
    const fmt = (n: number | null | undefined) =>
      n == null ? '–' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: ws.currency, maximumFractionDigits: 0 }).format(n);

    const allAccounts = await this.adAccounts.find({ workspaceId: ws._id, status: { $ne: 'disconnected' } });
    if (!allAccounts.length) {
      out.push({
        id: 'no-accounts',
        severity: 'info',
        title: 'Connect Google Ads or Meta',
        detail: 'Live spend, clicks and campaign data appear once an ad account is connected under Integrations.',
      });
    }
    for (const a of allAccounts.filter((x) => x.status === 'error' || x.lastSyncStatus === 'failed')) {
      out.push({
        id: `sync-${a.id}`,
        severity: 'critical',
        title: `${a.platform === 'google' ? 'Google Ads' : 'Meta'} account "${a.name}" is not syncing`,
        detail: a.lastSyncError ?? 'The last sync failed. Reconnect the account under Integrations.',
        platform: a.platform,
      });
    }

    const rows = await this.campaignRows(ws, range, {}, { status: 'all' });
    const totals = rows.reduce((acc, r) => addCounts(acc, r), emptyCounts());
    const avg = withRatios(totals);
    const results = (r: Totals) => (r.leads > 0 ? r.leads : r.conversions);

    // What a lead normally costs, from campaigns that produced any. Including the
    // zero-result campaigns would inflate it and hide exactly the waste we look for.
    const producing = rows.filter((r) => results(r) > 0);
    const producingSpend = producing.reduce((s, r) => s + r.spend, 0);
    const producingResults = producing.reduce((s, r) => s + results(r), 0);
    const benchmarkCpl = producingResults ? producingSpend / producingResults : null;

    for (const r of rows) {
      const res = results(r);
      const wasteThreshold = benchmarkCpl ? benchmarkCpl * 2 : totals.spend * 0.2;
      if (r.spend > 0 && res === 0 && wasteThreshold > 0 && r.spend >= wasteThreshold) {
        out.push({
          id: `waste-${r.id}`,
          severity: 'critical',
          title: `"${r.name}" spent ${fmt(r.spend)} with no leads`,
          detail:
            `That is ${round((r.spend / Math.max(totals.spend, 1)) * 100)}% of total spend` +
            (benchmarkCpl ? `, enough for ~${Math.floor(r.spend / benchmarkCpl)} leads at your usual ${fmt(benchmarkCpl)} CPL` : '') +
            '. Check targeting, the landing page and that the pixel/conversion tracking fires.',
          campaignId: r.id,
          platform: r.platform,
          metric: 'spend',
          value: r.spend,
        });
      } else if (res >= 3 && benchmarkCpl && r.cpl && r.cpl > benchmarkCpl * 1.5) {
        out.push({
          id: `cpl-${r.id}`,
          severity: 'warning',
          title: `High cost per lead on "${r.name}"`,
          detail: `${fmt(r.cpl)} per lead vs ${fmt(benchmarkCpl)} average (${round(r.cpl / benchmarkCpl, 1)}×). Consider moving budget to better campaigns.`,
          campaignId: r.id,
          platform: r.platform,
          metric: 'cpl',
          value: r.cpl,
          benchmark: benchmarkCpl,
        });
      }
      if (r.impressions >= 1000 && avg.ctr && r.ctr != null && r.ctr < avg.ctr * 0.5) {
        out.push({
          id: `ctr-${r.id}`,
          severity: 'warning',
          title: `Low click-through rate on "${r.name}"`,
          detail: `CTR is ${r.ctr}% vs ${avg.ctr}% average. Refresh the creative or headline, or tighten the audience.`,
          campaignId: r.id,
          platform: r.platform,
          metric: 'ctr',
          value: r.ctr,
          benchmark: avg.ctr,
        });
      }
    }

    const scalable = rows.filter((r) => results(r) >= 5 && r.cpl != null && benchmarkCpl != null && r.cpl < benchmarkCpl * 0.7 && r.status === 'active');
    for (const r of scalable.sort((a, b) => (a.cpl ?? 0) - (b.cpl ?? 0)).slice(0, 3)) {
      out.push({
        id: `scale-${r.id}`,
        severity: 'success',
        title: `"${r.name}" is your most efficient campaign`,
        detail: `${fmt(r.cpl)} per lead, ${round((1 - r.cpl! / benchmarkCpl!) * 100)}% below average. A budget increase is likely to bring cheaper leads.`,
        campaignId: r.id,
        platform: r.platform,
        metric: 'cpl',
        value: r.cpl,
        benchmark: benchmarkCpl,
      });
    }

    const prevRows = await this.campaignRows(ws, previousRange(range), {}, { status: 'all' });
    const prev = withRatios(prevRows.reduce((acc, r) => addCounts(acc, r), emptyCounts()));
    if (prev.spend > 0 && avg.spend > prev.spend * 1.3 && results(avg) < results(prev)) {
      out.push({
        id: 'pop-efficiency',
        severity: 'warning',
        title: 'Spend went up but results went down',
        detail: `Spend rose ${round((avg.spend / prev.spend - 1) * 100)}% vs the previous period while leads fell from ${results(prev)} to ${results(avg)}.`,
        metric: 'spend',
        value: avg.spend,
        benchmark: prev.spend,
      });
    }

    const { start, end } = rangeToInstants(range, ws.timezone);
    const [leadCount, unattributed, failedPushes] = await Promise.all([
      this.leads.countDocuments({ workspaceId: ws._id, createdAt: { $gte: start, $lt: end } }),
      this.leads.countDocuments({ workspaceId: ws._id, createdAt: { $gte: start, $lt: end }, campaignId: null, channel: { $in: ['google', 'meta'] } }),
      this.pushes.countDocuments({ workspaceId: ws._id, status: 'failed', createdAt: { $gte: start, $lt: end } }),
    ]);
    if (leadCount >= 10 && unattributed / leadCount > 0.3) {
      out.push({
        id: 'attribution-gap',
        severity: 'info',
        title: `${round((unattributed / leadCount) * 100, 0)}% of paid leads aren't matched to a campaign`,
        detail: 'Add utm_id to your ad URLs ({campaignid} on Google, {{campaign.id}} on Meta) so every lead is credited to the exact campaign.',
      });
    }
    if (failedPushes > 0) {
      out.push({
        id: 'push-failures',
        severity: 'warning',
        title: `${failedPushes} conversion upload${failedPushes > 1 ? 's' : ''} failed`,
        detail: 'Google/Meta did not accept some conversions, so their bidding is missing those signals. See Conversions for the errors.',
      });
    }
    const order = { critical: 0, warning: 1, info: 2, success: 3 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }
}
