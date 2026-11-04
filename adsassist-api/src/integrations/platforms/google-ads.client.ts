import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { num, PlatformError, requestJson } from './http.js';

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export interface DiscoveredAccount {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  isManager: boolean;
  loginCustomerId: string;
}

export interface GoogleCallContext {
  accessToken: string;
  customerId: string;
  loginCustomerId?: string;
}

export interface GoogleConversionInput {
  conversionAction: string;
  conversionDateTime: Date;
  orderId: string;
  gclid?: string | null;
  hashedEmail?: string | null;
  hashedPhone?: string | null;
  value?: number | null;
  currency?: string;
}

const OAUTH_SCOPES = 'https://www.googleapis.com/auth/adwords openid email profile';

/** Thin REST client for Google OAuth + Google Ads API (GAQL via googleAds:search). */
@Injectable()
export class GoogleAdsClient {
  private readonly logger = new Logger(GoogleAdsClient.name);

  constructor(private readonly config: ConfigService) {}

  get configured() {
    return Boolean(this.clientId && this.clientSecret && this.developerToken);
  }

  private get clientId() {
    return this.config.get<string>('GOOGLE_ADS_CLIENT_ID') ?? '';
  }
  private get clientSecret() {
    return this.config.get<string>('GOOGLE_ADS_CLIENT_SECRET') ?? '';
  }
  private get developerToken() {
    return this.config.get<string>('GOOGLE_ADS_DEVELOPER_TOKEN') ?? '';
  }
  private get base() {
    return `https://googleads.googleapis.com/${this.config.get('GOOGLE_ADS_API_VERSION') ?? 'v24'}`;
  }
  private get redirectUri() {
    return this.config.get<string>('GOOGLE_OAUTH_REDIRECT_URI') || `${this.config.get('API_URL')}/api/integrations/google/callback`;
  }

