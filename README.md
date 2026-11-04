# AdsAssist

Live Google Ads + Meta reporting, lead attribution and conversion tracking.

| Folder | What | Stack |
|---|---|---|
| [`adsassist-api`](adsassist-api) | Backend: live ad sync, tracking pixel, leads, conversions, automations | NestJS, MongoDB, BullMQ + Redis |
| [`adsassist-web`](adsassist-web) | Dashboard | Next.js, shadcn/ui, TanStack Query |

Setup: see [adsassist-api/README.md](adsassist-api/README.md). Copy `.env.example` to `.env` (API) and set `NEXT_PUBLIC_API_URL` in `adsassist-web/.env.local`.
