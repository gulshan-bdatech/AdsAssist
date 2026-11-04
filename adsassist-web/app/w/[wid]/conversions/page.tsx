"use client"

import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Clock, Send, SkipForward, XCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlatformIcon } from "@/components/app/badges"
import { ConversionTable } from "@/components/app/conversion-table"
import { KpiCard } from "@/components/app/kpi-card"
import { PageHeader } from "@/components/app/page-header"
import { Pagination } from "@/components/app/pagination"
import { DateRangeFilter } from "@/components/app/range-filter"
import { CardGridSkeleton, EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { api } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

export default function ConversionsPage() {
  const { wid } = useWorkspace()
  const { from, to, update } = useRangeParams()
  const params = useSearchParams()
  const status = params.get("status") ?? ""
  const platform = params.get("platform") ?? ""
  const page = Number(params.get("page") ?? "1") || 1

  const stats = useQuery({
    queryKey: ["ws", wid, "conversion-stats", from, to],
    queryFn: () => api.conversionStats(wid, { from, to }),
  })
  const list = useQuery({
    queryKey: ["ws", wid, "conversions", { status, platform, page }],
    queryFn: () => api.conversions(wid, { status: status || undefined, platform: platform || undefined, page, pageSize: 25 }),
    placeholderData: (prev) => prev,
  })

  const s = stats.data
  const successRate = s && s.sent + s.failed > 0 ? (s.sent / (s.sent + s.failed)) * 100 : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conversions"
        description="Lead outcomes sent back to Google Ads and Meta so their bidding learns which clicks turn into customers"
        actions={<DateRangeFilter />}
      />

      {stats.isPending ? (
        <CardGridSkeleton />
      ) : stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
      ) : s ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Sent" icon={CheckCircle2} value={formatNumber(s.sent)} hint={successRate !== null ? `${successRate.toFixed(0)}% success rate` : `${formatNumber(s.total)} total`} />
          <KpiCard label="Failed" icon={XCircle} value={formatNumber(s.failed)} hint="Retried automatically with back-off" />
          <KpiCard label="Pending" icon={Clock} value={formatNumber(s.pending)} hint="Waiting in the queue" />
          <KpiCard label="Skipped" icon={SkipForward} value={formatNumber(s.skipped)} hint="Missing click ID, pixel or conversion action" />
        </div>
      ) : null}

      {s && s.byPlatform.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {s.byPlatform.map((p) => (
            <Card key={p.platform} className="gap-2 py-4">
              <CardContent className="flex items-center justify-between px-4">
                <span className="flex items-center gap-2 font-medium">
                  <PlatformIcon platform={p.platform} /> {p.platform === "google" ? "Google Ads" : "Meta CAPI"}
                </span>
                <span className="text-sm tabular-nums">
                  <span className="text-emerald-600 dark:text-emerald-400">{formatNumber(p.sent)} sent</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-red-600 dark:text-red-400">{formatNumber(p.failed)} failed</span>
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Push log</CardTitle>
            <CardDescription>Most recent first</CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={status || "all"} onValueChange={(v) => update({ status: v === "all" ? undefined : v, page: undefined })}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Select value={platform || "all"} onValueChange={(v) => update({ platform: v === "all" ? undefined : v, page: undefined })}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                <SelectItem value="google">Google Ads</SelectItem>
                <SelectItem value="meta">Meta</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <TableSkeleton />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.items.length ? (
            <>
              <ConversionTable rows={list.data.items} />
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                onPageChange={(p) => update({ page: p === 1 ? undefined : String(p) })}
              />
            </>
          ) : (
            <EmptyState
              icon={Send}
              title="No conversions sent yet"
              description="Mark pipeline stages as “send to platforms” in Settings → Pipeline, and set a Meta pixel / Google conversion action on your ad accounts."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