  authUrl(state: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    // consent forces Google to return a refresh token even on re-connect
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('scope', OAUTH_SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
  }

  private oauthError = (status: number, body: any) => {
    const code = body?.error as string | undefined;
    if (code === 'invalid_grant') {
      return new PlatformError('Google access was revoked or expired. Reconnect Google Ads.', status, true, body);
    }
    return new PlatformError(`Google OAuth failed: ${body?.error_description ?? code ?? status}`, status, false, body);
  };

  async exchangeCode(code: string): Promise<GoogleTokens> {
    const data = await requestJson<any>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
        }),
      },
      this.oauthError,
    );
    return { accessToken: data.access_token, refreshToken: data.refresh_token ?? '', expiresIn: data.expires_in ?? 3600, scope: data.scope ?? '' };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const data = await requestJson<any>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
        }),
      },
      this.oauthError,
    );
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
  }

  async userInfo(accessToken: string): Promise<{ id: string; name: string; email: string }> {
    const data = await requestJson<any>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      (s, b) => new PlatformError(`Google userinfo failed (${s})`, s, false, b),
    );
    return { id: data.sub ?? '', name: data.name ?? '', email: data.email ?? '' };
  }

  async revoke(token: string) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
  }

  private adsError = (status: number, body: any, text: string): PlatformError => {
    if (text.trim().startsWith('<')) {
      return new PlatformError(`Google Ads API ${this.base.split('/').pop()} is unavailable (HTTP ${status}). Check GOOGLE_ADS_API_VERSION.`, status);
    }
    const err = Array.isArray(body) ? body[0]?.error : body?.error;
    const inner = err?.details?.find((d: any) => d.errors)?.errors?.[0];
    const codeObj = inner?.errorCode ?? {};
    const code = Object.values(codeObj)[0] as string | undefined;
    const friendly: Record<string, string> = {
      DEVELOPER_TOKEN_NOT_APPROVED:
        'Your Google Ads developer token only has Test access. Apply for Basic access in the Google Ads API Center to read real accounts.',
      DEVELOPER_TOKEN_PROHIBITED: 'This developer token is not allowed for the OAuth client. Use a token from the same Google Cloud project.',
      USER_PERMISSION_DENIED: 'The connected Google user has no access to this account (check the manager/login customer id).',
      CUSTOMER_NOT_ENABLED: 'This Google Ads account is not enabled (cancelled or not yet set up).',
      NOT_ADS_USER: 'The connected Google login is not linked to any Google Ads account.',
    };
    const message = (code && friendly[code]) ?? inner?.message ?? err?.message ?? `Google Ads API error (HTTP ${status})`;
    return new PlatformError(message, status, status === 401, body);
  };

  private headers(ctx: Pick<GoogleCallContext, 'accessToken' | 'loginCustomerId'>): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${ctx.accessToken}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    };
    // An explicit '' means "no manager": a client's own account must not be sent with our MCC id.
    const login = (ctx.loginCustomerId ?? this.config.get<string>('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ?? '').replace(/\D/g, '');
    if (login) h['login-customer-id'] = login;
    return h;
  }

  /** Runs a GAQL query and follows pagination. */
  async search<T = any>(ctx: GoogleCallContext, query: string): Promise<T[]> {
    const rows: T[] = [];
    let pageToken: string | undefined;
    do {
      const data = await requestJson<any>(
        `${this.base}/customers/${ctx.customerId}/googleAds:search`,
        { method: 'POST', headers: this.headers(ctx), body: JSON.stringify({ query, pageToken }), timeoutMs: 60_000 },
        this.adsError,
      );
      rows.push(...((data?.results ?? []) as T[]));
      pageToken = data?.nextPageToken || undefined;
    } while (pageToken);
    return rows;
  }

  async listAccessibleCustomers(accessToken: string): Promise<string[]> {
    const data = await requestJson<any>(
      `${this.base}/customers:listAccessibleCustomers`,
      { headers: this.headers({ accessToken, loginCustomerId: '' }) },
      this.adsError,
    );
    return ((data?.resourceNames ?? []) as string[]).map((r) => r.split('/').pop()!).filter(Boolean);
  }

  /**
   * Every Google Ads account reachable by this login: direct accounts plus the
   * non-manager clients under any manager (MCC), each with the
   * login-customer-id needed to query it.
   */
  async discoverAccounts(accessToken: string): Promise<DiscoveredAccount[]> {
    const ids = await this.listAccessibleCustomers(accessToken);
    const out = new Map<string, DiscoveredAccount>();
    for (const id of ids) {
      try {
        const [row] = await this.search<any>(
          { accessToken, customerId: id, loginCustomerId: id },
          'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1',
        );
        const c = row?.customer ?? {};
        if (c.manager) {
          const clients = await this.search<any>(
            { accessToken, customerId: id, loginCustomerId: id },
            `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
                    customer_client.time_zone, customer_client.manager, customer_client.status
             FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED'`,
          );
          for (const r of clients) {
            const cc = r.customerClient;
            const cid = String(cc.id);
            if (!out.has(cid)) {
              out.set(cid, {
                externalId: cid,
                name: cc.descriptiveName || `Google Ads ${cid}`,
                currency: cc.currencyCode ?? '',
                timezone: cc.timeZone ?? '',
                isManager: false,
                loginCustomerId: id,
              });
            }
          }
        } else {
          out.set(id, {
            externalId: id,
            name: c.descriptiveName || `Google Ads ${id}`,
            currency: c.currencyCode ?? '',
            timezone: c.timeZone ?? '',
            isManager: false,
            loginCustomerId: out.get(id)?.loginCustomerId ?? id,
          });
        }
      } catch (e) {
        // Cancelled or inaccessible accounts appear in the list too; skip them.
        this.logger.warn(`Skipping Google customer ${id}: ${(e as Error).message}`);
      }
    }
    return [...out.values()];
  }

  async fetchCampaigns(ctx: GoogleCallContext) {
    const rows = await this.search<any>(
      ctx,
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros
       FROM campaign WHERE campaign.status != 'REMOVED'`,
    );
    return rows.map((r) => ({
      externalId: String(r.campaign.id),
      name: r.campaign.name ?? '',
      rawStatus: r.campaign.status ?? '',
      objective: r.campaign.advertisingChannelType ?? '',
      dailyBudget: r.campaignBudget?.amountMicros ? num(r.campaignBudget.amountMicros) / 1e6 : null,
    }));
  }

  async fetchAdGroups(ctx: GoogleCallContext) {
    const rows = await this.search<any>(
      ctx,
      `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id
       FROM ad_group WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
    );
    return rows.map((r) => ({
      externalId: String(r.adGroup.id),
      campaignExternalId: String(r.campaign.id),
      name: r.adGroup.name ?? '',
      rawStatus: r.adGroup.status ?? '',
    }));
  }

  async fetchAds(ctx: GoogleCallContext) {
    const rows = await this.search<any>(
      ctx,
      `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.type,
              ad_group_ad.ad.final_urls,
              ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
              ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.descriptions,
              ad_group_ad.ad.expanded_text_ad.headline_part1, ad_group_ad.ad.expanded_text_ad.description,
              ad_group.id, campaign.id
       FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
    );
    return rows.map((r) => {
      const ad = r.adGroupAd.ad ?? {};
      const rsa = ad.responsiveSearchAd ?? ad.responsiveDisplayAd;
      const headline = rsa?.headlines?.[0]?.text ?? ad.expandedTextAd?.headlinePart1 ?? '';
      const body = rsa?.descriptions?.[0]?.text ?? ad.expandedTextAd?.description ?? '';
      return {
        externalId: String(ad.id),
        adGroupExternalId: String(r.adGroup.id),
        campaignExternalId: String(r.campaign.id),
        name: ad.name || headline || `${ad.type ?? 'Ad'} ${ad.id}`,
        rawStatus: r.adGroupAd.status ?? '',
        headline,
        body,
        imageUrl: '',
        finalUrl: ad.finalUrls?.[0] ?? '',
      };
    });
  }

  /** Daily metrics at campaign, ad group and ad level for an inclusive date range. */
  async fetchMetrics(ctx: GoogleCallContext, from: string, to: string) {
    const metricFields =
      'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, segments.date';
    const where = `segments.date BETWEEN '${from}' AND '${to}'`;
    const map = (r: any) => ({
      date: r.segments.date as string,
      spend: num(r.metrics?.costMicros) / 1e6,
      impressions: num(r.metrics?.impressions),
      clicks: num(r.metrics?.clicks),
      conversions: num(r.metrics?.conversions),
      conversionValue: num(r.metrics?.conversionsValue),
      platformLeads: 0,
      reach: 0,
    });
    const [campaigns, adGroups, ads] = await Promise.all([
      this.search<any>(ctx, `SELECT campaign.id, ${metricFields} FROM campaign WHERE ${where}`),
      this.search<any>(ctx, `SELECT campaign.id, ad_group.id, ${metricFields} FROM ad_group WHERE ${where}`),
      this.search<any>(ctx, `SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ${metricFields} FROM ad_group_ad WHERE ${where}`),
    ]);
    return {
      campaign: campaigns.map((r) => ({ ...map(r), entityExternalId: String(r.campaign.id), campaignExternalId: String(r.campaign.id), adGroupExternalId: '' })),
      ad_group: adGroups.map((r) => ({ ...map(r), entityExternalId: String(r.adGroup.id), campaignExternalId: String(r.campaign.id), adGroupExternalId: String(r.adGroup.id) })),
      ad: ads.map((r) => ({ ...map(r), entityExternalId: String(r.adGroupAd.ad.id), campaignExternalId: String(r.campaign.id), adGroupExternalId: String(r.adGroup.id) })),
    };
  }

  async listConversionActions(ctx: GoogleCallContext) {
    const rows = await this.search<any>(
      ctx,
      `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.type
       FROM conversion_action WHERE conversion_action.status != 'REMOVED'`,
    );
    return rows
      .filter((r) => ['UPLOAD_CLICKS', 'UPLOAD_CALLS'].includes(r.conversionAction.type) || !r.conversionAction.type)
      .map((r) => ({
        id: String(r.conversionAction.id),
        name: r.conversionAction.name,
        status: r.conversionAction.status,
        category: r.conversionAction.category,
      }));
  }

  private post<T = any>(ctx: GoogleCallContext, path: string, body: unknown, timeoutMs = 60_000) {
    return requestJson<T>(
      `${this.base}/${path}`,
      { method: 'POST', headers: this.headers(ctx), body: JSON.stringify(body), timeoutMs },
      this.adsError,
    );
  }

  /** Creates a Customer Match (CRM-based) user list and returns its resource name. */
  async createCustomerMatchList(ctx: GoogleCallContext, name: string, description: string): Promise<string> {
    const data = await this.post(ctx, `customers/${ctx.customerId}/userLists:mutate`, {
      operations: [
        {
          create: {
            name,
            description: description.slice(0, 200),
            membershipLifeSpan: 540,
            crmBasedUserList: { uploadKeyType: 'CONTACT_INFO', dataSourceType: 'FIRST_PARTY' },
          },
        },
      ],
    });
    return data.results[0].resourceName as string;
  }

  /**
   * Replaces a Customer Match list's members: one offline user data job that
   * removes everyone, then adds the hashed identifiers, then runs.
   * Google processes the job asynchronously (minutes to hours).
   */
  async replaceCustomerMatch(
    ctx: GoogleCallContext,
    userList: string,
    rows: { hashedEmail?: string | null; hashedPhoneNumber?: string | null }[],
  ): Promise<number> {
    const job = await this.post(ctx, `customers/${ctx.customerId}/offlineUserDataJobs:create`, {
      job: {
        type: 'CUSTOMER_MATCH_USER_LIST',
        customerMatchUserListMetadata: { userList, consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' } },
      },
    });
    const jobName = job.resourceName as string;
    const ops = rows
      .map((r) => {
        const ids: Record<string, string>[] = [];
        if (r.hashedEmail) ids.push({ hashedEmail: r.hashedEmail });
        if (r.hashedPhoneNumber) ids.push({ hashedPhoneNumber: r.hashedPhoneNumber });
        return ids.length ? { create: { userIdentifiers: ids } } : null;
      })
      .filter(Boolean);
    const batches = [[{ removeAll: true }, ...ops.slice(0, 4999)], ...chunk(ops.slice(4999), 5000)];
    for (const operations of batches) {
      if (!operations.length) continue;
      await this.post(ctx, `${jobName}:addOperations`, { enablePartialFailure: true, operations }, 120_000);
    }
    await this.post(ctx, `${jobName}:run`, {});
    return ops.length;
  }

  /** Matched size of a user list (null until Google has processed it). */
  async userListSize(ctx: GoogleCallContext, userList: string): Promise<number | null> {
    const [row] = await this.search<any>(
      ctx,
      `SELECT user_list.size_for_search, user_list.size_for_display FROM user_list WHERE user_list.resource_name = '${userList}'`,
    );
    const ul = row?.userList;
    if (!ul) return null;
    const sizes = [ul.sizeForSearch, ul.sizeForDisplay].map((v: unknown) => (v == null ? null : num(v))).filter((v) => v != null) as number[];
    return sizes.length ? Math.max(...sizes) : null;
  }

  async removeUserList(ctx: GoogleCallContext, userList: string) {
    await this.post(ctx, `customers/${ctx.customerId}/userLists:mutate`, { operations: [{ remove: userList }] });
  }

  /**
   * Offline click conversion (gclid) with enhanced-conversion identifiers.
   * Without a gclid Google can still match on hashed email/phone
   * ("enhanced conversions for leads") if that is enabled on the action.
   */
  async uploadClickConversion(ctx: GoogleCallContext, input: GoogleConversionInput) {
    const userIdentifiers: Record<string, string>[] = [];
    if (input.hashedEmail) userIdentifiers.push({ hashedEmail: input.hashedEmail });
    if (input.hashedPhone) userIdentifiers.push({ hashedPhoneNumber: input.hashedPhone });
    const conversion: Record<string, unknown> = {
      conversionAction: `customers/${ctx.customerId}/conversionActions/${input.conversionAction}`,
      conversionDateTime: formatGoogleDateTime(input.conversionDateTime),
      orderId: input.orderId,
    };
    if (input.gclid) conversion.gclid = input.gclid;
    if (userIdentifiers.length) conversion.userIdentifiers = userIdentifiers;
    if (input.value != null) {
      conversion.conversionValue = input.value;
      conversion.currencyCode = input.currency ?? 'INR';
    }
    const data = await requestJson<any>(
      `${this.base}/customers/${ctx.customerId}:uploadClickConversions`,
      {
        method: 'POST',
        headers: this.headers(ctx),
        body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
      },
      this.adsError,
    );
    if (data?.partialFailureError) {
      throw new PlatformError(data.partialFailureError.message ?? 'Google rejected the conversion', 400, false, data);
    }
    return data as Record<string, unknown>;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Google wants "yyyy-mm-dd hh:mm:ss+00:00". */
function formatGoogleDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
}
