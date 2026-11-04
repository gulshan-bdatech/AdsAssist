# AdsAssist API contract (Phase 1)

Base URL: `${API_URL}` (default `http://localhost:4000`). All JSON. Every app route is under `/api`.

Conventions

- Auth: `Authorization: Bearer <accessToken>` (JWT, 7 days).
- IDs are strings in `id`. Dates are ISO strings. Calendar days are `YYYY-MM-DD` strings.
- Errors: `{ "statusCode": 400, "message": "text" | ["text", ...], "error": "Bad Request" }`.
- Lists that page return `{ items, total, page, pageSize }` (`page` starts at 1, default `pageSize` 25, max 100).
- Workspace-scoped routes are `/api/workspaces/:wid/...`. Caller must be a member of `wid`, or an owner/admin of its parent agency workspace.
- Roles: `owner` > `admin` > `analyst` > `viewer`. Writes need `admin`+ unless noted. `viewer` is read-only.
- `platform` is `"google" | "meta"`. Lead/attribution channel adds `"organic" | "other"`.
- Date range query on reports: `from`, `to` (`YYYY-MM-DD`, inclusive; default last 30 days), optional `platform`, optional `adAccountId`.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` (password ≥ 8) | `{ accessToken, user }` |
| POST | `/api/auth/login` | `{ email, password }` | `{ accessToken, user }` |
| GET | `/api/auth/me` | | `{ user, workspaces: WorkspaceSummary[] }` |
| PATCH | `/api/auth/me` | `{ name?, currentPassword?, newPassword? }` | `{ user }` |

`User = { id, name, email, createdAt }`
`WorkspaceSummary = { id, name, type: "agency"|"client", parentId: string|null, role, currency, timezone }`

## Workspaces

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces` | | `WorkspaceSummary[]` (memberships + clients of agencies you admin) |
| POST | `/api/workspaces` | `{ name, type?, parentId?, currency?, timezone?, phoneCountryCode? }` | `Workspace` (caller becomes `owner`) |
| GET | `/api/workspaces/:wid` | | `Workspace` |
| PATCH | `/api/workspaces/:wid` | `{ name?, currency?, timezone?, phoneCountryCode?, brandColor? }` | `Workspace` |
| GET | `/api/workspaces/:wid/pipeline` | | `PipelineStage[]` |
| PUT | `/api/workspaces/:wid/pipeline` | `{ stages: PipelineStage[] }` | `PipelineStage[]` |
| GET | `/api/workspaces/:wid/members` | | `Member[]` |
| PATCH | `/api/workspaces/:wid/members/:userId` | `{ role }` | `Member` |
| DELETE | `/api/workspaces/:wid/members/:userId` | | `{ ok: true }` |
| GET | `/api/workspaces/:wid/invites` | | `Invite[]` |
| POST | `/api/workspaces/:wid/invites` | `{ email, role }` | `Invite & { acceptUrl }` |
| DELETE | `/api/workspaces/:wid/invites/:id` | | `{ ok: true }` |
| GET | `/api/invites/:token` | (public) | `{ workspaceName, email, role, status }` |
| POST | `/api/invites/:token/accept` | (auth) | `WorkspaceSummary` |

```
Workspace = { id, name, type, parentId, currency, timezone, phoneCountryCode, brandColor, role, createdAt }
PipelineStage = { key, label, order, kind: "open"|"won"|"lost", value?: number,
                  pushToPlatforms: boolean, metaEventName?: string, googleConversionActionId?: string }
Member = { userId, name, email, role, joinedAt }
Invite = { id, email, role, status: "pending"|"accepted"|"revoked", expiresAt, createdAt }
```

Default pipeline: `new` (Lead, push) → `qualified` → `application` → `approved` → `won` (won, push, Purchase) / `lost` (lost).

## Integrations (Google Ads / Meta live data)

