import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { addDays, dayInZone, DayRange } from '../common/utils/dates.js';
import { AiSummary } from '../database/schemas/growth.schema.js';
import { WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { ReportsService } from '../reports/reports.service.js';
import { NotificationsService } from './notifications.service.js';

const SummarySchema = z.object({
  markdown: z.string().describe('The report in Markdown: a short overview paragraph, then sections with ### headings.'),
  highlights: z.array(z.string()).describe('3 to 6 one-line takeaways with the key numbers.'),
  actions: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        campaignId: z.string().nullable().describe('The campaign "id" from the data when the action is about one campaign, else null.'),
        priority: z.enum(['high', 'medium', 'low']),
      }),
    )
    .describe('Up to 6 concrete next steps, most impactful first.'),
});

const SYSTEM = `You are a senior performance-marketing analyst writing a weekly report for an advertiser who runs Google Ads and Meta campaigns.
You get JSON with the period's totals, the previous period for comparison, per-platform and per-campaign numbers, the lead funnel, and automated insights.

Write for a busy business owner: plain language, concrete numbers in the given currency, and the "so what" for each point.
Ground every claim in the data you were given. Do not invent numbers, campaigns or causes; when the data can't explain something, say what to check.
"leads" and "wonLeads" are the advertiser's own CRM pipeline; "conversions" are what the ad platforms report. CPL and ROAS can be null when there is no data.
Recommend actions an advertiser can take this week (shift budget, pause, scale, fix tracking, refresh creative, follow up leads). Reference campaigns by name.`;

/** Weekly AI summaries with Claude, built from the same numbers as the dashboard. */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;
  readonly model: string;

  constructor(
    config: ConfigService,
    @InjectModel(AiSummary.name) private readonly summaries: Model<AiSummary>,
    private readonly reports: ReportsService,
    private readonly notifications: NotificationsService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 180_000 }) : null;
    this.model = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
  }

  get configured() {
    return this.client !== null;
  }

  defaultRange(ws: WorkspaceDoc): DayRange {
    const yesterday = addDays(dayInZone(new Date(), ws.timezone), -1);
    return { from: addDays(yesterday, -6), to: yesterday };
  }

  private async context(ws: WorkspaceDoc, range: DayRange) {
    const [overview, campaigns, insights] = await Promise.all([
      this.reports.overview(ws, range, {}),
      this.reports.campaignRows(ws, range, {}, { status: 'all' }),
      this.reports.insights(ws, range),
    ]);
    const pick = (c: (typeof campaigns)[number]) => ({
      id: c.id,
      name: c.name,
      platform: c.platform,
      status: c.status,
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      cpc: c.cpc,
      conversions: c.conversions,
      leads: c.leads,
      wonLeads: c.wonLeads,
      revenue: c.revenue,
      cpl: c.cpl,
      roas: c.roas,
    });
    return {
      workspace: ws.name,
      currency: ws.currency,
      period: range,
      previousPeriod: overview.previousRange,
      totals: overview.totals,
      previousTotals: overview.previous,
      byPlatform: overview.byPlatform,
      funnel: overview.funnel,
      campaigns: campaigns.slice(0, 40).map(pick),
      insights: insights.map((i) => ({ severity: i.severity, title: i.title, detail: i.detail })),
    };
  }

  async generate(ws: WorkspaceDoc, range: DayRange, userId: string | null) {
    if (!this.client) throw new ServiceUnavailableException('AI summaries are not configured. Set ANTHROPIC_API_KEY on the API.');
    const data = await this.context(ws, range);
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      // A declined request is retried server-side on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(SummarySchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Write the report for ${range.from} to ${range.to}.\n\n<data>\n${JSON.stringify(data)}\n</data>`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') {
      throw new ServiceUnavailableException('The AI model declined to write this summary. Try a different date range.');
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      this.logger.error(`AI summary could not be parsed (stop_reason=${response.stop_reason})`);
      throw new ServiceUnavailableException('The AI summary came back incomplete. Please try again.');
    }
    // Only keep campaign links that point at real campaigns.
    const ids = new Set(data.campaigns.map((c) => c.id));
    const doc = await this.summaries.create({
      workspaceId: ws._id,
      from: range.from,
      to: range.to,
      markdown: parsed.markdown,
      highlights: parsed.highlights.slice(0, 8),
      actions: parsed.actions.slice(0, 8).map((a) => ({ ...a, campaignId: a.campaignId && ids.has(a.campaignId) ? a.campaignId : null })),
      model: response.model,
      createdBy: userId ? new Types.ObjectId(userId) : null,
    });
    await this.notifications.create(ws._id, {
      kind: 'ai_summary',
      severity: 'info',
      title: `AI summary ready for ${range.from} – ${range.to}`,
      body: parsed.highlights[0] ?? '',
      link: `/w/${ws.id}/ai`,
    });
    return this.view(doc);
  }

  view(d: InstanceType<Model<AiSummary>>) {
    return {
      id: d.id as string,
      range: { from: d.from, to: d.to },
      markdown: d.markdown,
      highlights: d.highlights,
      actions: d.actions,
      model: d.model,
      createdAt: d.createdAt,
    };
  }

  async list(workspaceId: Types.ObjectId) {
    return (await this.summaries.find({ workspaceId }).sort({ createdAt: -1 }).limit(20)).map((d) => this.view(d));
  }
}
