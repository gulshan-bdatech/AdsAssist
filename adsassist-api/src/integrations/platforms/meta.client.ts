import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { DiscoveredAccount } from './google-ads.client.js';
import { num, PlatformError, requestJson } from './http.js';

// Lead Ads needs the page permissions; existing connections must reconnect once to grant them.
const OAUTH_SCOPES = 'ads_read,ads_management,business_management,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_ads';

/** Meta reports leads under several action types; "lead" is the de-duplicated total. */
const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
const PURCHASE_ACTIONS = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];

const firstAction = (list: any[] | undefined, types: string[]) => {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
};

export interface MetaCapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'website' | 'system_generated' | 'crm';
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

/** Graph API client for Facebook Login, Marketing API (insights) and Conversions API. */
@Injectable()
export class MetaClient {
  constructor(private readonly config: ConfigService) {}

  get configured() {
    return Boolean(this.appId && this.appSecret);
  }

  private get appId() {
    return this.config.get<string>('META_APP_ID') ?? '';
  }
  private get appSecret() {
    return this.config.get<string>('META_APP_SECRET') ?? '';
  }
  private get version() {
    return this.config.get<string>('META_API_VERSION') ?? 'v24.0';
  }
  private get graph() {
    return `https://graph.facebook.com/${this.version}`;
  }
  private get redirectUri() {
    return this.config.get<string>('META_OAUTH_REDIRECT_URI') || `${this.config.get('API_URL')}/api/integrations/meta/callback`;
  }