OAuth: frontend calls `GET /api/workspaces/:wid/integrations/:platform/connect` → `{ url }`, then sets `window.location = url`. After consent the platform returns to the API callback, which redirects the browser to
`${WEB_URL}/w/:wid/integrations?connected=<platform>&connectionId=<id>` or `?error=<message>`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/integrations/:platform/connect` | | `{ url }` |
| GET | `/api/integrations/:platform/callback` | (public, platform redirect) | 302 |
| GET | `/api/workspaces/:wid/integrations/connections` | | `Connection[]` |
| DELETE | `/api/workspaces/:wid/integrations/connections/:id` | | `{ ok: true }` (also disconnects its ad accounts) |
| POST | `/api/workspaces/:wid/integrations/connections/:id/refresh-accounts` | | `Connection` |
| GET | `/api/workspaces/:wid/ad-accounts` | | `AdAccount[]` |
| POST | `/api/workspaces/:wid/ad-accounts` | `{ connectionId, externalIds: string[] }` | `AdAccount[]` (starts a 30-day backfill sync) |
| PATCH | `/api/workspaces/:wid/ad-accounts/:id` | `{ syncEnabled?, metaPixelId?, googleConversionActionId?, conversionsEnabled? }` | `AdAccount` |
| DELETE | `/api/workspaces/:wid/ad-accounts/:id` | | `{ ok: true }` |
| POST | `/api/workspaces/:wid/ad-accounts/:id/sync` | `{ days?: number }` (1–90, default 3) | `{ queued: true }` |
| GET | `/api/workspaces/:wid/ad-accounts/:id/meta-pixels` | | `{ id, name }[]` |
| GET | `/api/workspaces/:wid/ad-accounts/:id/google-conversion-actions` | | `{ id, name, status, category }[]` |
| GET | `/api/workspaces/:wid/sync-runs?adAccountId=` | | `SyncRun[]` (latest 50) |

```
Connection = { id, platform, externalUserName, externalUserEmail, status: "active"|"error"|"revoked",
               lastError, createdAt,
               availableAccounts: { externalId, name, currency, timezone, isManager, selected: boolean }[] }
AdAccount = { id, platform, externalId, name, currency, timezone, connectionId,
              status: "active"|"error"|"disconnected", syncEnabled, conversionsEnabled,
              metaPixelId, googleConversionActionId,
              lastSyncedAt, lastSyncStatus: "success"|"failed"|"running"|null, lastSyncError }
SyncRun = { id, adAccountId, platform, trigger: "schedule"|"manual"|"initial", status: "running"|"success"|"failed",
            startedAt, finishedAt, dateFrom, dateTo,
            stats: { campaigns, adGroups, ads, metricRows }, error }
```

Live sync: every `SYNC_INTERVAL_MINUTES` (default 15) the worker syncs today + previous 2 days for every active ad account. Google and Meta report with some delay, so "live" means "as of `lastSyncedAt`".

## Dashboard and campaigns

`GET /api/workspaces/:wid/dashboard/overview?from&to&platform&adAccountId`

```
{
  range: { from, to }, previousRange: { from, to }, currency, lastSyncedAt,
  totals: Totals, previous: Totals,
  byPlatform: ({ platform } & Totals)[],
  timeseries: { date, spend, impressions, clicks, conversions, leads, wonLeads, googleSpend, metaSpend }[],
  funnel: { key, label, count }[],          // pipeline stages, leads created in range
  topCampaigns: CampaignRow[]               // top 5 by spend
}
Totals = { spend, impressions, clicks, conversions, conversionValue, leads, wonLeads, revenue,
           ctr, cpc, cpm, cpl, cpa, roas, conversionRate }   // ratios are numbers, null when divisor is 0
```

`ctr` and `conversionRate` are percentages (e.g. `2.35`). `revenue` = sum of lead `value` for leads in a `won` stage. `roas` = revenue / spend.

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/campaigns` | range + `status?` (`active`/`paused`/`all`), `search?` | `CampaignRow[]` |
| GET | `/api/workspaces/:wid/campaigns/:id` | range | `CampaignDetail` |
| GET | `/api/workspaces/:wid/live` | | `LiveSnapshot` |
| GET | `/api/workspaces/:wid/insights` | range | `Insight[]` |

```
CampaignRow = { id, platform, externalId, name, status: "active"|"paused"|"removed"|"other", rawStatus,
                adAccountId, adAccountName, objective, dailyBudget, ...Totals }
CampaignDetail = { campaign: CampaignRow, timeseries: (same shape as overview.timeseries)[],
                   adGroups: ({ id, externalId, name, status } & Totals)[],
                   ads: ({ id, externalId, adGroupExternalId, name, status, headline, body, imageUrl, finalUrl } & Totals)[],
                   recentLeads: Lead[] }
LiveSnapshot = { lastSyncedAt, nextSyncAt, today: Totals, yesterday: Totals,
                 activeCampaigns: CampaignRow[],           // today's numbers, active only
                 recentEvents: TrackingEvent[] }           // latest 20
Insight = { id, severity: "critical"|"warning"|"info"|"success", title, detail,
            campaignId?, platform?, metric?, value?, benchmark? }
```

