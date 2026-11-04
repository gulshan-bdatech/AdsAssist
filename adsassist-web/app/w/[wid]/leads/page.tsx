"use client"

import { useDeferredValue, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Search, Users } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AddLeadDialog } from "@/components/app/add-lead-dialog"
import { LeadTable } from "@/components/app/lead-table"
import { PageHeader } from "@/components/app/page-header"
import { Pagination } from "@/components/app/pagination"
import { DateRangeFilter } from "@/components/app/range-filter"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { api } from "@/lib/api"
import { usePipeline } from "@/lib/hooks"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

const PAGE_SIZE = 25

export default function LeadsPage() {
  const { wid, canAnalyze } = useWorkspace()
  const { from, to, update } = useRangeParams()
  const params = useSearchParams()
  const stage = params.get("stage") ?? ""
  const channel = params.get("channel") ?? ""
  const campaignId = params.get("campaignId") ?? ""
  const page = Number(params.get("page") ?? "1") || 1
  const [search, setSearch] = useState("")
  const q = useDeferredValue(search.trim())
  const pipeline = usePipeline(wid)

  const leads = useQuery({
    queryKey: ["ws", wid, "leads", { from, to, stage, channel, campaignId, q, page }],
    queryFn: () =>
      api.leads(wid, {
        from,
        to,
        stage: stage || undefined,
        channel: channel || undefined,
        campaignId: campaignId || undefined,
        search: q || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Every lead from your pixel, CRM and manual entry, with the ad that brought it in"
        actions={
          <>
            <DateRangeFilter />
            {canAnalyze ? <AddLeadDialog /> : null}
          </>
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name, email or phone"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              if (page !== 1) update({ page: undefined })
            }}
          />
        </div>
        <Select value={stage || "all"} onValueChange={(v) => update({ stage: v === "all" ? undefined : v, page: undefined })}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {(pipeline.data ?? []).map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={channel || "all"} onValueChange={(v) => update({ channel: v === "all" ? undefined : v, page: undefined })}>
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="google">Google Ads</SelectItem>
            <SelectItem value="meta">Meta Ads</SelectItem>
            <SelectItem value="organic">Organic</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent>
          {leads.isPending ? (
            <TableSkeleton />
          ) : leads.isError ? (
            <ErrorState error={leads.error} onRetry={() => leads.refetch()} />
          ) : leads.data.items.length ? (
            <>
              <LeadTable leads={leads.data.items} editableStage />
              <Pagination
                page={leads.data.page}
                pageSize={leads.data.pageSize}
                total={leads.data.total}
                onPageChange={(p) => update({ page: p === 1 ? undefined : String(p) })}
              />
            </>
          ) : (
            <EmptyState
              icon={Users}
              title="No leads match these filters"
              description="Leads arrive from the tracking pixel (form submits), the server lead API, or the Add lead button."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
