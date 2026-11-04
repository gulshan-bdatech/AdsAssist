"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Loader2, Plus, RefreshCw, Swords, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdLibraryNotice } from "@/components/app/ad-library-notice"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { MultiSelect } from "@/components/app/multi-select"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { TagInput } from "@/components/app/tag-input"
import { api, type CompetitorWatch } from "@/lib/api"
import { COUNTRIES, countryName } from "@/lib/countries"
import { formatNumber, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export default function CompetitorsPage() {
  const { wid, canAnalyze } = useWorkspace()
  const [adding, setAdding] = useState(false)
  const list = useQuery({ queryKey: ["ws", wid, "competitors"], queryFn: () => api.competitors(wid) })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Competitors"
        description="Watch which ads your competitors are running on Facebook and Instagram, via Meta's Ad Library"
        actions={
          canAnalyze ? (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Watch competitor
            </Button>
          ) : null
        }
      />

      <AdLibraryNotice />

      {list.isPending ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((w) => (
            <WatchCard key={w.id} watch={w} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Swords}
          title="No competitors yet"
          description="Add a competitor's Facebook page ID or a search term, and the countries to look in."
          action={
            canAnalyze ? (
              <Button onClick={() => setAdding(true)}>
                <Plus /> Watch competitor
              </Button>
            ) : null
          }
        />
      )}

      {adding ? <AddCompetitorDialog onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

function WatchCard({ watch: w }: { watch: CompetitorWatch }) {
  const { wid, canAnalyze } = useWorkspace()
  const qc = useQueryClient()
  const refresh = useMutation({
    mutationFn: () => api.refreshCompetitor(wid, w.id),
    onSuccess: () => {
      toast.success("Refresh queued")
      setTimeout(() => qc.invalidateQueries({ queryKey: ["ws", wid, "competitors"] }), 5_000)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteCompetitor(wid, w.id),
    onSuccess: () => {
      toast.success("Competitor removed")
      qc.invalidateQueries({ queryKey: ["ws", wid, "competitors"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link href={`/w/${wid}/competitors/${w.id}`} className="hover:underline">
            {w.name}
          </Link>
        </CardTitle>
        <CardDescription className="truncate">
          {[w.pageIds.length ? `${w.pageIds.length} page${w.pageIds.length > 1 ? "s" : ""}` : null, w.searchTerms ? `"${w.searchTerms}"` : null]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
        {canAnalyze ? (
          <CardAction className="flex gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="Refresh">
              {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
            <ConfirmDialog
              title={`Stop watching ${w.name}?`}
              description="Saved ads for this competitor are deleted."
              confirmLabel="Remove"
              onConfirm={() => remove.mutate()}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label="Remove">
                  <Trash2 />
                </Button>
              }
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Active ads</p>
            <p className="text-xl font-semibold tabular-nums">{formatNumber(w.activeAdCount)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Seen in total</p>
            <p className="text-xl font-semibold tabular-nums">{formatNumber(w.adCount)}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {w.countries.map(countryName).join(", ")} · checked {timeAgo(w.lastFetchedAt)}
        </p>
        {w.lastError ? (
          <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w.lastError}
          </p>
        ) : null}
        <Button variant="outline" size="sm" asChild className="w-full">
          <Link href={`/w/${wid}/competitors/${w.id}`}>View ads</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function AddCompetitorDialog({ onClose }: { onClose: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [pageIds, setPageIds] = useState<string[]>([])
  const [searchTerms, setSearchTerms] = useState("")
  const [countries, setCountries] = useState<string[]>(["IN"])
  const create = useMutation({
    mutationFn: () =>
      api.createCompetitor(wid, {
        name: name.trim(),
        pageIds: pageIds.length ? pageIds : undefined,
        searchTerms: searchTerms.trim() || undefined,
        countries,
      }),
    onSuccess: () => {
      toast.success("Competitor added. Ads load in a minute.")
      qc.invalidateQueries({ queryKey: ["ws", wid, "competitors"] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const valid = name.trim() && (pageIds.length || searchTerms.trim()) && countries.length

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Watch a competitor</DialogTitle>
            <DialogDescription>Give a Facebook page ID (most precise), a search term, or both.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="comp-name">Name</Label>
            <Input id="comp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Finance" required />
          </div>
          <div className="space-y-2">
            <Label>Facebook page IDs</Label>
            <TagInput value={pageIds} onChange={setPageIds} validate={(v) => /^\d{5,20}$/.test(v)} placeholder="e.g. 104958162837, press Enter" />
            <p className="text-xs text-muted-foreground">
              Find it on the page&apos;s About → Page transparency, or in the Ad Library URL (<code className="font-mono">view_all_page_id=</code>).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="comp-terms">Search terms</Label>
            <Input id="comp-terms" value={searchTerms} onChange={(e) => setSearchTerms(e.target.value)} placeholder="home loan" />
          </div>
          <div className="space-y-2">
            <Label>Countries</Label>
            <MultiSelect
              options={COUNTRIES.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))}
              value={countries}
              onChange={setCountries}
              placeholder="Choose countries"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Start watching
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