## Tracking (pixel, identity)

Public:

| Method | Path | Notes |
|---|---|---|
| GET | `/pixel.js?key=<siteKey>` | JS pixel. Install: `<script async src="${API_URL}/pixel.js?key=aa_..."></script>` |
| POST | `/api/v1/events?key=<siteKey>` | Pixel ingest, header `X-AA-Key` also accepted. 204. CORS `*`. |
| POST | `/api/v1/leads` | Server-to-server lead upsert. Header `X-API-Key: aak_...`. |
| PATCH | `/api/v1/leads/:externalId/stage` | `{ stage, value?, currency? }` with `X-API-Key`. Use this from a CRM/LMS. |

Pixel events: `page_view`, `form_start`, `field_capture`, `form_abandon`, `form_submit`, `conversion`, `custom`.
`window.adsassist.track({ event_type, ... })`, `window.adsassist.conversion({ value })`, `window.adsassist.identify({ email, phone, name })`.

Workspace (auth):

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/site-keys` | | `SiteKey[]` |
| POST | `/api/workspaces/:wid/site-keys` | `{ name, allowedDomains?: string[] }` | `SiteKey & { key }` (`key` only shown on create and in `installSnippet`) |
| PATCH | `/api/workspaces/:wid/site-keys/:id` | `{ name?, active?, allowedDomains?, createLeadOnSubmit? }` | `SiteKey` |
| DELETE | `/api/workspaces/:wid/site-keys/:id` | | `{ ok: true }` |
| GET | `/api/workspaces/:wid/api-keys` | | `ApiKey[]` |
| POST | `/api/workspaces/:wid/api-keys` | `{ name }` | `ApiKey & { key }` (shown once) |
| DELETE | `/api/workspaces/:wid/api-keys/:id` | | `{ ok: true }` |
| GET | `/api/workspaces/:wid/events` | `type?`, `siteKeyId?`, `contactId?`, page | paged `TrackingEvent` |
| GET | `/api/workspaces/:wid/events/stream?access_token=<jwt>` | SSE | `data: TrackingEvent` per message |
| GET | `/api/workspaces/:wid/contacts` | `search?`, `status?`, page | paged `Contact` |
| GET | `/api/workspaces/:wid/contacts/:id` | | `ContactDetail` |

```
SiteKey = { id, name, keyPrefix, key, active, allowedDomains, createLeadOnSubmit, installSnippet, eventsLast24h, createdAt }
ApiKey = { id, name, keyPrefix, lastUsedAt, createdAt }
TrackingEvent = { id, type, contactId, deviceKey, siteKeyId, pageUrl, pagePath, referrer,
                  utm: { source, medium, campaign, content, term, id }, gclid, fbclid,
                  fieldName, fieldValue, value, country, userAgent, createdAt }
Contact = { id, email, phone, name, status: "anonymous"|"known"|"cross_device", intentScore,
            firstTouch: Touch, lastTouch: Touch, deviceCount, eventCount, leadCount, lastSeenAt, createdAt }
Touch = { channel, source, medium, campaign, gclid, fbclid, at }
ContactDetail = { contact: Contact, attributes: Record<string,string>,
                  devices: { deviceKey, userAgent, platform, os, screenRes, firstSeenAt, lastSeenAt }[],
                  events: TrackingEvent[] (latest 200), leads: Lead[] }
```

## Leads and conversions

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/leads` | range, `stage?`, `channel?`, `campaignId?`, `search?`, page | paged `Lead` |
| POST | `/api/workspaces/:wid/leads` | `{ name?, email?, phone?, stage?, value?, channel?, campaignId?, notes? }` | `Lead` |
| GET | `/api/workspaces/:wid/leads/:id` | | `LeadDetail` |
| PATCH | `/api/workspaces/:wid/leads/:id` | `{ name?, email?, phone?, notes?, value? }` | `Lead` (analyst+) |
| POST | `/api/workspaces/:wid/leads/:id/stage` | `{ stage, value? }` | `Lead` (analyst+; pushes conversions if the stage has `pushToPlatforms`) |
| GET | `/api/workspaces/:wid/conversions` | `status?`, `platform?`, page | paged `ConversionPush` |
| POST | `/api/workspaces/:wid/conversions/:id/retry` | | `ConversionPush` |
| GET | `/api/workspaces/:wid/conversions/stats` | range | `{ total, sent, failed, pending, skipped, byPlatform: { platform, sent, failed }[] }` |