  authUrl(state: string): string {
    const url = new URL(`https://www.facebook.com/${this.version}/dialog/oauth`);
    url.searchParams.set('client_id', this.appId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', OAUTH_SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
  }

  private graphError = (status: number, body: any): PlatformError => {
    const e = body?.error ?? {};
    // 190 = invalid/expired token, 102 = session expired
    const revoked = e.code === 190 || e.code === 102;
    const msg = revoked
      ? 'Meta access token expired or was revoked. Reconnect Meta.'
      : e.code === 200 || e.code === 10
        ? `Meta permission missing: ${e.message}`
        : e.code === 17 || e.code === 4 || e.code === 80004
          ? 'Meta API rate limit reached. Sync will retry automatically.'
          : (e.error_user_msg ?? e.message ?? `Meta API error (HTTP ${status})`);
    return new PlatformError(msg, status, revoked, body);
  };

  /** appsecret_proof hardens server-side calls; Meta requires it when "Require App Secret" is on. */
  private withAuth(url: string, accessToken: string) {
    const u = new URL(url);
    u.searchParams.set('access_token', accessToken);
    u.searchParams.set('appsecret_proof', createHmac('sha256', this.appSecret).update(accessToken).digest('hex'));
    return u.toString();
  }

  private get<T>(url: string, accessToken: string) {
    return requestJson<T>(this.withAuth(url, accessToken), { timeoutMs: 60_000 }, this.graphError);
  }

  /** Follows `paging.next` until exhausted. */
  private async getAll<T>(url: string, accessToken: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = this.withAuth(url, accessToken);
    while (next) {
      const page: any = await requestJson<any>(next, { timeoutMs: 60_000 }, this.graphError);
      out.push(...(page?.data ?? []));
      next = page?.paging?.next;
    }
    return out;
  }

  /** Code → short-lived token → 60-day long-lived user token. */
  async exchangeCode(code: string): Promise<{ accessToken: string; expiresIn: number | null }> {
    const short = await requestJson<any>(
      `${this.graph}/oauth/access_token?${new URLSearchParams({
        client_id: this.appId,
        client_secret: this.appSecret,
        redirect_uri: this.redirectUri,
        code,
      })}`,
      {},
      this.graphError,
    );
    const long = await requestJson<any>(
      `${this.graph}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: this.appId,
        client_secret: this.appSecret,
        fb_exchange_token: short.access_token,
      })}`,
      {},
      this.graphError,
    );
    return { accessToken: long.access_token, expiresIn: long.expires_in ?? null };
  }

  me(accessToken: string) {
    return this.get<{ id: string; name?: string; email?: string }>(`${this.graph}/me?fields=id,name,email`, accessToken);
  }

  async revoke(accessToken: string) {
    await fetch(this.withAuth(`${this.graph}/me/permissions`, accessToken), { method: 'DELETE' }).catch(() => undefined);
  }

  async discoverAccounts(accessToken: string): Promise<DiscoveredAccount[]> {
    const rows = await this.getAll<any>(
      `${this.graph}/me/adaccounts?fields=account_id,name,currency,timezone_name,account_status&limit=200`,
      accessToken,
    );
    return rows.map((r) => ({
      externalId: String(r.account_id),
      name: r.name || `Meta ${r.account_id}`,
      currency: r.currency ?? '',
      timezone: r.timezone_name ?? '',
      isManager: false,
      loginCustomerId: '',
    }));
  }

  async fetchCampaigns(accessToken: string, accountId: string) {
    const rows = await this.getAll<any>(
      `${this.graph}/act_${accountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget&limit=500`,
      accessToken,
    );
    return rows.map((r) => ({
      externalId: String(r.id),
      name: r.name ?? '',
      rawStatus: r.effective_status ?? r.status ?? '',
      objective: r.objective ?? '',
      // Meta budgets are in the account currency's minor unit (paise/cents)
      dailyBudget: r.daily_budget ? num(r.daily_budget) / 100 : null,
    }));
  }

  async fetchAdSets(accessToken: string, accountId: string) {
    const rows = await this.getAll<any>(
      `${this.graph}/act_${accountId}/adsets?fields=id,name,campaign_id,effective_status&limit=500`,
      accessToken,
    );
    return rows.map((r) => ({
      externalId: String(r.id),
      campaignExternalId: String(r.campaign_id),
      name: r.name ?? '',
      rawStatus: r.effective_status ?? '',
    }));
  }

  async fetchAds(accessToken: string, accountId: string) {
    const rows = await this.getAll<any>(
      `${this.graph}/act_${accountId}/ads?fields=id,name,adset_id,campaign_id,effective_status,` +
        `creative{title,body,image_url,thumbnail_url,link_url,object_story_spec,asset_feed_spec}&limit=200`,
      accessToken,
    );
    return rows.map((r) => {
      const c = r.creative ?? {};
      const link = c.object_story_spec?.link_data ?? {};
      const video = c.object_story_spec?.video_data ?? {};
      const feed = c.asset_feed_spec ?? {};
      return {
        externalId: String(r.id),
        adGroupExternalId: String(r.adset_id ?? ''),
        campaignExternalId: String(r.campaign_id ?? ''),
        name: r.name ?? '',
        rawStatus: r.effective_status ?? '',
        headline: c.title ?? link.name ?? video.title ?? feed.titles?.[0]?.text ?? '',
        body: c.body ?? link.message ?? video.message ?? feed.bodies?.[0]?.text ?? '',
        imageUrl: c.image_url ?? c.thumbnail_url ?? link.picture ?? video.image_url ?? '',
        finalUrl: c.link_url ?? link.link ?? video.call_to_action?.value?.link ?? feed.link_urls?.[0]?.website_url ?? '',
      };
    });
  }

  async fetchMetrics(accessToken: string, accountId: string, from: string, to: string) {
    const fetchLevel = (level: 'campaign' | 'adset' | 'ad') =>
      this.getAll<any>(
        `${this.graph}/act_${accountId}/insights?${new URLSearchParams({
          level,
          time_increment: '1',
          time_range: JSON.stringify({ since: from, until: to }),
          fields: 'campaign_id,adset_id,ad_id,spend,impressions,clicks,reach,actions,action_values',
          limit: '500',
        })}`,
        accessToken,
      );
    const map = (r: any) => {
      const leads = firstAction(r.actions, LEAD_ACTIONS);
      const purchases = firstAction(r.actions, PURCHASE_ACTIONS);
      return {
        date: r.date_start as string,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        conversions: leads + purchases,
        conversionValue: firstAction(r.action_values, PURCHASE_ACTIONS),
        platformLeads: leads,
        reach: num(r.reach),
        campaignExternalId: String(r.campaign_id ?? ''),
        adGroupExternalId: String(r.adset_id ?? ''),
      };
    };
    const [campaigns, adsets, ads] = await Promise.all([fetchLevel('campaign'), fetchLevel('adset'), fetchLevel('ad')]);
    return {
      campaign: campaigns.map((r) => ({ ...map(r), entityExternalId: String(r.campaign_id), adGroupExternalId: '' })),
      ad_group: adsets.map((r) => ({ ...map(r), entityExternalId: String(r.adset_id) })),
      ad: ads.map((r) => ({ ...map(r), entityExternalId: String(r.ad_id) })),
    };
  }

  async listPixels(accessToken: string, accountId: string) {
    const rows = await this.getAll<any>(`${this.graph}/act_${accountId}/adspixels?fields=id,name&limit=100`, accessToken);
    return rows.map((r) => ({ id: String(r.id), name: r.name ?? String(r.id) }));
  }

  private post<T = any>(url: string, accessToken: string, body: Record<string, unknown>, method = 'POST') {
    return requestJson<T>(
      this.withAuth(url, accessToken),
      { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 120_000 },
      this.graphError,
    );
  }

  // ── Custom Audiences ──────────────────────────────────────────────────────

  async createCustomAudience(accessToken: string, accountId: string, name: string, description: string): Promise<string> {
    const data = await this.post<{ id: string }>(`${this.graph}/act_${accountId}/customaudiences`, accessToken, {
      name,
      description: description.slice(0, 100),
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
    });
    return data.id;
  }

  /**
   * Replaces all members with the given SHA-256 email/phone hashes using a
   * replace session (batches of 10 000). Meta keeps the audience usable
   * while the session runs.
   */
  async replaceAudienceUsers(accessToken: string, audienceId: string, rows: [string, string][]): Promise<number> {
    const batches: [string, string][][] = [];
    for (let i = 0; i < rows.length; i += 10_000) batches.push(rows.slice(i, i + 10_000));
    const sessionId = Math.floor(Math.random() * 1e15);
    for (let i = 0; i < batches.length; i++) {
      await this.post(`${this.graph}/${audienceId}/usersreplace`, accessToken, {
        session: {
          session_id: sessionId,
          batch_seq: i + 1,
          last_batch_flag: i === batches.length - 1,
          estimated_num_total: rows.length,
        },
        payload: { schema: ['EMAIL', 'PHONE'], data: batches[i] },
      });
    }
    return rows.length;
  }

  async audienceSize(accessToken: string, audienceId: string): Promise<number | null> {
    const data = await this.get<any>(`${this.graph}/${audienceId}?fields=approximate_count_lower_bound,approximate_count_upper_bound`, accessToken);
    const lower = data?.approximate_count_lower_bound;
    // Meta reports -1 while the audience is still being processed.
    return typeof lower === 'number' && lower >= 0 ? lower : null;
  }

  async deleteAudience(accessToken: string, audienceId: string) {
    await this.post(`${this.graph}/${audienceId}`, accessToken, {}, 'DELETE');
  }

  async createLookalike(accessToken: string, accountId: string, originId: string, country: string, ratio: number, name: string) {
    const data = await this.post<{ id: string }>(`${this.graph}/act_${accountId}/customaudiences`, accessToken, {
      name,
      subtype: 'LOOKALIKE',
      origin_audience_id: originId,
      lookalike_spec: JSON.stringify({ type: 'similarity', ratio, country }),
    });
    return data.id;
  }

  // ── Lead Ads ──────────────────────────────────────────────────────────────

  /** Facebook Pages the user manages, each with its own page access token. */
  listPages(accessToken: string) {
    return this.getAll<{ id: string; name: string; access_token: string }>(`${this.graph}/me/accounts?fields=id,name,access_token&limit=100`, accessToken);
  }

  listLeadForms(pageToken: string, pageId: string) {
    return this.getAll<{ id: string; name: string; status: string }>(`${this.graph}/${pageId}/leadgen_forms?fields=id,name,status&limit=100`, pageToken);
  }

  /** Form leads created after `since` (all when null), oldest first. */
  async fetchFormLeads(pageToken: string, formId: string, since: Date | null) {
    const params = new URLSearchParams({
      fields: 'id,created_time,field_data,ad_id,adset_id,campaign_id,platform',
      limit: '500',
    });
    if (since) {
      params.set('filtering', JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) }]));
    }
    const rows = await this.getAll<{
      id: string;
      created_time: string;
      field_data?: { name: string; values: string[] }[];
      ad_id?: string;
      adset_id?: string;
      campaign_id?: string;
      platform?: string;
    }>(`${this.graph}/${formId}/leads?${params}`, pageToken);
    return rows.sort((a, b) => a.created_time.localeCompare(b.created_time));
  }

  // ── Ad Library ────────────────────────────────────────────────────────────

  /** Ads from the public Ad Library. Outside the EU/UK Meta only returns political/issue ads. */
  async adsArchive(accessToken: string, q: { pageIds: string[]; searchTerms: string; countries: string[] }, max = 1000) {
    const params = new URLSearchParams({
      ad_reached_countries: JSON.stringify(q.countries),
      ad_active_status: 'ALL',
      ad_type: 'ALL',
      fields:
        'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_snapshot_url,publisher_platforms,ad_delivery_start_time,ad_delivery_stop_time',
      limit: '200',
    });
    if (q.pageIds.length) params.set('search_page_ids', JSON.stringify(q.pageIds));
    if (q.searchTerms) params.set('search_terms', q.searchTerms);
    const out: any[] = [];
    let next: string | undefined = this.withAuth(`${this.graph}/ads_archive?${params}`, accessToken);
    while (next && out.length < max) {
      const page: any = await requestJson<any>(next, { timeoutMs: 60_000 }, this.graphError);
      out.push(...(page?.data ?? []));
      next = page?.paging?.next;
    }
    return out.slice(0, max);
  }

  async sendCapiEvent(accessToken: string, pixelId: string, event: MetaCapiEvent) {
    return requestJson<Record<string, unknown>>(
      this.withAuth(`${this.graph}/${pixelId}/events`, accessToken),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [event] }) },
      this.graphError,
    );
  }
}
