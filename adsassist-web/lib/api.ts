import { clearToken, getToken } from "@/lib/auth"

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "")

// ── Shared types (mirrors adsassist-api/API.md) ─────────────────────────────

export type Role = "owner" | "admin" | "analyst" | "viewer"
export type Platform = "google" | "meta"
export type Channel = Platform | "organic" | "other"
export type WorkspaceType = "agency" | "client"

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  type: WorkspaceType
  parentId: string | null
  role: Role
  currency: string
  timezone: string
}

export interface Workspace {
  id: string
  name: string
  type: WorkspaceType
  parentId: string | null
  currency: string
  timezone: string
  phoneCountryCode: string
  brandColor: string
  role: Role
  createdAt: string
}

export type StageKind = "open" | "won" | "lost"

export interface PipelineStage {
  key: string
  label: string
  order: number
  kind: StageKind
  value?: number
  pushToPlatforms: boolean
  metaEventName?: string
  googleConversionActionId?: string
}

export interface Member {
  userId: string
  name: string
  email: string
  role: Role
  joinedAt: string
}

export interface Invite {
  id: string
  email: string
  role: Role
  status: "pending" | "accepted" | "revoked"
  expiresAt: string
  createdAt: string
  acceptUrl?: string
}

export interface AvailableAccount {
  externalId: string
  name: string
  currency: string
  timezone: string
  isManager: boolean
  selected: boolean
}

export interface Connection {
  id: string
  platform: Platform
  externalUserName: string | null
  externalUserEmail: string | null
  status: "active" | "error" | "revoked"
  lastError: string | null
  createdAt: string
  availableAccounts: AvailableAccount[]
}

export interface AdAccount {
  id: string
  platform: Platform
  externalId: string
  name: string
  currency: string
  timezone: string
  connectionId: string
  status: "active" | "error" | "disconnected"
  syncEnabled: boolean
  conversionsEnabled: boolean
  metaPixelId: string | null
  googleConversionActionId: string | null
  lastSyncedAt: string | null
  lastSyncStatus: "success" | "failed" | "running" | null
  lastSyncError: string | null
}

export interface SyncRun {
  id: string
  adAccountId: string
  platform: Platform
  trigger: "schedule" | "manual" | "initial"
  status: "running" | "success" | "failed"
  startedAt: string
  finishedAt: string | null
  dateFrom: string
  dateTo: string
  stats: { campaigns: number; adGroups: number; ads: number; metricRows: number }
  error: string | null
}

export interface Totals {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  leads: number
  wonLeads: number
  revenue: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  cpl: number | null
  cpa: number | null
  roas: number | null
  conversionRate: number | null
}

export interface TimeseriesPoint {
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  leads: number
  wonLeads: number
  googleSpend: number
  metaSpend: number
}

export type CampaignStatus = "active" | "paused" | "removed" | "other"

export interface CampaignRow extends Totals {
  id: string
  platform: Platform
  externalId: string
  name: string
  status: CampaignStatus
  rawStatus: string
  adAccountId: string
  adAccountName: string
  objective: string | null
  dailyBudget: number | null
}

export interface Overview {
  range: { from: string; to: string }
  previousRange: { from: string; to: string }
  currency: string
  lastSyncedAt: string | null
  totals: Totals
  previous: Totals
  byPlatform: (Totals & { platform: Platform })[]
  timeseries: TimeseriesPoint[]
  funnel: { key: string; label: string; count: number }[]
  topCampaigns: CampaignRow[]
}

export interface AdGroupRow extends Totals {
  id: string
  externalId: string
  name: string
  status: string
}

export interface AdRow extends Totals {
  id: string
  externalId: string
  adGroupExternalId: string
  name: string
  status: string
  headline: string | null
  body: string | null
  imageUrl: string | null
  finalUrl: string | null
}

export interface CampaignDetail {
  campaign: CampaignRow
  timeseries: TimeseriesPoint[]
  adGroups: AdGroupRow[]
  ads: AdRow[]
  recentLeads: Lead[]
}

export interface Utm {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  content?: string | null
  term?: string | null
  id?: string | null
}

export type EventType =
  | "page_view"
  | "form_start"
  | "field_capture"
  | "form_abandon"
  | "form_submit"
  | "conversion"
  | "custom"
  | "email_open"
  | "email_click"