```
Lead = { id, externalId, source: "pixel"|"api"|"manual", name, email, phone, stage, stageLabel, value, currency,
         channel: "google"|"meta"|"organic"|"other", campaignId, campaignName, adAccountId,
         utm, gclid, fbclid, contactId, notes, createdAt, updatedAt }
LeadDetail = { lead: Lead, history: { stage, label, at, by: "pixel"|"api"|"user", userName? }[],
               conversions: ConversionPush[], events: TrackingEvent[] }
ConversionPush = { id, leadId, leadName, platform, adAccountId, stage, eventName, eventId,
                   status: "pending"|"sent"|"failed"|"skipped", attempts, lastError, sentAt, createdAt }
```

## Health

`GET /api/health` → `{ status: "ok", mongo: "up"|"down", redis: "up"|"down" }`
Swagger UI: `GET /docs`.

---

# Phase 2 additions

Same conventions as Phase 1. New `Channel` stays `"google"|"meta"|"organic"|"other"`. Lead `source` now also `"meta_form"`.
Tracking event types now also `"email_open" | "email_click"`.

## System capabilities

`GET /api/system/capabilities` (auth) → `{ email: boolean, ai: boolean, aiModel: string|null }`
`email` is false when SMTP is not configured (alerts then only appear in-app). `ai` is false without `ANTHROPIC_API_KEY`.

## Audiences (Meta Custom Audiences / Google Customer Match)

```
AudienceType = "leads" | "contacts" | "upload"
AudienceRules = {
  stages?: string[], excludeStages?: string[],          // leads
  channels?: Channel[], campaignIds?: string[],          // leads
  createdWithinDays?: number,                            // leads + contacts (1–540)
  minIntentScore?: number,                               // contacts (0–100)
  contactStatus?: ("known"|"cross_device")[],           // contacts
  eventTypes?: ("form_start"|"form_abandon"|"form_submit"|"conversion"|"email_open"|"email_click")[]  // contacts who did any of these
}
Audience = { id, name, description, type: AudienceType, rules: AudienceRules, autoSync: boolean,
             size, emailCount, phoneCount, lastComputedAt, createdAt,
             destinations: AudienceDestination[] }
AudienceDestination = { adAccountId, adAccountName, platform, externalAudienceId: string|null,
                        status: "pending"|"syncing"|"synced"|"failed", lastSyncedAt, uploadedCount,
                        matchedCount: number|null, error: string|null }
AudienceMemberPreview = { name: string|null, email: string|null, phone: string|null }   // masked, e.g. "pr***@example.com", "+91******3210"
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/audiences` | | `Audience[]` |
| POST | `/api/workspaces/:wid/audiences/preview` | `{ type, rules }` | `{ size, emailCount, phoneCount, sample: AudienceMemberPreview[] }` (type `upload` → 400) |
| POST | `/api/workspaces/:wid/audiences` | `{ name, description?, type, rules?, autoSync?, consentConfirmed: true }` | `Audience` (admin). `consentConfirmed` must be `true` (people agreed to be contacted / marketing use). |
| GET | `/api/workspaces/:wid/audiences/:id` | | `Audience & { sample: AudienceMemberPreview[] }` |
| PATCH | `/api/workspaces/:wid/audiences/:id` | `{ name?, description?, rules?, autoSync? }` | `Audience` |
| DELETE | `/api/workspaces/:wid/audiences/:id?removeFromPlatforms=true` | | `{ ok: true }` |
| POST | `/api/workspaces/:wid/audiences/:id/upload` | `{ mode: "append"|"replace", rows: { email?, phone?, firstName?, lastName? }[] }` (≤ 50 000 rows per call; frontend parses CSV) | `{ added, skipped, size }` (type `upload` only) |
| POST | `/api/workspaces/:wid/audiences/:id/destinations` | `{ adAccountIds: string[] }` | `Audience` (queues a sync) |
| DELETE | `/api/workspaces/:wid/audiences/:id/destinations/:adAccountId` | | `Audience` |
| POST | `/api/workspaces/:wid/audiences/:id/sync` | | `{ queued: true }` |
| POST | `/api/workspaces/:wid/audiences/:id/lookalike` | `{ adAccountId, country: "IN", ratio: 0.01–0.10 }` | `{ externalAudienceId, name }` (Meta only, audience must be synced to that account) |

