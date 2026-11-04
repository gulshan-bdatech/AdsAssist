# AdsAssist Web

Dashboard for AdsAssist. Shows live Google Ads and Meta performance, website visitors and leads, and the conversions sent back to the ad platforms. It talks to the NestJS backend in `../adsassist-api` and follows the contract in `../adsassist-api/API.md`.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript
- Tailwind CSS v4 with shadcn/ui (radix-nova style, lucide icons)
- TanStack Query v5 for data fetching
- Recharts through the shadcn chart component
- next-themes for light and dark mode

## Setup

```bash
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL to the API base URL
npm install
npm run dev                  # http://localhost:3000
```

The API must be running (default `http://localhost:4000`) and must allow this origin in CORS. Its `WEB_URL` must point at this app so that OAuth callbacks and invite links come back here.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL of `adsassist-api` |
| `NEXT_PUBLIC_APP_NAME` | `AdsAssist` | Name shown in the UI and page titles |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build, including the type check |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

## How it works

- **Auth.** Login stores the JWT in the `aa_token` cookie (7 days). `lib/api.ts` sends it as `Authorization: Bearer`. On a 401 it clears the cookie and goes to `/login`. `proxy.ts` (Next 16's name for middleware) sends visitors without the cookie to `/login`. This is only a convenience check; the API validates the token on every request.
- **Workspaces.** Everything lives under `/w/[wid]/…`. The layout loads `GET /api/auth/me` and exposes the current workspace, role and currency through `useWorkspace()`. Write actions are hidden for `viewer`. Lead edits need `analyst`. Setup changes need `admin`.
- **Filters in the URL.** Date range (`from`, `to`), `platform`, `status`, `stage`, `page` and settings `tab` are search params, so links can be shared and keep their filters.
- **Live page.** Polls `GET /live` every 30 s and streams visitor events over SSE from `/events/stream?access_token=…`.
- **OAuth.** "Connect" fetches `{ url }` and redirects to Google or Meta. The API sends the browser back to `/w/:wid/integrations?connectionId=…`, where the account picker opens.
- **Phase 2 pages.** Audiences (`/audiences`, rule builder with live preview, CSV upload parsed in the browser with papaparse and sent in 50,000-row chunks, Google/Meta destinations, Meta lookalikes), Competitors (Meta Ad Library), Email tracking, Alerts with the weekly digest, Webhooks (deliveries drawer, signature snippet) and AI Summary (Claude, rendered with react-markdown). The notification bell in the top bar polls every 60 s. Meta Lead Ads forms are on the Integrations page. Pages for SMTP- or AI-dependent features read `GET /api/system/capabilities` and explain how to enable them when they are off.

## Folder structure

```
app/
  (auth)/login, register, invite/[token]   sign-in, sign-up, accept invite
  onboarding/                               first workspace
  page.tsx                                  redirects to the last used workspace
  w/[wid]/
    layout.tsx                              sidebar shell + workspace context
    dashboard/ live/ campaigns/[id]/ insights/
    leads/[id]/ contacts/[id]/ conversions/
    integrations/ tracking/ settings/
components/
  ui/                                       shadcn/ui primitives (generated)
  app/                                      app components: sidebar, KPI cards, charts,
                                            tables, filters, dialogs, settings tabs
lib/
  api.ts                                    typed API client and types (mirrors API.md)
  auth.ts                                   token cookie helpers
  format.ts                                 money, number, date and percent formatting
  range.ts                                  date range / platform URL state
  hooks.ts                                  shared queries (pipeline, stage change)
  workspace.tsx                             workspace context and role helpers
proxy.ts                                    redirects signed-out users to /login
```
