"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Lightbulb } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PlatformBadge } from "@/components/app/badges"
import { PageHeader } from "@/components/app/page-header"
import { DateRangeFilter, PlatformFilter } from "@/components/app/range-filter"
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/app/states"
import { api, type Insight } from "@/lib/api"
import { formatNumber, humanize } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"
import { cn } from "@/lib/utils"

const SEVERITY: Record<Insight["severity"], { label: string; icon: LucideIcon; tone: string; order: number }> = {
  critical: { label: "Critical", icon: AlertOctagon, tone: "text-red-600 bg-red-500/10 dark:text-red-400", order: 0 },
  warning: { label: "Needs attention", icon: AlertTriangle, tone: "text-amber-600 bg-amber-500/10 dark:text-amber-400", order: 1 },
  info: { label: "Worth a look", icon: Info, tone: "text-sky-600 bg-sky-500/10 dark:text-sky-400", order: 2 },
  success: { label: "Working well", icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400", order: 3 },
}

export default function InsightsPage() {
  const { wid } = useWorkspace()
  const { range } = useRangeParams()
  const insights = useQuery({ queryKey: ["ws", wid, "insights", range], queryFn: () => api.insights(wid, range) })

  const groups = (Object.keys(SEVERITY) as Insight["severity"][])
    .map((sev) => ({ sev, items: (insights.data ?? []).filter((i) => i.severity === sev) }))
    .filter((g) => g.items.length)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        description="Automatic checks on spend, cost per lead and conversion tracking"
        actions={
          <>
            <PlatformFilter />
            <DateRangeFilter />
          </>
        }
      />
      {insights.isPending ? (
        <CardGridSkeleton count={6} />
      ) : insights.isError ? (
        <ErrorState error={insights.error} onRetry={() => insights.refetch()} />
      ) : groups.length ? (
        groups.map(({ sev, items }) => {
          const meta = SEVERITY[sev]
          return (
            <section key={sev} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <meta.icon className="size-4" /> {meta.label} ({items.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((i) => (
                  <Card key={i.id} className="gap-3">
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", meta.tone)}>
                          <meta.icon className="size-4" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <CardTitle className="text-base leading-snug">{i.title}</CardTitle>
                          {i.platform ? <PlatformBadge platform={i.platform} short /> : null}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <CardDescription>{i.detail}</CardDescription>
                      {i.metric && i.value !== undefined ? (
                        <div className="flex gap-4 rounded-lg bg-muted/50 p-2 text-xs">
                          <span>
                            {humanize(i.metric)}: <b className="tabular-nums">{formatNumber(i.value)}</b>
                          </span>
                          {i.benchmark !== undefined ? (
                            <span className="text-muted-foreground">
                              benchmark <span className="tabular-nums">{formatNumber(i.benchmark)}</span>
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {i.campaignId ? (
                        <Link href={`/w/${wid}/campaigns/${i.campaignId}`} className="text-sm text-primary hover:underline">
                          Open campaign →
                        </Link>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )
        })
      ) : (
        <EmptyState
          icon={Lightbulb}
          title="Nothing to flag"
          description="Insights appear once there is enough spend and lead data in the selected range."
        />
      )}
    </div>
  )
}
