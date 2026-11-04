"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Laptop, Smartphone, Tablet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { PlatformBadge, StatusBadge, consentLabel } from "@/components/app/badges"
import { EventList } from "@/components/app/event-list"
import { LeadTable } from "@/components/app/lead-table"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states"
import { api, type Touch } from "@/lib/api"
import { formatDateTime, humanize, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { wid } = useWorkspace()
  const detail = useQuery({ queryKey: ["ws", wid, "contact", id], queryFn: () => api.contact(wid, id) })

  if (detail.isPending) return <PageSkeleton />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />

  const { contact: c, attributes, devices, events, leads } = detail.data
  const attrs = Object.entries(attributes ?? {})

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/w/${wid}/contacts`}>
          <ArrowLeft /> Contacts
        </Link>
      </Button>
      <PageHeader
        title={c.name || c.email || c.phone || "Anonymous visitor"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            <span>First seen {formatDateTime(c.createdAt)}</span>
            <span>· last seen {timeAgo(c.lastSeenAt)}</span>
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="space-y-3">
              <Row label="Email" value={c.email} />
              <Row label="Phone" value={c.phone} />
              <Row label="Events" value={String(c.eventCount)} />
              <Row label="Country" value={c.country || null} />
              <Row label="Marketing consent" value={consentLabel(c.consent)} />
            </dl>
            <div className="space-y-1.5">
              <div className="flex justify-between text-muted-foreground">
                <span>Intent score</span>
                <span className="font-medium text-foreground tabular-nums">{c.intentScore}/100</span>
              </div>
              <Progress value={c.intentScore} />
            </div>
            {attrs.length ? (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Form answers</p>
                {attrs.map(([k, v]) => (
                  <Row key={k} label={humanize(k)} value={v} />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Touchpoints</CardTitle>
            <CardDescription>How they found you</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TouchBlock title="First touch" touch={c.firstTouch} />
            <TouchBlock title="Last touch" touch={c.lastTouch} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Devices ({devices.length})</CardTitle>
            <CardDescription>Browsers linked to this person</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {devices.length ? (
              devices.map((d) => {
                const Icon = d.platform === "mobile" ? Smartphone : d.platform === "tablet" ? Tablet : Laptop
                return (
                  <div key={d.deviceKey} className="flex items-start gap-3 rounded-lg border p-3">
                    <Icon className="mt-0.5 size-4 text-muted-foreground" />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">
                        {[humanize(d.os ?? ""), humanize(d.platform ?? "")].filter((x) => x !== "—").join(" · ") || "Unknown device"}
                        {d.screenRes ? <span className="text-muted-foreground"> · {d.screenRes}</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={d.userAgent ?? ""}>
                        {d.userAgent ?? d.deviceKey}
                      </p>
                      <p className="text-xs text-muted-foreground">Last seen {timeAgo(d.lastSeenAt)}</p>
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-sm text-muted-foreground">No devices recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leads ({leads.length})</CardTitle>
        </CardHeader>
        <CardContent>{leads.length ? <LeadTable leads={leads} /> : <EmptyState title="No leads from this contact" />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journey</CardTitle>
          <CardDescription>Every tracked event, newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length ? <EventList events={events} wid={wid} showContact={false} absoluteTime /> : <EmptyState title="No events" />}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{value || "—"}</dd>
    </div>
  )
}

function TouchBlock({ title, touch }: { title: string; touch: Touch | null }) {
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        {touch?.channel ? <PlatformBadge platform={touch.channel} short /> : null}
      </div>
      {touch ? (
        <dl className="space-y-1 text-xs">
          <Row label="Campaign" value={touch.campaign} />
          <Row label="Source / medium" value={[touch.source, touch.medium].filter(Boolean).join(" / ") || null} />
          {touch.gclid ? <Row label="gclid" value={touch.gclid} /> : null}
          {touch.fbclid ? <Row label="fbclid" value={touch.fbclid} /> : null}
          <Row label="When" value={formatDateTime(touch.at)} />
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">Direct / unknown</p>
      )}
    </div>
  )
}
