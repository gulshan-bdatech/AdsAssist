"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Coins, ExternalLink, ImageOff, MousePointerClick, Percent, Target, TrendingUp, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PlatformBadge, StatusBadge } from "@/components/app/badges"
import { PerformanceChart } from "@/components/app/charts"
import { KpiCard } from "@/components/app/kpi-card"
import { LeadTable } from "@/components/app/lead-table"
import { PageHeader } from "@/components/app/page-header"
import { DateRangeFilter } from "@/components/app/range-filter"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states"
import { api, type AdRow } from "@/lib/api"
import { formatMoney, formatNumber, formatPercent, formatRatio, humanize } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { wid, currency } = useWorkspace()
  const { range } = useRangeParams()
  const detail = useQuery({
    queryKey: ["ws", wid, "campaign", id, range.from, range.to],
    queryFn: () => api.campaign(wid, id, { from: range.from, to: range.to }),
  })

  if (detail.isPending) return <PageSkeleton />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />

  const { campaign: c, timeseries, adGroups, ads, recentLeads } = detail.data
  const groupName = (ext: string) => adGroups.find((g) => g.externalId === ext)?.name

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/w/${wid}/campaigns`}>
          <ArrowLeft /> Campaigns
        </Link>
      </Button>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PlatformBadge platform={c.platform} />
            <StatusBadge status={c.status} label={humanize(c.rawStatus || c.status)} />
            <span>{c.adAccountName}</span>
            {c.objective ? <Badge variant="secondary">{humanize(c.objective)}</Badge> : null}
            {c.dailyBudget ? <span>· Budget {formatMoney(c.dailyBudget, currency)}/day</span> : null}
            <span className="font-mono text-xs">ID {c.externalId}</span>
          </span>
        }
        actions={<DateRangeFilter />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Spend" icon={Coins} value={formatMoney(c.spend, currency)} />
        <KpiCard label="Clicks" icon={MousePointerClick} value={formatNumber(c.clicks)} hint={`${formatNumber(c.impressions)} impressions`} />
        <KpiCard label="CTR" icon={Percent} value={formatPercent(c.ctr)} hint={`CPC ${formatMoney(c.cpc, currency)}`} />
        <KpiCard label="Leads" icon={Users} value={formatNumber(c.leads)} hint={`${formatNumber(c.conversions)} platform conversions`} />
        <KpiCard label="Cost per lead" icon={Target} value={formatMoney(c.cpl, currency)} hint={`${formatNumber(c.wonLeads)} won`} />
        <KpiCard label="ROAS" icon={TrendingUp} value={formatRatio(c.roas)} hint={`${formatMoney(c.revenue, currency)} revenue`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily performance</CardTitle>
          <CardDescription>Spend and leads for this campaign</CardDescription>
        </CardHeader>
        <CardContent>
          {timeseries.length ? (
            <PerformanceChart data={timeseries} currency={currency} split={false} />
          ) : (
            <EmptyState title="No data in this range" />
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="ads">
        <TabsList>
          <TabsTrigger value="ads">Ads ({ads.length})</TabsTrigger>
          <TabsTrigger value="groups">{c.platform === "meta" ? "Ad sets" : "Ad groups"} ({adGroups.length})</TabsTrigger>
          <TabsTrigger value="leads">Recent leads ({recentLeads.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="ads" className="pt-2">
          {ads.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ads.map((ad) => (
                <AdCard key={ad.id} ad={ad} currency={currency} groupName={groupName(ad.adGroupExternalId)} />
              ))}
            </div>
          ) : (
            <EmptyState title="No ads synced for this campaign" />
          )}
        </TabsContent>
        <TabsContent value="groups" className="pt-2">
          <Card>
            <CardContent>
              {adGroups.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">CPL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adGroups.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.name}</TableCell>
                        <TableCell>
                          <StatusBadge status={g.status.toLowerCase()} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(g.spend, currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(g.clicks)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(g.ctr)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(g.leads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(g.cpl, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState title="No ad groups synced" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="leads" className="pt-2">
          <Card>
            <CardContent>
              {recentLeads.length ? <LeadTable leads={recentLeads} /> : <EmptyState title="No leads attributed to this campaign yet" />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AdCard({ ad, currency, groupName }: { ad: AdRow; currency: string; groupName?: string }) {
  return (
    <Card className="overflow-hidden pt-0">
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
        {ad.imageUrl ? (
          // Creative URLs come from many CDNs, so a plain img avoids next/image domain config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt={ad.headline ?? ad.name} className="size-full object-cover" loading="lazy" />
        ) : (
          <ImageOff className="size-6 text-muted-foreground" />
        )}
      </div>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-2 text-base">{ad.headline || ad.name}</CardTitle>
          <StatusBadge status={ad.status.toLowerCase()} />
        </div>
        {groupName ? <CardDescription className="truncate">{groupName}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {ad.body ? <p className="line-clamp-3 text-sm text-muted-foreground">{ad.body}</p> : null}
        {ad.finalUrl ? (
          <a href={ad.finalUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-xs text-primary hover:underline">
            <ExternalLink className="size-3 shrink-0" />
            <span className="truncate">{ad.finalUrl}</span>
          </a>
        ) : null}
        <dl className="grid grid-cols-4 gap-2 border-t pt-3 text-sm">
          <Mini label="Spend" value={formatMoney(ad.spend, currency, true)} />
          <Mini label="Clicks" value={formatNumber(ad.clicks, true)} />
          <Mini label="CTR" value={formatPercent(ad.ctr, 1)} />
          <Mini label="Leads" value={formatNumber(ad.leads)} />
        </dl>
      </CardContent>
    </Card>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value}</dd>
    </div>
  )
}
