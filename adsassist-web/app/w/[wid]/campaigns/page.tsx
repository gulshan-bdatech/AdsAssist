"use client"

import { useDeferredValue, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Megaphone, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CampaignTable } from "@/components/app/campaign-table"
import { PageHeader } from "@/components/app/page-header"
import { DateRangeFilter, PlatformFilter } from "@/components/app/range-filter"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { api } from "@/lib/api"
import { formatMoney, formatNumber } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

export default function CampaignsPage() {
  const { wid, currency } = useWorkspace()
  const { range, update } = useRangeParams()
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search.trim())
  const params = useSearchParams()
  const tab = params.get("status") ?? "all"

  const campaigns = useQuery({
    queryKey: ["ws", wid, "campaigns", range, tab, deferredSearch],
    queryFn: () => api.campaigns(wid, { ...range, status: tab, search: deferredSearch || undefined }),
    placeholderData: (prev) => prev,
  })

  const rows = campaigns.data ?? []
  const spend = rows.reduce((s, r) => s + r.spend, 0)
  const leads = rows.reduce((s, r) => s + r.leads, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Live campaign performance from Google Ads and Meta, joined with your leads"
        actions={
          <>
            <PlatformFilter />
            <DateRangeFilter />
          </>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={tab}
          onValueChange={(v) => update({ status: v === "all" ? undefined : v })}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="paused">Paused</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search campaigns" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card>
        <CardContent>
          {campaigns.isPending ? (
            <TableSkeleton />
          ) : campaigns.isError ? (
            <ErrorState error={campaigns.error} onRetry={() => campaigns.refetch()} />
          ) : rows.length ? (
            <>
              <CampaignTable wid={wid} rows={rows} currency={currency} />
              <p className="pt-3 text-xs text-muted-foreground">
                {rows.length} campaigns · {formatMoney(spend, currency)} spend · {formatNumber(leads)} leads
              </p>
            </>
          ) : (
            <EmptyState
              icon={Megaphone}
              title={deferredSearch ? "No campaigns match your search" : "No campaigns yet"}
              description="Campaigns appear after the first sync of a connected Google Ads or Meta account."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
