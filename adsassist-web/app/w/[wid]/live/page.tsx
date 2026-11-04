"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Activity, Coins, MousePointerClick, Pause, Play, Target, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CampaignTable } from "@/components/app/campaign-table"
import { EventList } from "@/components/app/event-list"
import { KpiCard } from "@/components/app/kpi-card"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states"
import { SyncNowButton } from "@/components/app/sync-button"
import { api, type TrackingEvent } from "@/lib/api"
import { formatMoney, formatNumber, pctChange, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"
import { cn } from "@/lib/utils"

const MAX_EVENTS = 100

export default function LivePage() {
  const { wid, currency } = useWorkspace()
  const live = useQuery({
    queryKey: ["ws", wid, "live"],
    queryFn: () => api.live(wid),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  const feed = useEventStream(wid, live.data?.recentEvents)

  const today = live.data?.today
  const yesterday = live.data?.yesterday

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Live
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
          </span>
        }
        description={
          live.data?.nextSyncAt
            ? `Today’s numbers, refreshed every 30 seconds. Next platform sync in about ${timeAgo(live.data.nextSyncAt).replace(" ago", "")}.`
            : "Today’s numbers, refreshed every 30 seconds."
        }
        actions={<SyncNowButton lastSyncedAt={live.data?.lastSyncedAt} />}
      />

      {live.isPending ? (
        <PageSkeleton />
      ) : live.isError ? (
        <ErrorState error={live.error} onRetry={() => live.refetch()} />
      ) : today && yesterday ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Spend today"
              icon={Coins}
              value={formatMoney(today.spend, currency)}
              change={pctChange(today.spend, yesterday.spend)}
              hint="Compared with yesterday"
            />
            <KpiCard
              label="Clicks today"
              icon={MousePointerClick}
              value={formatNumber(today.clicks)}
              change={pctChange(today.clicks, yesterday.clicks)}
              hint="Compared with yesterday"
            />
            <KpiCard
              label="Leads today"
              icon={Users}
              value={formatNumber(today.leads)}
              change={pctChange(today.leads, yesterday.leads)}
              hint="Compared with yesterday"
            />
            <KpiCard
              label="Cost per lead today"
              icon={Target}
              value={formatMoney(today.cpl, currency)}
              change={pctChange(today.cpl, yesterday.cpl)}
              invert
              hint="Compared with yesterday"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader>
                <CardTitle>Active campaigns</CardTitle>
                <CardDescription>Running right now, with today’s numbers</CardDescription>
              </CardHeader>
              <CardContent>
                {live.data.activeCampaigns.length ? (
                  <CampaignTable wid={wid} rows={live.data.activeCampaigns} currency={currency} compact />
                ) : (
                  <EmptyState title="No active campaigns" description="Campaigns that are enabled on Google or Meta show up here." />
                )}
              </CardContent>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-4" /> Visitor activity
                </CardTitle>
                <CardDescription>Events from your tracking pixel as they happen</CardDescription>
                <CardAction>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-normal",
                        feed.status === "open" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                      )}
                    >
                      {feed.paused ? "Paused" : feed.status === "open" ? "Streaming" : feed.status === "error" ? "Reconnecting…" : "Connecting…"}
                    </Badge>
                    <Button variant="ghost" size="icon-sm" onClick={feed.togglePause} aria-label={feed.paused ? "Resume" : "Pause"}>
                      {feed.paused ? <Play /> : <Pause />}
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                {feed.events.length ? (
                  <ScrollArea className="h-[480px] pr-3">
                    <EventList events={feed.events} wid={wid} />
                  </ScrollArea>
                ) : (
                  <EmptyState title="Waiting for visitors" description="Install the pixel on your landing pages to see events here." />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}

function useEventStream(wid: string, initial: TrackingEvent[] | undefined) {
  const [events, setEvents] = useState<TrackingEvent[]>([])
  const [status, setStatus] = useState<"connecting" | "open" | "error">("connecting")
  const [paused, setPaused] = useState(false)
  const seeded = useRef(false)

  // Seed once from the snapshot; the stream adds newer events on top.
  useEffect(() => {
    if (seeded.current || !initial) return
    seeded.current = true
    setEvents((prev) => mergeEvents(prev, initial))
  }, [initial])

  useEffect(() => {
    if (paused) return
    const source = new EventSource(api.eventStreamUrl(wid))
    source.onopen = () => setStatus("open")
    source.onerror = () => setStatus("error")
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as TrackingEvent
        if (!event?.id) return
        setEvents((prev) => mergeEvents([event], prev))
      } catch {
        // ignore keep-alives and malformed frames
      }
    }
    return () => source.close()
  }, [wid, paused])

  return { events, status, paused, togglePause: () => setPaused((p) => !p) }
}

function mergeEvents(newer: TrackingEvent[], older: TrackingEvent[]) {
  const seen = new Set<string>()
  const out: TrackingEvent[] = []
  for (const e of [...newer, ...older]) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
    if (out.length >= MAX_EVENTS) break
  }
  return out
}
