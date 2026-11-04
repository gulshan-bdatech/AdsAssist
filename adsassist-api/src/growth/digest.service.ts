import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { escapeHtml, MailerService } from '../common/mailer/mailer.module.js';
import { ReportSettings } from '../database/schemas/growth.schema.js';
import { Workspace, WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { ReportsService } from '../reports/reports.service.js';
import { AiService } from './ai.service.js';

export interface ReportSettingsInput {
  weeklyDigest: boolean;
  digestRecipients: string[];
  digestDay: number;
  aiInDigest: boolean;
}

/** Hour of the digest day (workspace time) after which the weekly email goes out. */
const DIGEST_HOUR = 9;

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    @InjectModel(ReportSettings.name) private readonly settings: Model<ReportSettings>,
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
    private readonly reports: ReportsService,
    private readonly ai: AiService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  private view(s: Partial<ReportSettings> | null) {
    return {
      weeklyDigest: s?.weeklyDigest ?? false,
      digestRecipients: s?.digestRecipients ?? [],
      digestDay: s?.digestDay ?? 1,
      aiInDigest: s?.aiInDigest ?? true,
    };
  }

  async get(workspaceId: Types.ObjectId) {
    return this.view(await this.settings.findOne({ workspaceId }));
  }

  async put(workspaceId: Types.ObjectId, input: ReportSettingsInput) {
    const doc = await this.settings.findOneAndUpdate(
      { workspaceId },
      { $set: { ...input, digestRecipients: input.digestRecipients.map((e) => e.toLowerCase().trim()) } },
      { upsert: true, returnDocument: 'after' },
    );
    return this.view(doc);
  }

  /** Hourly: send each due workspace its weekly digest once. */
  async tick() {
    const due = await this.settings.find({ weeklyDigest: true, 'digestRecipients.0': { $exists: true } });
    let sent = 0;
    for (const s of due) {
      if (s.lastDigestAt && Date.now() - s.lastDigestAt.getTime() < 6 * 86_400_000) continue;
      const ws = await this.workspaces.findById(s.workspaceId);
      if (!ws) continue;
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: ws.timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
      const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
      const hour = Number(parts.find((p) => p.type === 'hour')!.value);
      if (weekday !== s.digestDay || hour < DIGEST_HOUR) continue;
      // Mark first so a slow AI call can't cause a duplicate send on the next tick.
      s.lastDigestAt = new Date();
      await s.save();
      try {
        if (await this.send(ws, s.digestRecipients, s.aiInDigest)) sent++;
      } catch (e) {
        this.logger.error(`Digest for ${ws.name} failed: ${(e as Error).message}`);
      }
    }
    return { sent };
  }

  private async send(ws: WorkspaceDoc, recipients: string[], withAi: boolean) {
    const range = this.ai.defaultRange(ws);
    const [overview, insights] = await Promise.all([this.reports.overview(ws, range, {}), this.reports.insights(ws, range)]);
    const t = overview.totals;
    const p = overview.previous;
    const money = (n: number | null) =>
      n == null ? '–' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: ws.currency, maximumFractionDigits: 0 }).format(n);
    const delta = (a: number | null, b: number | null) => (a == null || !b ? '' : ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%)`);
    const rows: [string, string][] = [
      ['Spend', money(t.spend) + delta(t.spend, p.spend)],
      ['Leads', `${t.leads}${delta(t.leads, p.leads)}`],
      ['Cost per lead', money(t.cpl) + delta(t.cpl, p.cpl)],
      ['Won', `${t.wonLeads}${delta(t.wonLeads, p.wonLeads)}`],
      ['Revenue', money(t.revenue) + delta(t.revenue, p.revenue)],
      ['ROAS', t.roas == null ? '–' : `${t.roas}x`],
    ];
    let aiHtml = '';
    let aiText = '';
    if (withAi && this.ai.configured) {
      try {
        const summary = await this.ai.generate(ws, range, null);
        aiHtml = `<h3>AI summary</h3><ul>${summary.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`;
        aiText = `\nAI summary:\n${summary.highlights.map((h) => `- ${h}`).join('\n')}\n`;
      } catch (e) {
        this.logger.warn(`AI part of digest skipped: ${(e as Error).message}`);
      }
    }
    const top = overview.topCampaigns.slice(0, 5);
    const link = `${this.config.get('WEB_URL')}/w/${ws.id}/dashboard?from=${range.from}&to=${range.to}`;
    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px">
<h2>${escapeHtml(ws.name)} · ${range.from} – ${range.to}</h2>
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#666">${k}</td><td><b>${escapeHtml(v)}</b></td></tr>`).join('')}</table>
${aiHtml}
<h3>Top campaigns</h3><ul>${top.map((c) => `<li>${escapeHtml(c.name)}: ${money(c.spend)}, ${c.leads} leads, CPL ${money(c.cpl)}</li>`).join('')}</ul>
${insights.length ? `<h3>Needs attention</h3><ul>${insights.slice(0, 5).map((i) => `<li><b>${escapeHtml(i.title)}</b><br>${escapeHtml(i.detail)}</li>`).join('')}</ul>` : ''}
<p><a href="${link}">Open the dashboard</a></p></div>`;
    const text = `${ws.name} · ${range.from} – ${range.to}\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n${aiText}\nTop campaigns:\n${top
      .map((c) => `- ${c.name}: ${money(c.spend)}, ${c.leads} leads`)
      .join('\n')}\n\n${link}`;
    return this.mailer.send(recipients, `[AdsAssist] Weekly report · ${ws.name}`, html, text);
  }
}
