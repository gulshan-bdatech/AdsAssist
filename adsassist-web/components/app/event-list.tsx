import Link from "next/link"
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  FileInput,
  LogOut,
  MailOpen,
  MousePointerClick,
  Send,
  Sparkles,
  TextCursorInput,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { PlatformIcon } from "@/components/app/badges"
import type { TrackingEvent } from "@/lib/api"
import { formatDateTime, humanize, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

const EVENT_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  page_view: { label: "Viewed page", icon: Eye, tone: "text-sky-600 bg-sky-500/10 dark:text-sky-400" },
  form_start: { label: "Started form", icon: FileInput, tone: "text-violet-600 bg-violet-500/10 dark:text-violet-400" },
  field_capture: { label: "Filled field", icon: TextCursorInput, tone: "text-indigo-600 bg-indigo-500/10 dark:text-indigo-400" },
  form_abandon: { label: "Abandoned form", icon: LogOut, tone: "text-amber-600 bg-amber-500/10 dark:text-amber-400" },
  form_submit: { label: "Submitted form", icon: Send, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  conversion: { label: "Converted", icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-500/15 dark:text-emerald-300" },
  custom: { label: "Custom event", icon: Sparkles, tone: "text-pink-600 bg-pink-500/10 dark:text-pink-400" },
  email_open: { label: "Opened email", icon: MailOpen, tone: "text-teal-600 bg-teal-500/10 dark:text-teal-400" },
  email_click: { label: "Clicked email link", icon: ExternalLink, tone: "text-teal-700 bg-teal-500/15 dark:text-teal-300" },
}

export function eventMeta(type: string) {
  return EVENT_META[type] ?? { label: humanize(type), icon: MousePointerClick, tone: "text-muted-foreground bg-muted" }
}

function eventSource(e: TrackingEvent) {
  if (e.gclid) return "google"
  if (e.fbclid) return "meta"
  return null
}

export function EventRow({
  event,
  wid,
  showContact = true,
  absoluteTime,
}: {
  event: TrackingEvent
  wid: string
  showContact?: boolean
  absoluteTime?: boolean
}) {
  const meta = eventMeta(event.type)
  const source = eventSource(event)
  const detail =
    event.type === "field_capture"
      ? `${event.fieldName ?? "field"}${event.fieldValue ? `: ${event.fieldValue}` : ""}`
      : event.pagePath || event.pageUrl || ""
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", meta.tone)}>
        <meta.icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{meta.label}</span>
          {source ? <PlatformIcon platform={source} className="size-3.5" /> : null}
          {event.utm?.campaign ? (
            <span className="truncate text-xs text-muted-foreground">· {event.utm.campaign}</span>
          ) : null}
          {event.value ? <span className="text-xs font-medium text-emerald-600">· value {event.value}</span> : null}
        </div>
        {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
        {showContact && event.contactId ? (
          <Link href={`/w/${wid}/contacts/${event.contactId}`} className="text-xs text-primary hover:underline">
            View contact
          </Link>
        ) : null}
      </div>
      <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
        {absoluteTime ? formatDateTime(event.createdAt) : timeAgo(event.createdAt)}
      </time>
    </div>
  )
}

export function EventList({
  events,
  wid,
  showContact,
  absoluteTime,
}: {
  events: TrackingEvent[]
  wid: string
  showContact?: boolean
  absoluteTime?: boolean
}) {
  return (
    <div className="divide-y">
      {events.map((e) => (
        <EventRow key={e.id} event={e} wid={wid} showContact={showContact} absoluteTime={absoluteTime} />
      ))}
    </div>
  )
}