Sync uploads SHA-256 email/phone, replacing the platform list each time. `autoSync` audiences re-sync daily. Leads/contacts that opted out (`consent: false`) are never included.

## Webhooks (outbound)

```
WebhookEvent = "lead.created" | "lead.stage_changed" | "lead.won" | "contact.identified" |
               "form.submitted" | "form.abandoned" | "conversion.sent" | "conversion.failed" | "alert.triggered"
Webhook = { id, name, url, events: WebhookEvent[], active, secretPrefix, lastDeliveryAt, lastStatus: "sent"|"failed"|null,
            failureCount, createdAt }
WebhookDelivery = { id, webhookId, event, status: "pending"|"sent"|"failed", attempts, responseStatus: number|null,
                    responseBody: string|null, error: string|null, durationMs: number|null, payload: object, createdAt }
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/webhooks` | | `Webhook[]` (admin) |
| POST | `/api/workspaces/:wid/webhooks` | `{ name, url, events }` | `Webhook & { secret }` (secret shown once) |
| PATCH | `/api/workspaces/:wid/webhooks/:id` | `{ name?, url?, events?, active? }` | `Webhook` |
| DELETE | `/api/workspaces/:wid/webhooks/:id` | | `{ ok: true }` |
| POST | `/api/workspaces/:wid/webhooks/:id/rotate-secret` | | `{ secret }` |
| POST | `/api/workspaces/:wid/webhooks/:id/test` | | `WebhookDelivery` (sends a `ping` event synchronously) |
| GET | `/api/workspaces/:wid/webhooks/:id/deliveries` | page | paged `WebhookDelivery` |
| POST | `/api/workspaces/:wid/webhooks/deliveries/:deliveryId/redeliver` | | `WebhookDelivery` |

Request sent: `POST url`, JSON `{ id, event, createdAt, workspaceId, data }`, headers `X-AdsAssist-Event`, `X-AdsAssist-Delivery`,
`X-AdsAssist-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. 2xx = delivered; otherwise retried up to 6 times with back-off.
URLs must be `https://` (http allowed only for localhost in development) and must not resolve to private IPs.

## Alerts, notifications, digests

```
AlertMetric = "spend" | "leads" | "won_leads" | "cpl" | "cpc" | "ctr" | "conversions" | "roas"
AlertRule = { id, name, metric: AlertMetric, operator: "gt"|"lt", threshold: number,
              window: "today"|"yesterday"|"last_7_days", platform: Platform|null, campaignId: string|null, campaignName: string|null,
              recipients: string[], notifyInApp: boolean, active: boolean, cooldownHours: number,
              lastTriggeredAt, lastValue: number|null, createdAt }
Notification = { id, kind: "alert"|"sync_error"|"conversion_failed"|"ai_summary"|"system",
                 severity: "critical"|"warning"|"info"|"success", title, body, link: string|null, read: boolean, createdAt }
ReportSettings = { weeklyDigest: boolean, digestRecipients: string[], digestDay: 0–6 (0 = Sunday), aiInDigest: boolean }
```

`link` is a web path such as `/w/<wid>/campaigns/<id>`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/alerts` | | `AlertRule[]` |
| POST | `/api/workspaces/:wid/alerts` | AlertRule fields minus id/last*/createdAt (`cooldownHours` default 24, `notifyInApp` default true) | `AlertRule` (analyst+) |
| PATCH | `/api/workspaces/:wid/alerts/:id` | partial | `AlertRule` |
| DELETE | `/api/workspaces/:wid/alerts/:id` | | `{ ok: true }` |
| POST | `/api/workspaces/:wid/alerts/:id/test` | | `{ value: number|null, triggered: boolean, message }` (evaluates now, sends nothing) |
| GET | `/api/workspaces/:wid/notifications` | `unread?=true`, page | `{ items: Notification[], total, page, pageSize, unreadCount }` |
| POST | `/api/workspaces/:wid/notifications/read` | `{ ids?: string[] }` (omit = all) | `{ unreadCount }` |
| GET | `/api/workspaces/:wid/report-settings` | | `ReportSettings` |
| PUT | `/api/workspaces/:wid/report-settings` | `ReportSettings` | `ReportSettings` (admin) |

Alerts are evaluated every 15 minutes. Sync failures and conversion upload failures also create notifications.

## AI summary (Claude)

```
AiSummary = { id, range: { from, to }, markdown: string, highlights: string[],
              actions: { title, detail, campaignId: string|null, priority: "high"|"medium"|"low" }[],
              model, createdAt }