export interface TrackingEvent {
  id: string
  type: EventType | string
  contactId: string | null
  deviceKey: string
  siteKeyId: string | null
  pageUrl: string | null
  pagePath: string | null
  referrer: string | null
  utm: Utm
  gclid: string | null
  fbclid: string | null
  fieldName: string | null
  fieldValue: string | null
  value: number | null
  country: string | null
  userAgent: string | null
  createdAt: string
}

export interface LiveSnapshot {
  lastSyncedAt: string | null
  nextSyncAt: string | null
  today: Totals
  yesterday: Totals
  activeCampaigns: CampaignRow[]
  recentEvents: TrackingEvent[]
}

export interface Insight {
  id: string
  severity: "critical" | "warning" | "info" | "success"
  title: string
  detail: string
  campaignId?: string
  platform?: Platform
  metric?: string
  value?: number
  benchmark?: number
}

export interface SiteKey {
  id: string
  name: string
  keyPrefix: string
  key: string
  active: boolean
  allowedDomains: string[]
  createLeadOnSubmit: boolean
  requireConsent: boolean
  installSnippet: string
  eventsLast24h: number
  createdAt: string
}

export interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
  key?: string
}

export interface Touch {
  channel: Channel | null
  source: string | null
  medium: string | null
  campaign: string | null
  gclid: string | null
  fbclid: string | null
  at: string | null
}

export interface Contact {
  id: string
  email: string | null
  phone: string | null
  name: string | null
  status: "anonymous" | "known" | "cross_device"
  intentScore: number
  firstTouch: Touch | null
  lastTouch: Touch | null
  deviceCount: number
  eventCount: number
  leadCount: number
  lastSeenAt: string | null
  createdAt: string
  consent?: boolean | null
  country?: string | null
}

