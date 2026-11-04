"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  Banknote,
  Coins,
  MousePointerClick,
  Percent,
  Target,
  Trophy,
  TrendingUp,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AiSummaryCard } from "@/components/app/ai-summary-card"
import { CampaignTable } from "@/components/app/campaign-table"
import { FunnelBars, PerformanceChart, PlatformSplit } from "@/components/app/charts"
import { ConnectBanner } from "@/components/app/connect-banner"
import { KpiCard } from "@/components/app/kpi-card"
import { PageHeader } from "@/components/app/page-header"
import { DateRangeFilter, PlatformFilter } from "@/components/app/range-filter"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states"
import { SyncNowButton } from "@/components/app/sync-button"
import { api } from "@/lib/api"
import { formatMoney, formatNumber, formatPercent, formatRatio, pctChange } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

export default function DashboardPage() {
  const { wid, workspace } = useWorkspace()
  const { range, platform } = useRangeParams()
  const overview = useQuery({
    queryKey: ["ws", wid, "overview", range],
    queryFn: () => api.overview(wid, range),
  })

  const data = overview.data
  const currency = data?.currency || workspace.currency
  const t = data?.totals
  const p = data?.previous

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Ad performance and lead outcomes for ${workspace.name}`}
        actions={
          <>
            <SyncNowButton lastSyncedAt={data?.lastSyncedAt} />
            <PlatformFilter />
            <DateRangeFilter />
          </>
        }
      />

      <ConnectBanner />
      <AiSummaryCard />

      {overview.isPending ? (
        <PageSkeleton />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : t && p && data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Spend" icon={Coins} value={formatMoney(t.spend, currency)} change={pctChange(t.spend, p.spend)} />
            <KpiCard label="Leads" icon={Users} value={formatNumber(t.leads)} change={pctChange(t.leads, p.leads)} />
            <KpiCard
              label="Cost per lead"
              icon={Target}
              value={formatMoney(t.cpl, currency)}
              change={pctChange(t.cpl, p.cpl)}
              invert
            />
            <KpiCard
              label="Revenue (won leads)"
              icon={Banknote}
              value={formatMoney(t.revenue, currency)}
              change={pctChange(t.revenue, p.revenue)}
            />
            <KpiCard label="ROAS" icon={TrendingUp} value={formatRatio(t.roas)} change={pctChange(t.roas, p.roas)} />
            <KpiCard label="CTR" icon={Percent} value={formatPercent(t.ctr)} change={pctChange(t.ctr, p.ctr)} />
            <KpiCard
              label="Platform conversions"
              icon={MousePointerClick}
              value={formatNumber(t.conversions)}
              change={pctChange(t.conversions, p.conversions)}
            />
            <KpiCard label="Won leads" icon={Trophy} value={formatNumber(t.wonLeads)} change={pctChange(t.wonLeads, p.wonLeads)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Spend and leads</CardTitle>
                <CardDescription>
                  Daily spend {platform ? "" : "by platform "}with leads captured
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.timeseries.length ? (
                  <PerformanceChart data={data.timeseries} currency={currency} split={!platform} />
                ) : (
                  <EmptyState title="No data in this range" className="h-72" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Platform split</CardTitle>
                <CardDescription>Where the budget went</CardDescription>
              </CardHeader>
              <CardContent>
                {data.byPlatform.length ? (
                  <PlatformSplit rows={data.byPlatform} currency={currency} />
                ) : (
                  <EmptyState title="No platform data yet" />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Lead funnel</CardTitle>
                <CardDescription>Leads created in this range, by pipeline stage</CardDescription>
              </CardHeader>
              <CardContent>
                {data.funnel.some((s) => s.count > 0) ? (
                  <FunnelBars stages={data.funnel} />
                ) : (
                  <EmptyState
                    title="No leads yet"
                    description="Install the tracking pixel or send leads from your CRM."
                    action={
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/w/${wid}/tracking`}>Set up tracking</Link>
                      </Button>
                    }
                  />
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Top campaigns</CardTitle>
                <CardDescription>By spend in this range</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/w/${wid}/campaigns`}>
                      All campaigns <ArrowRight />
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {data.topCampaigns.length ? (
                  <CampaignTable wid={wid} rows={data.topCampaigns} currency={currency} compact />
                ) : (
                  <EmptyState title="No campaigns with spend in this range" />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
