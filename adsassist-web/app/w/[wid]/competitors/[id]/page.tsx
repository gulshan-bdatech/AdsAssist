"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, ExternalLink, Swords } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdLibraryNotice } from "@/components/app/ad-library-notice"
import { StatusBadge } from "@/components/app/badges"
import { PageHeader } from "@/components/app/page-header"
import { Pagination } from "@/components/app/pagination"
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/app/states"
import { api, type CompetitorAd } from "@/lib/api"
import { countryName } from "@/lib/countries"
import { formatDate, humanize, timeAgo } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

export default function CompetitorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { wid } = useWorkspace()
  const params = useSearchParams()
  const { update } = useRangeParams()
  const page = Number(params.get("page") ?? "1") || 1
  const active = params.get("active") !== "all"

  const watches = useQuery({ queryKey: ["ws", wid, "competitors"], queryFn: () => api.competitors(wid) })
  const ads = useQuery({
    queryKey: ["ws", wid, "competitors", id, "ads", { page, active }],
    queryFn: () => api.competitorAds(wid, id, { page, pageSize: 24, active: active || undefined }),
    placeholderData: (prev) => prev,
  })
  const watch = watches.data?.find((w) => w.id === id)

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/w/${wid}/competitors`}>
          <ArrowLeft /> Competitors
        </Link>
      </Button>
      <PageHeader
        title={watch?.name ?? "Competitor"}
        description={
          watch ? `${watch.countries.map(countryName).join(", ")} · checked ${timeAgo(watch.lastFetchedAt)}` : undefined
        }
        actions={
          <Select value={active ? "active" : "all"} onValueChange={(v) => update({ active: v === "all" ? "all" : undefined, page: undefined })}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Running now</SelectItem>
              <SelectItem value="all">All ads seen</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {watch?.lastError ? <p className="text-sm text-red-600 dark:text-red-400">{watch.lastError}</p> : null}

      {ads.isPending ? (
        <CardGridSkeleton count={6} />
      ) : ads.isError ? (
        <ErrorState error={ads.error} onRetry={() => ads.refetch()} />
      ) : ads.data.items.length ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ads.data.items.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </div>
          <Pagination
            page={ads.data.page}
            pageSize={ads.data.pageSize}
            total={ads.data.total}
            onPageChange={(p) => update({ page: p === 1 ? undefined : String(p) })}
          />
        </>
      ) : (
        <>
          <EmptyState
            icon={Swords}
            title={active ? "No running ads found" : "No ads found"}
            description="Either nothing is running in these countries, or the Ad Library API doesn't cover these ads (see below)."
          />
          <AdLibraryNotice />
        </>
      )}
    </div>
  )
}

function AdCard({ ad }: { ad: CompetitorAd }) {
  return (
    <Card className="gap-3">
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium">{ad.pageName}</p>
          {ad.active ? <StatusBadge status="active" label="Running" /> : <StatusBadge status="paused" label="Stopped" />}
        </div>
        <p className="text-xs text-muted-foreground">
          Since {formatDate(ad.startedAt)}
          {ad.stoppedAt ? ` · until ${formatDate(ad.stoppedAt)}` : ""}
        </p>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 text-sm">
        {ad.titles[0] ? <p className="font-medium">{ad.titles[0]}</p> : null}
        {ad.bodies[0] ? <p className="line-clamp-6 whitespace-pre-line text-muted-foreground">{ad.bodies[0]}</p> : null}
        {ad.descriptions[0] ? <p className="line-clamp-2 text-xs text-muted-foreground">{ad.descriptions[0]}</p> : null}
        {ad.bodies.length > 1 ? <p className="text-xs text-muted-foreground">+{ad.bodies.length - 1} more variations</p> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {ad.platforms.map((p) => (
            <Badge key={p} variant="outline" className="font-normal">
              {humanize(p.toLowerCase())}
            </Badge>
          ))}
        </div>
        {ad.snapshotUrl ? (
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <a href={ad.snapshotUrl} target="_blank" rel="noreferrer">
              View in Ad Library <ExternalLink />
            </a>
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