export interface Device {
  deviceKey: string
  userAgent: string | null
  platform: string | null
  os: string | null
  screenRes: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export interface ContactDetail {
  contact: Contact
  attributes: Record<string, string>
  devices: Device[]
  events: TrackingEvent[]
  leads: Lead[]
}

export interface Lead {
  id: string
  externalId: string | null
  source: "pixel" | "api" | "manual" | "meta_form"
  name: string | null
  email: string | null
  phone: string | null
  stage: string
  stageLabel: string
  value: number | null
  currency: string
  channel: Channel
  campaignId: string | null
  campaignName: string | null
  adAccountId: string | null
  utm: Utm
  gclid: string | null
  fbclid: string | null
  contactId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  consent?: boolean | null
  country?: string | null
}

export interface ConversionPush {
  id: string
  leadId: string
  leadName: string | null
  platform: Platform
  adAccountId: string | null
  stage: string
  eventName: string
  eventId: string
  status: "pending" | "sent" | "failed" | "skipped"
  attempts: number
  lastError: string | null
  sentAt: string | null
  createdAt: string
}

export interface LeadDetail {
  lead: Lead
  history: { stage: string; label: string; at: string; by: "pixel" | "api" | "user"; userName?: string }[]
  conversions: ConversionPush[]
  events: TrackingEvent[]
}

export interface ConversionStats {
  total: number
  sent: number
  failed: number
  pending: number
  skipped: number
  byPlatform: { platform: Platform; sent: number; failed: number }[]
}

export interface Health {
  status: string
  mongo: "up" | "down"
  redis: "up" | "down"
}

export interface RangeParams {
  from?: string
  to?: string
  platform?: Platform
  adAccountId?: string
}

// ── Phase 2 types ───────────────────────────────────────────────────────────

export interface Capabilities {
  email: boolean
  ai: boolean
  aiModel: string | null
}

export type AudienceType = "leads" | "contacts" | "upload"

export type AudienceEventType =
  | "form_start"
  | "form_abandon"
  | "form_submit"
  | "conversion"
  | "email_open"
  | "email_click"

export interface AudienceRules {
  stages?: string[]
  excludeStages?: string[]
  channels?: Channel[]
  campaignIds?: string[]
  createdWithinDays?: number
  minIntentScore?: number
  contactStatus?: ("known" | "cross_device")[]
  eventTypes?: AudienceEventType[]
}

export interface AudienceDestination {
  adAccountId: string
  adAccountName: string
  platform: Platform
  externalAudienceId: string | null
  status: "pending" | "syncing" | "synced" | "failed"
  lastSyncedAt: string | null
  uploadedCount: number
  matchedCount: number | null
  error: string | null
}

export interface AudienceMemberPreview {
  name: string | null
  email: string | null
  phone: string | null
}

export interface Audience {
  id: string
  name: string
  description: string | null
  type: AudienceType
  rules: AudienceRules
  autoSync: boolean
  size: number
  emailCount: number
  phoneCount: number
  lastComputedAt: string | null
  createdAt: string
  destinations: AudienceDestination[]
}

export interface AudiencePreview {
  size: number
  emailCount: number
  phoneCount: number
  sample: AudienceMemberPreview[]
}

export interface AudienceUploadRow {
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
}

export type WebhookEvent =
  | "lead.created"
  | "lead.stage_changed"
  | "lead.won"
  | "contact.identified"
  | "form.submitted"
  | "form.abandoned"
  | "conversion.sent"
  | "conversion.failed"
  | "alert.triggered"

export interface Webhook {
  id: string
  name: string
  url: string
  events: WebhookEvent[]
  active: boolean
  secretPrefix: string
  lastDeliveryAt: string | null
  lastStatus: "sent" | "failed" | null
  failureCount: number
  createdAt: string
}

export interface WebhookDelivery {
  id: string
  webhookId: string
  event: string
  status: "pending" | "sent" | "failed"
  attempts: number
  responseStatus: number | null
  responseBody: string | null
  error: string | null
  durationMs: number | null
  payload: unknown
  createdAt: string
}

export type AlertMetric = "spend" | "leads" | "won_leads" | "cpl" | "cpc" | "ctr" | "conversions" | "roas"
export type AlertWindow = "today" | "yesterday" | "last_7_days"

export interface AlertRule {
  id: string
  name: string
  metric: AlertMetric
  operator: "gt" | "lt"
  threshold: number
  window: AlertWindow
  platform: Platform | null
  campaignId: string | null
  campaignName: string | null
  recipients: string[]
  notifyInApp: boolean
  active: boolean
  cooldownHours: number
  lastTriggeredAt: string | null
  lastValue: number | null
  createdAt: string
}

export type AlertRuleInput = Pick<
  AlertRule,
  "name" | "metric" | "operator" | "threshold" | "window" | "platform" | "campaignId" | "recipients" | "notifyInApp" | "active" | "cooldownHours"
>

export interface AppNotification {
  id: string
  kind: "alert" | "sync_error" | "conversion_failed" | "ai_summary" | "system"
  severity: "critical" | "warning" | "info" | "success"
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: string
}

export interface ReportSettings {
  weeklyDigest: boolean
  digestRecipients: string[]
  digestDay: number
  aiInDigest: boolean
}

export interface AiSummary {
  id: string
  range: { from: string; to: string }
  markdown: string
  highlights: string[]
  actions: { title: string; detail: string; campaignId: string | null; priority: "high" | "medium" | "low" }[]
  model: string
  createdAt: string
}

export interface EmailMessage {
  id: string
  messageId: string
  to: string
  subject: string | null
  campaign: string | null
  contactId: string | null
  opens: number
  clicks: number
  firstOpenedAt: string | null
  lastClickedAt: string | null
  createdAt: string
}

export interface EmailStats {
  sent: number
  opened: number
  clicked: number
  openRate: number | null
  clickRate: number | null
  byCampaign: { campaign: string | null; sent: number; opened: number; clicked: number; openRate: number | null; clickRate: number | null }[]
}

export interface LeadFormOption {
  connectionId: string
  pageId: string
  pageName: string
  formId: string
  formName: string
  status: string
  enabled: boolean
}

export interface LeadFormSubscription {
  id: string
  connectionId: string
  pageId: string
  pageName: string
  formId: string
  formName: string
  enabled: boolean
  lastImportedAt: string | null
  importedCount: number
  lastError: string | null
}

export interface CompetitorWatch {
  id: string
  name: string
  pageIds: string[]
  searchTerms: string | null
  countries: string[]
  lastFetchedAt: string | null
  adCount: number
  activeAdCount: number
  lastError: string | null
  createdAt: string
}

export interface CompetitorAd {
  id: string
  watchId: string
  adArchiveId: string
  pageId: string
  pageName: string
  bodies: string[]
  titles: string[]
  descriptions: string[]
  snapshotUrl: string | null
  platforms: string[]
  startedAt: string | null
  stoppedAt: string | null
  active: boolean
  firstSeenAt: string
}

// ── Fetch helper ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

function qs(query?: Query) {
  if (!query) return ""
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ""
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Query; auth?: boolean } = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { Accept: "application/json" }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}${qs(opts.query)}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Is the backend running?`)
  }

  if (res.status === 401 && token && opts.auth !== false) {
    clearToken()
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      // Full reload on purpose: drops every cached query that belonged to the expired session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${next}`
    }
    throw new ApiError(401, "Your session has expired. Please sign in again.")
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? safeJson(text) : undefined

  if (!res.ok) {
    const raw = (data as { message?: string | string[] } | undefined)?.message
    const message = Array.isArray(raw) ? raw.join(", ") : raw || res.statusText || "Request failed"
    throw new ApiError(res.status, message)
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const get = <T>(path: string, query?: Query) => request<T>("GET", path, { query })
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, { body: body ?? {} })
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, { body })
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, { body })
const del = <T>(path: string) => request<T>("DELETE", path)

