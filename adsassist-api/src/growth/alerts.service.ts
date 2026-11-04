import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { EventsBus } from '../common/events/events.module.js';
import { escapeHtml, MailerService } from '../common/mailer/mailer.module.js';
import { addDays, dayInZone, DayRange } from '../common/utils/dates.js';
import type { Totals } from '../common/utils/metrics.js';
import { Campaign } from '../database/schemas/ads.schema.js';
import { AlertMetric, AlertRule, AlertRuleDoc, AlertWindow } from '../database/schemas/growth.schema.js';
import type { Platform } from '../database/schemas/integration.schema.js';
import { Workspace, WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { ReportsService } from '../reports/reports.service.js';
import { NotificationsService } from './notifications.service.js';

export interface AlertInput {
  name: string;
  metric: AlertMetric;
  operator: 'gt' | 'lt';
  threshold: number;
  window: AlertWindow;
  platform?: Platform | null;
  campaignId?: string | null;
  recipients?: string[];
  notifyInApp?: boolean;
  active?: boolean;
  cooldownHours?: number;
}

const METRIC: Record<AlertMetric, { label: string; pick: (t: Totals) => number | null; money: boolean; pct?: boolean }> = {
  spend: { label: 'Spend', pick: (t) => t.spend, money: true },
  leads: { label: 'Leads', pick: (t) => t.leads, money: false },
  won_leads: { label: 'Won leads', pick: (t) => t.wonLeads, money: false },
  cpl: { label: 'Cost per lead', pick: (t) => t.cpl, money: true },
  cpc: { label: 'Cost per click', pick: (t) => t.cpc, money: true },
  ctr: { label: 'CTR', pick: (t) => t.ctr, money: false, pct: true },
  conversions: { label: 'Platform conversions', pick: (t) => t.conversions, money: false },
  roas: { label: 'ROAS', pick: (t) => t.roas, money: false },
};

const WINDOW_LABEL: Record<AlertWindow, string> = { today: 'today', yesterday: 'yesterday', last_7_days: 'in the last 7 days' };

/**
 * Threshold alerts on live metrics. Evaluated every 15 minutes; a rule fires
 * at most once per cooldown, by email (when SMTP is set up), in-app, and as
 * an `alert.triggered` webhook.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectModel(AlertRule.name) private readonly rules: Model<AlertRule>,
    @InjectModel(Campaign.name) private readonly campaigns: Model<Campaign>,
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
    private readonly reports: ReportsService,
    private readonly notifications: NotificationsService,
    private readonly mailer: MailerService,
    private readonly bus: EventsBus,
  ) {}

  private async view(workspaceId: Types.ObjectId, rules: AlertRuleDoc[]) {
    const ids = rules.map((r) => r.campaignId).filter(Boolean);
    const names = new Map((await this.campaigns.find({ _id: { $in: ids }, workspaceId }, { name: 1 })).map((c) => [c.id as string, c.name]));
    return rules.map((r) => ({
      ...r.toJSON(),
      campaignId: r.campaignId ? String(r.campaignId) : null,
      campaignName: r.campaignId ? (names.get(String(r.campaignId)) ?? null) : null,
    }));
  }

  async list(workspaceId: Types.ObjectId) {
    return this.view(workspaceId, await this.rules.find({ workspaceId }).sort({ createdAt: -1 }));
  }

  private async campaignRef(workspaceId: Types.ObjectId, campaignId?: string | null) {
    if (!campaignId) return null;
    if (!isValidObjectId(campaignId) || !(await this.campaigns.exists({ _id: campaignId, workspaceId }))) {
      throw new BadRequestException('campaignId does not belong to this workspace');
    }
    return new Types.ObjectId(campaignId);
  }

  async create(workspaceId: Types.ObjectId, input: AlertInput) {
    const rule = await this.rules.create({
      ...input,
      recipients: (input.recipients ?? []).map((e) => e.toLowerCase().trim()),
      platform: input.platform ?? null,
      campaignId: await this.campaignRef(workspaceId, input.campaignId),
      workspaceId,
    });
    return (await this.view(workspaceId, [rule]))[0];
  }

  private async get(workspaceId: Types.ObjectId, id: string) {
    const rule = isValidObjectId(id) ? await this.rules.findOne({ _id: id, workspaceId }) : null;
    if (!rule) throw new NotFoundException('Alert not found');
    return rule;
  }

  async update(workspaceId: Types.ObjectId, id: string, patch: Partial<AlertInput>) {
    const rule = await this.get(workspaceId, id);
    const { campaignId, recipients, ...rest } = patch;
    Object.assign(rule, rest);
    if (campaignId !== undefined) rule.campaignId = await this.campaignRef(workspaceId, campaignId);
    if (recipients) rule.recipients = recipients.map((e) => e.toLowerCase().trim());
    await rule.save();
    return (await this.view(workspaceId, [rule]))[0];
  }

  async remove(workspaceId: Types.ObjectId, id: string) {
    await (await this.get(workspaceId, id)).deleteOne();
    return { ok: true };
  }

  private windowRange(ws: WorkspaceDoc, w: AlertWindow): DayRange {
    const today = dayInZone(new Date(), ws.timezone);
    if (w === 'today') return { from: today, to: today };
    if (w === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
    return { from: addDays(today, -6), to: today };
  }

  /** Current value of the rule's metric and whether it crosses the threshold. */
  async evaluate(ws: WorkspaceDoc, rule: AlertRuleDoc) {
    const range = this.windowRange(ws, rule.window);
    let totals: Totals;
    let scope = 'all campaigns';
    if (rule.campaignId) {
      const detail = await this.reports.campaignDetail(ws, String(rule.campaignId), range);
      totals = detail.campaign;
      scope = `"${detail.campaign.name}"`;
    } else {
      totals = (await this.reports.overview(ws, range, { platform: rule.platform ?? undefined })).totals;
      if (rule.platform) scope = rule.platform === 'google' ? 'Google Ads' : 'Meta';
    }
    const m = METRIC[rule.metric];
    const value = m.pick(totals);
    const triggered = value != null && (rule.operator === 'gt' ? value > rule.threshold : value < rule.threshold);
    const fmt = (n: number) =>
      m.money
        ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: ws.currency, maximumFractionDigits: 2 }).format(n)
        : `${n}${m.pct ? '%' : ''}`;
    const message =
      value == null
        ? `${m.label} for ${scope} ${WINDOW_LABEL[rule.window]} has no data yet.`
        : `${m.label} for ${scope} ${WINDOW_LABEL[rule.window]} is ${fmt(value)} (${rule.operator === 'gt' ? 'above' : 'below'} ${fmt(rule.threshold)}: ${triggered ? 'yes' : 'no'}).`;
    return { value, triggered, message };
  }

  async test(ws: WorkspaceDoc, id: string) {
    return this.evaluate(ws, await this.get(ws._id, id));
  }

  /** Scheduled pass over every active rule. */
  async tick() {
    const rules = await this.rules.find({ active: true });
    const byWs = new Map<string, WorkspaceDoc | null>();
    let fired = 0;
    for (const rule of rules) {
      if (rule.lastTriggeredAt && Date.now() - rule.lastTriggeredAt.getTime() < rule.cooldownHours * 3_600_000) continue;
      const key = String(rule.workspaceId);
      if (!byWs.has(key)) byWs.set(key, await this.workspaces.findById(rule.workspaceId));
      const ws = byWs.get(key);
      if (!ws) continue;
      try {
        const res = await this.evaluate(ws, rule);
        rule.lastValue = res.value;
        if (res.triggered) {
          rule.lastTriggeredAt = new Date();
          await this.fire(ws, rule, res.message);
          fired++;
        }
        await rule.save();
      } catch (e) {
        this.logger.warn(`Alert ${rule.id} failed: ${(e as Error).message}`);
      }
    }
    return { evaluated: rules.length, fired };
  }

  private async fire(ws: WorkspaceDoc, rule: AlertRuleDoc, message: string) {
    const link = rule.campaignId ? `/w/${ws.id}/campaigns/${rule.campaignId}` : `/w/${ws.id}/dashboard`;
    if (rule.notifyInApp) {
      await this.notifications.create(ws._id, { kind: 'alert', severity: 'warning', title: rule.name, body: message, link });
    }
    if (rule.recipients.length && this.mailer.configured) {
      await this.mailer.send(
        rule.recipients,
        `[AdsAssist] ${rule.name} · ${ws.name}`,
        `<p style="font-family:sans-serif">${escapeHtml(message)}</p><p style="font-family:sans-serif;color:#666">Workspace: ${escapeHtml(ws.name)}</p>`,
        `${message}\nWorkspace: ${ws.name}`,
      );
    }
    this.bus.emit('alert.triggered', ws._id, { alert: { id: rule.id, name: rule.name, metric: rule.metric, value: rule.lastValue }, message });
  }
}
