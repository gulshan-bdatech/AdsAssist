# AdsAssist API

NestJS backend for AdsAssist. It combines the old **adassist** dashboard (multi-tenant, Google/Meta, lead funnel, conversion push) with **Attribution/FunnelOS** (tracking pixel, identity stitching, server-side conversions). Data comes **live from the Google Ads API and Meta Marketing API**, not CSV.

The frontend is a separate project: `../adsassist-web` (Next.js + shadcn/ui).

## Stack

| Layer | Choice | Why |
|---|---|---|
| API | NestJS 12 (ESM), Express | Modules, guards, DI |
| Database | MongoDB Atlas via Mongoose 9 | Requested; flexible event/lead documents |
| Jobs | BullMQ + Redis | Scheduled live sync, retries with back-off, rate limits, pub/sub for the live feed |
| Auth | JWT (bcrypt passwords), workspace roles | `owner > admin > analyst > viewer`; agency admins manage client workspaces |
| Secrets | AES-256-GCM for OAuth tokens | Same format/key as adassist, so its encrypted tokens still decrypt |

## Run locally

Requirements: Node 22+, a MongoDB (Atlas or local) and Redis.

```bash
npm install
# .env is already filled from the old projects. Set MONGODB_URI to your Atlas string.
npm run dev            # API + workers on http://localhost:4000, Swagger on /docs
npm test               # unit tests (vitest)
npm run typecheck && npm run lint
```

Redis locally: `brew services start redis` (or Upstash/Redis Cloud, set `REDIS_URL`, `rediss://` for TLS).

### MongoDB Atlas

1. Create a cluster, a database user, and allow your IP (Network Access).
2. Copy the connection string into `MONGODB_URI`, with `/adsassist` as the database name.
3. Indexes are created automatically on start.

### Google Ads

In Google Cloud Console → OAuth client, add the authorized redirect URI:
`http://localhost:4000/api/integrations/google/callback` (and your production URL).
The developer token needs **Basic access** to read real accounts. Test access only works with test accounts.

### Meta

In the Meta app → Facebook Login → Settings, add the valid OAuth redirect URI:
`http://localhost:4000/api/integrations/meta/callback`.
Permissions used: `ads_read`, `ads_management`, `business_management`. Meta user tokens last 60 days. The UI shows "reconnect" when they expire.

## How it works

```
Google Ads API ─┐                                ┌─> Dashboard / Live / Campaigns / Insights
Meta Graph API ─┼─ BullMQ "ads-sync" every 15m ──┤   (metrics_daily + campaigns + ads)
                │  (today + 3 days, idempotent)   │
                                                  │
Website ── pixel.js ── POST /api/v1/events ──────┼─> events, devices
                         └─ "tracking" queue ─────┼─> identity (contacts) → lead on form submit
CRM / LMS ── POST /api/v1/leads (X-API-Key) ─────┤
                                                  └─> stage change ─ "conversions" queue ─> Google offline
                                                                                           conversions + Meta CAPI
```

- **Live sync** (`src/integrations`): OAuth connect, discovery of all accessible accounts (including MCC sub-accounts), then campaigns, ad groups/ad sets, ads (with creative text/image/URL) and daily metrics at three levels. A sync re-writes its whole window and deletes rows the platform no longer reports, so restated numbers stay correct.
- **Tracking** (`src/tracking`): pixel served at `/pixel.js?key=aa_…`. It keeps gclid/fbclid/UTMs from the landing URL for 90 days, captures field blurs, form submits and abandons, and posts `text/plain` (no CORS preflight). Identity stitching follows the FunnelOS rules: email hash, then phone hash, then same browser, else a new contact. Raw email/phone are not stored in the event log.
- **Leads** (`src/leads`): each workspace has an editable pipeline (default: new → qualified → application → approved → won/lost). Leads are attributed to a synced campaign by `utm_id` (exact) or `utm_campaign` (name). Stages marked `pushToPlatforms` send conversions to Google (gclid + enhanced conversions) and Meta CAPI, de-duplicated by `<leadId>-<stage>`.
- **Reports** (`src/reports`): totals, period-over-period, platform split, daily series, funnel from stage history, campaign drill-down, live snapshot and rule-based **insights** (spend without leads, high CPL, low CTR, campaigns worth scaling, attribution gaps, failed uploads).