const ws = (wid: string) => `/api/workspaces/${wid}`

// ── Endpoints ───────────────────────────────────────────────────────────────

export const api = {
  // Auth
  register: (body: { name: string; email: string; password: string }) =>
    request<{ accessToken: string; user: User }>("POST", "/api/auth/register", { body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<{ accessToken: string; user: User }>("POST", "/api/auth/login", { body, auth: false }),
  me: () => get<{ user: User; workspaces: WorkspaceSummary[] }>("/api/auth/me"),
  updateMe: (body: { name?: string; currentPassword?: string; newPassword?: string }) =>
    patch<{ user: User }>("/api/auth/me", body),

  // Workspaces
  workspaces: () => get<WorkspaceSummary[]>("/api/workspaces"),
  createWorkspace: (body: {
    name: string
    type?: WorkspaceType
    parentId?: string
    currency?: string
    timezone?: string
    phoneCountryCode?: string
  }) => post<Workspace>("/api/workspaces", body),
  workspace: (wid: string) => get<Workspace>(ws(wid)),
  updateWorkspace: (
    wid: string,
    body: Partial<Pick<Workspace, "name" | "currency" | "timezone" | "phoneCountryCode" | "brandColor">>,
  ) => patch<Workspace>(ws(wid), body),
  pipeline: (wid: string) => get<PipelineStage[]>(`${ws(wid)}/pipeline`),
  savePipeline: (wid: string, stages: PipelineStage[]) =>
    put<PipelineStage[]>(`${ws(wid)}/pipeline`, { stages }),
  members: (wid: string) => get<Member[]>(`${ws(wid)}/members`),
  updateMember: (wid: string, userId: string, role: Role) =>
    patch<Member>(`${ws(wid)}/members/${userId}`, { role }),
  removeMember: (wid: string, userId: string) => del<{ ok: true }>(`${ws(wid)}/members/${userId}`),
  invites: (wid: string) => get<Invite[]>(`${ws(wid)}/invites`),
  createInvite: (wid: string, body: { email: string; role: Role }) =>
    post<Invite & { acceptUrl: string }>(`${ws(wid)}/invites`, body),
  revokeInvite: (wid: string, id: string) => del<{ ok: true }>(`${ws(wid)}/invites/${id}`),
  inviteInfo: (token: string) =>
    request<{ workspaceName: string; email: string; role: Role; status: Invite["status"] }>(
      "GET",
      `/api/invites/${token}`,
      { auth: false },
    ),
  acceptInvite: (token: string) => post<WorkspaceSummary>(`/api/invites/${token}/accept`),

  // Integrations
  connectUrl: (wid: string, platform: Platform) =>
    get<{ url: string }>(`${ws(wid)}/integrations/${platform}/connect`),
  connections: (wid: string) => get<Connection[]>(`${ws(wid)}/integrations/connections`),
  deleteConnection: (wid: string, id: string) =>
    del<{ ok: true }>(`${ws(wid)}/integrations/connections/${id}`),
  refreshConnectionAccounts: (wid: string, id: string) =>
    post<Connection>(`${ws(wid)}/integrations/connections/${id}/refresh-accounts`),
  adAccounts: (wid: string) => get<AdAccount[]>(`${ws(wid)}/ad-accounts`),
  addAdAccounts: (wid: string, body: { connectionId: string; externalIds: string[] }) =>
    post<AdAccount[]>(`${ws(wid)}/ad-accounts`, body),
  updateAdAccount: (
    wid: string,
    id: string,
    body: {
      syncEnabled?: boolean
      metaPixelId?: string
      googleConversionActionId?: string
      conversionsEnabled?: boolean
    },
  ) => patch<AdAccount>(`${ws(wid)}/ad-accounts/${id}`, body),
  deleteAdAccount: (wid: string, id: string) => del<{ ok: true }>(`${ws(wid)}/ad-accounts/${id}`),
  syncAdAccount: (wid: string, id: string, days?: number) =>
    post<{ queued: true }>(`${ws(wid)}/ad-accounts/${id}/sync`, days ? { days } : {}),
  metaPixels: (wid: string, id: string) =>
    get<{ id: string; name: string }[]>(`${ws(wid)}/ad-accounts/${id}/meta-pixels`),
  googleConversionActions: (wid: string, id: string) =>
    get<{ id: string; name: string; status: string; category: string }[]>(
      `${ws(wid)}/ad-accounts/${id}/google-conversion-actions`,
    ),
  syncRuns: (wid: string, adAccountId?: string) =>
    get<SyncRun[]>(`${ws(wid)}/sync-runs`, { adAccountId }),

  // Dashboard & campaigns
  overview: (wid: string, range: RangeParams) =>
    get<Overview>(`${ws(wid)}/dashboard/overview`, { ...range }),
  campaigns: (wid: string, params: RangeParams & { status?: string; search?: string }) =>
    get<CampaignRow[]>(`${ws(wid)}/campaigns`, { ...params }),
  campaign: (wid: string, id: string, range: RangeParams) =>
    get<CampaignDetail>(`${ws(wid)}/campaigns/${id}`, { ...range }),
  live: (wid: string) => get<LiveSnapshot>(`${ws(wid)}/live`),
  insights: (wid: string, range: RangeParams) => get<Insight[]>(`${ws(wid)}/insights`, { ...range }),

  // Tracking
  siteKeys: (wid: string) => get<SiteKey[]>(`${ws(wid)}/site-keys`),
  createSiteKey: (wid: string, body: { name: string; allowedDomains?: string[] }) =>
    post<SiteKey>(`${ws(wid)}/site-keys`, body),
  updateSiteKey: (
    wid: string,
    id: string,
    body: {
      name?: string
      active?: boolean
      allowedDomains?: string[]
      createLeadOnSubmit?: boolean
      requireConsent?: boolean
    },
  ) => patch<SiteKey>(`${ws(wid)}/site-keys/${id}`, body),
  deleteSiteKey: (wid: string, id: string) => del<{ ok: true }>(`${ws(wid)}/site-keys/${id}`),
  apiKeys: (wid: string) => get<ApiKey[]>(`${ws(wid)}/api-keys`),
  createApiKey: (wid: string, body: { name: string }) =>
    post<ApiKey & { key: string }>(`${ws(wid)}/api-keys`, body),
  deleteApiKey: (wid: string, id: string) => del<{ ok: true }>(`${ws(wid)}/api-keys/${id}`),
  events: (wid: string, params: { type?: string; siteKeyId?: string; contactId?: string; page?: number; pageSize?: number }) =>
    get<Paged<TrackingEvent>>(`${ws(wid)}/events`, { ...params }),
  eventStreamUrl: (wid: string) =>
    `${API_URL}${ws(wid)}/events/stream?access_token=${encodeURIComponent(getToken() || "")}`,
  contacts: (wid: string, params: { search?: string; status?: string; page?: number; pageSize?: number }) =>
    get<Paged<Contact>>(`${ws(wid)}/contacts`, { ...params }),
  contact: (wid: string, id: string) => get<ContactDetail>(`${ws(wid)}/contacts/${id}`),

  // Leads & conversions
  leads: (
    wid: string,
    params: RangeParams & {
      stage?: string
      channel?: string
      campaignId?: string
      search?: string
      page?: number
      pageSize?: number
    },
  ) => get<Paged<Lead>>(`${ws(wid)}/leads`, { ...params }),
  createLead: (
    wid: string,
    body: {
      name?: string
      email?: string
      phone?: string
      stage?: string
      value?: number
      channel?: Channel
      campaignId?: string
      notes?: string
    },
  ) => post<Lead>(`${ws(wid)}/leads`, body),
  lead: (wid: string, id: string) => get<LeadDetail>(`${ws(wid)}/leads/${id}`),
  updateLead: (
    wid: string,
    id: string,
    body: { name?: string; email?: string; phone?: string; notes?: string; value?: number },
  ) => patch<Lead>(`${ws(wid)}/leads/${id}`, body),
  setLeadStage: (wid: string, id: string, body: { stage: string; value?: number }) =>
    post<Lead>(`${ws(wid)}/leads/${id}/stage`, body),
  conversions: (wid: string, params: { status?: string; platform?: string; page?: number; pageSize?: number }) =>
    get<Paged<ConversionPush>>(`${ws(wid)}/conversions`, { ...params }),
  retryConversion: (wid: string, id: string) => post<ConversionPush>(`${ws(wid)}/conversions/${id}/retry`),
  conversionStats: (wid: string, range: RangeParams) =>
    get<ConversionStats>(`${ws(wid)}/conversions/stats`, { ...range }),

  // System
  capabilities: () => get<Capabilities>("/api/system/capabilities"),

  // Audiences
  audiences: (wid: string) => get<Audience[]>(`${ws(wid)}/audiences`),
  previewAudience: (wid: string, body: { type: AudienceType; rules: AudienceRules }) =>
    post<AudiencePreview>(`${ws(wid)}/audiences/preview`, body),
  createAudience: (
    wid: string,
    body: {
      name: string
      description?: string
      type: AudienceType
      rules?: AudienceRules
      autoSync?: boolean
      consentConfirmed: true
    },
  ) => post<Audience>(`${ws(wid)}/audiences`, body),
  audience: (wid: string, id: string) =>
    get<Audience & { sample: AudienceMemberPreview[] }>(`${ws(wid)}/audiences/${id}`),
  updateAudience: (
    wid: string,
    id: string,
    body: { name?: string; description?: string; rules?: AudienceRules; autoSync?: boolean },
  ) => patch<Audience>(`${ws(wid)}/audiences/${id}`, body),
  deleteAudience: (wid: string, id: string, removeFromPlatforms: boolean) =>
    request<{ ok: true }>("DELETE", `${ws(wid)}/audiences/${id}`, {
      query: { removeFromPlatforms: removeFromPlatforms || undefined },
    }),
  uploadAudience: (wid: string, id: string, body: { mode: "append" | "replace"; rows: AudienceUploadRow[] }) =>
    post<{ added: number; skipped: number; size: number }>(`${ws(wid)}/audiences/${id}/upload`, body),
  addAudienceDestinations: (wid: string, id: string, adAccountIds: string[]) =>
    post<Audience>(`${ws(wid)}/audiences/${id}/destinations`, { adAccountIds }),
  removeAudienceDestination: (wid: string, id: string, adAccountId: string) =>
    del<Audience>(`${ws(wid)}/audiences/${id}/destinations/${adAccountId}`),
  syncAudience: (wid: string, id: string) => post<{ queued: true }>(`${ws(wid)}/audiences/${id}/sync`),
  createLookalike: (wid: string, id: string, body: { adAccountId: string; country: string; ratio: number }) =>
    post<{ externalAudienceId: string; name: string }>(`${ws(wid)}/audiences/${id}/lookalike`, body),

  // Webhooks
  webhooks: (wid: string) => get<Webhook[]>(`${ws(wid)}/webhooks`),
  createWebhook: (wid: string, body: { name: string; url: string; events: WebhookEvent[] }) =>
    post<Webhook & { secret: string }>(`${ws(wid)}/webhooks`, body),
  updateWebhook: (
    wid: string,
    id: string,
    body: { name?: string; url?: string; events?: WebhookEvent[]; active?: boolean },
  ) => patch<Webhook>(`${ws(wid)}/webhooks/${id}`, body),
  deleteWebhook: (wid: string, id: string) => del<{ ok: true }>(`${ws(wid)}/webhooks/${id}`),
  rotateWebhookSecret: (wid: string, id: string) =>
    post<{ secret: string }>(`${ws(wid)}/webhooks/${id}/rotate-secret`),
  testWebhook: (wid: string, id: string) => post<WebhookDelivery>(`${ws(wid)}/webhooks/${id}/test`),
  webhookDeliveries: (wid: string, id: string, params: { page?: number; pageSize?: number }) =>
    get<Paged<WebhookDelivery>>(`${ws(wid)}/webhooks/${id}/deliveries`, { ...params }),
  redeliverWebhook: (wid: string, deliveryId: string) =>
    post<WebhookDelivery>(`${ws(wid)}/webhooks/deliveries/${deliveryId}/redeliver`),

  // Alerts & notifications
  alerts: (wid: string) => get<AlertRule[]>(`${ws(wid)}/alerts`),
  createAlert: (wid: string, body: AlertRuleInput) => post<AlertRule>(`${ws(wid)}/alerts`, body),
  updateAlert: (wid: string, id: string, body: Partial<AlertRuleInput>) =>
    patch<AlertRule>(`${ws(wid)}/alerts/${id}`, body),
  deleteAlert: (wid: string, id: string) => del<{ ok: true }>(`${ws(wid)}/alerts/${id}`),
  testAlert: (wid: string, id: string) =>
    post<{ value: number | null; triggered: boolean; message: string }>(`${ws(wid)}/alerts/${id}/test`),
  notifications: (wid: string, params: { unread?: boolean; page?: number; pageSize?: number }) =>
    get<Paged<AppNotification> & { unreadCount: number }>(`${ws(wid)}/notifications`, { ...params }),
  markNotificationsRead: (wid: string, ids?: string[]) =>
    post<{ unreadCount: number }>(`${ws(wid)}/notifications/read`, ids ? { ids } : {}),
  reportSettings: (wid: string) => get<ReportSettings>(`${ws(wid)}/report-settings`),
  saveReportSettings: (wid: string, body: ReportSettings) => put<ReportSettings>(`${ws(wid)}/report-settings`, body),

  // AI summary
  generateAiSummary: (wid: string, range: { from?: string; to?: string }) =>
    post<AiSummary>(`${ws(wid)}/ai/summary`, range),
  aiSummaries: (wid: string) => get<AiSummary[]>(`${ws(wid)}/ai/summaries`),

  // Email tracking
  emailMessages: (wid: string, params: { search?: string; campaign?: string; page?: number; pageSize?: number }) =>
    get<Paged<EmailMessage>>(`${ws(wid)}/email/messages`, { ...params }),
  emailStats: (wid: string, range: RangeParams) => get<EmailStats>(`${ws(wid)}/email/stats`, { ...range }),

  // Meta Lead Ads
  leadFormsAvailable: (wid: string) => get<LeadFormOption[]>(`${ws(wid)}/lead-forms/available`),
  leadForms: (wid: string) => get<LeadFormSubscription[]>(`${ws(wid)}/lead-forms`),
  saveLeadForms: (
    wid: string,
    forms: Pick<LeadFormOption, "connectionId" | "pageId" | "pageName" | "formId" | "formName" | "enabled">[],
  ) => put<LeadFormSubscription[]>(`${ws(wid)}/lead-forms`, { forms }),
  importLeadForm: (wid: string, id: string) => post<{ queued: true }>(`${ws(wid)}/lead-forms/${id}/import`),

  // Competitors
  competitors: (wid: string) => get<CompetitorWatch[]>(`${ws(wid)}/competitors`),
  createCompetitor: (wid: string, body: { name: string; pageIds?: string[]; searchTerms?: string; countries: string[] }) =>
    post<CompetitorWatch>(`${ws(wid)}/competitors`, body),
  deleteCompetitor: (wid: string, id: string) => del<{ ok: true }>(`${ws(wid)}/competitors/${id}`),
  refreshCompetitor: (wid: string, id: string) => post<{ queued: true }>(`${ws(wid)}/competitors/${id}/refresh`),
  competitorAds: (wid: string, id: string, params: { active?: boolean; page?: number; pageSize?: number }) =>
    get<Paged<CompetitorAd>>(`${ws(wid)}/competitors/${id}/ads`, { ...params }),

  health: () => request<Health>("GET", "/api/health", { auth: false }),
}