```

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/workspaces/:wid/ai/summary` | `{ from?, to? }` (default last 7 days) | `AiSummary` (analyst+; 503 when AI is not configured; can take ~30 s) |
| GET | `/api/workspaces/:wid/ai/summaries` | | `AiSummary[]` (latest 20) |

## Email open / click tracking

Server-to-server, with a workspace API key:
`POST /api/v1/email/messages` `X-API-Key: aak_…` body `{ to, subject?, campaign?, messageId?, links?: string[] }` →
`{ messageId, openPixelUrl, openPixelHtml, links: { url, trackedUrl }[] }`.
Put `openPixelHtml` in the email body and replace each link with its `trackedUrl`.
Public: `GET /api/v1/e/o/:token` (1×1 gif, records `email_open`), `GET /api/v1/e/c/:token` (302 to the original URL, records `email_click`).

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/email/messages` | page, `search?`, `campaign?` | paged `{ id, messageId, to, subject, campaign, contactId, opens, clicks, firstOpenedAt, lastClickedAt, createdAt }` |
| GET | `/api/workspaces/:wid/email/stats` | range | `{ sent, opened, clicked, openRate, clickRate, byCampaign: { campaign, sent, opened, clicked, openRate, clickRate }[] }` (rates in %) |

## Meta Lead Ads (instant forms)

Needs the Meta connection to be re-connected once (new permissions: `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`).

```
LeadFormOption = { connectionId, pageId, pageName, formId, formName, status, enabled: boolean }
LeadFormSubscription = { id, connectionId, pageId, pageName, formId, formName, enabled, lastImportedAt, importedCount, lastError }
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/lead-forms/available` | | `LeadFormOption[]` (live from Meta) |
| GET | `/api/workspaces/:wid/lead-forms` | | `LeadFormSubscription[]` |
| PUT | `/api/workspaces/:wid/lead-forms` | `{ forms: { connectionId, pageId, pageName, formId, formName, enabled }[] }` | `LeadFormSubscription[]` (admin) |
| POST | `/api/workspaces/:wid/lead-forms/:id/import` | | `{ queued: true }` |

Enabled forms are polled every 15 minutes. Each new form lead becomes a `Lead` with `source: "meta_form"`, `channel: "meta"`, matched to the synced campaign.

## Consent mode and geo

- `SiteKey` gains `requireConsent: boolean` (PATCH/POST accept it). When on, the pixel sends no email/phone/field values until the page calls `adsassist.consent(true)`; `adsassist.consent(false)` records an opt-out.
- `Lead` and `Contact` gain `consent: boolean|null` and `country: string` (ISO-2 from the CDN/proxy country header when available).
- Opted-out leads are not pushed to ad platforms and not added to audiences.

## Competitor ads (Meta Ad Library API)

```
CompetitorWatch = { id, name, pageIds: string[], searchTerms: string, countries: string[], lastFetchedAt, adCount, activeAdCount, lastError, createdAt }
CompetitorAd = { id, watchId, adArchiveId, pageId, pageName, bodies: string[], titles: string[], descriptions: string[],
                 snapshotUrl, platforms: string[], startedAt, stoppedAt: string|null, active: boolean, firstSeenAt }
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workspaces/:wid/competitors` | | `CompetitorWatch[]` |
| POST | `/api/workspaces/:wid/competitors` | `{ name, pageIds?: string[], searchTerms?: string, countries: string[] }` (needs pageIds or searchTerms) | `CompetitorWatch` |
| DELETE | `/api/workspaces/:wid/competitors/:id` | | `{ ok: true }` |
| POST | `/api/workspaces/:wid/competitors/:id/refresh` | | `{ queued: true }` |
| GET | `/api/workspaces/:wid/competitors/:id/ads` | page, `active?=true` | paged `CompetitorAd` |

Limitation shown in the UI: Meta's Ad Library API returns all ads only for ads delivered in the EU/UK; elsewhere (e.g. India) it returns political/issue ads only. Needs a Meta connection whose user has confirmed their identity for the Ad Library API.