Phone numbers are normalised once to E.164, using the workspace's `phoneCountryCode`. Meta gets the hash of the digits, Google the hash of `+digits`. The old adassist and FunnelOS hashed phones differently, so the same lead never matched across the two.

### Tracking setup on a client site

```html
<script async src="https://API_HOST/pixel.js?key=aa_xxx"></script>
<!-- thank-you page -->
<body data-adsassist-conversion data-adsassist-value="4999">
```

Ad URL suffix for exact campaign attribution:
Google `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_id={campaignid}`.
Meta `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}`.

### CRM / LMS integration

```bash
curl -X POST $API/api/v1/leads -H "X-API-Key: aak_..." -H "Content-Type: application/json" \
  -d '{"externalId":"LMS-1001","name":"Rahul","phone":"9123456789","gclid":"...","utm":{"id":"123456"}}'
curl -X PATCH $API/api/v1/leads/LMS-1001/stage -H "X-API-Key: aak_..." -H "Content-Type: application/json" \
  -d '{"stage":"won","value":250000}'
```

Full endpoint list: [API.md](API.md).

## Layout

```
src/
  main.ts, app.module.ts, queues.ts
  config/env.ts                 validated environment
  common/                       auth guards, redis, crypto, utils (+ unit tests)
  database/schemas/             all Mongoose models
  auth/  workspaces/            users, workspaces, members, invites, pipeline
  integrations/                 OAuth, Google/Meta clients, ad accounts, live sync worker
  tracking/                     pixel, events ingest, identity, contacts, SSE live feed
  leads/                        leads, CRM API, conversion push worker
  reports/                      dashboard, campaigns, live, insights
```

`RUN_WORKERS=false` runs an API-only replica. Run one instance with workers on.

## Phase 2

Code lives in `src/growth/`. All background work runs on one BullMQ queue (`automation`) with scheduled ticks.

| Feature | What it does | Needs |
|---|---|---|
| Audiences | Leads/contacts rules or an uploaded CSV, synced (full replace) to Meta Custom Audiences and Google Customer Match; Meta lookalikes; daily auto-sync | Connected ad accounts. Google Customer Match needs an eligible account; lists serve at 1,000+ matched users |
| Webhooks | Signed (`X-AdsAssist-Signature`) POSTs for lead, form, contact, conversion and alert events, 6 retries, delivery log, SSRF guard | An https URL |
| Alerts & notifications | Threshold rules on spend/leads/CPL/CTR/ROAS (every 15 min, with cooldown); in-app bell; sync and upload failures become notifications | `SMTP_*` for email (otherwise in-app only) |
| Weekly digest | Monday-style email with totals vs last week, top campaigns, insights and optional AI highlights | `SMTP_*` |
| AI summary | Claude (`ANTHROPIC_MODEL`, default `claude-opus-5-5`) writes a report with highlights and action items from the dashboard numbers; structured output, server-side refusal fallback enabled | `ANTHROPIC_API_KEY` |
| Email tracking | `POST /api/v1/email/messages` returns an open pixel and signed click links; opens/clicks land on the contact timeline | Workspace API key |
| Meta Lead Ads | Imports instant-form leads every 15 min into the pipeline, matched to campaigns; later stages go back to Meta with `lead_id` | Reconnect Meta once (new permissions: leads_retrieval, pages_*) |
| Consent mode + geo | Site keys can require consent; the pixel sends no PII until `adsassist.consent(true)`; opted-out people are never pushed or added to audiences. Country from CDN headers (Cloudflare/Vercel/CloudFront) | Run behind a CDN for country |
| Competitors | Meta Ad Library API watchlist by Page ID or search terms | Meta connection whose user confirmed identity for the Ad Library. Outside the EU/UK Meta returns political/issue ads only |

Not built (yet): Google Ads Transparency Center (no official API), IP geolocation database (MaxMind), Google lead form assets.
