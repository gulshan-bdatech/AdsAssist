"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, CopyPlus, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload, Users, X } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { CsvUpload } from "@/components/app/audiences/csv-upload"
import { AudiencePreviewCard, RuleBuilder, cleanRules } from "@/components/app/audiences/rule-builder"
import { AUDIENCE_TYPE_LABEL } from "@/components/app/audiences/shared"
import { PlatformIcon, StatusBadge } from "@/components/app/badges"
import { KpiCard } from "@/components/app/kpi-card"
import { PageHeader } from "@/components/app/page-header"
import { ErrorState, PageSkeleton } from "@/components/app/states"
import { api, type Audience, type AudienceRules } from "@/lib/api"
import { formatDateTime, formatNumber, humanize, timeAgo } from "@/lib/format"
import { useAdAccounts, usePipeline } from "@/lib/hooks"
import { COUNTRIES } from "@/lib/countries"
import { useWorkspace } from "@/lib/workspace"

export default function AudienceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { wid, canWrite } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [lookalike, setLookalike] = useState(false)
  const [uploading, setUploading] = useState(params.get("upload") === "1")

  const key = ["ws", wid, "audiences", id]
  const audience = useQuery({
    queryKey: key,
    queryFn: () => api.audience(wid, id),
    refetchInterval: (q) => (q.state.data?.destinations.some((d) => d.status === "syncing" || d.status === "pending") ? 5_000 : false),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ws", wid, "audiences"] })

  const sync = useMutation({
    mutationFn: () => api.syncAudience(wid, id),
    onSuccess: () => {
      toast.success("Sync queued")
      setTimeout(invalidate, 2_000)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const removeDest = useMutation({
    mutationFn: (adAccountId: string) => api.removeAudienceDestination(wid, id, adAccountId),
    onSuccess: () => {
      toast.success("Destination removed")
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const autoSync = useMutation({
    mutationFn: (v: boolean) => api.updateAudience(wid, id, { autoSync: v }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  if (audience.isPending) return <PageSkeleton />
  if (audience.isError) return <ErrorState error={audience.error} onRetry={() => audience.refetch()} />
  const a = audience.data
  const syncedMeta = a.destinations.filter((d) => d.platform === "meta" && d.externalAudienceId)

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/w/${wid}/audiences`}>
          <ArrowLeft /> Audiences
        </Link>
      </Button>
      <PageHeader
        title={a.name}
        description={
          <>
            {AUDIENCE_TYPE_LABEL[a.type]} · computed {timeAgo(a.lastComputedAt)}
            {a.description ? ` · ${a.description}` : ""}
          </>
        }
        actions={
          canWrite ? (
            <>
              {a.type === "upload" ? (
                <Button variant="outline" onClick={() => setUploading(true)}>
                  <Upload /> Upload CSV
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
              )}
              <Button onClick={() => sync.mutate()} disabled={sync.isPending || !a.destinations.length}>
                {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Sync now
              </Button>
              <DeleteAudience audience={a} onDeleted={() => router.replace(`/w/${wid}/audiences`)} />
            </>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="People" icon={Users} value={formatNumber(a.size)} hint="With an email or phone" />
        <KpiCard label="With email" value={formatNumber(a.emailCount)} />
        <KpiCard label="With phone" value={formatNumber(a.phoneCount)} />
        <KpiCard
          label="Matched on platforms"
          value={formatNumber(a.destinations.reduce((s, d) => s + (d.matchedCount ?? 0), 0))}
          hint="Reported by Google / Meta; can take up to 48 h"
        />
      </div>

      {uploading && a.type === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload members</CardTitle>
            <CardDescription>CSV with a header row. Up to 50,000 rows are sent per request.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="icon-sm" onClick={() => setUploading(false)} aria-label="Close upload">
                <X />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <CsvUpload audienceId={a.id} onDone={() => setUploading(false)} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Destinations</CardTitle>
          <CardDescription>Ad accounts this audience is uploaded to. Each sync replaces the list on the platform.</CardDescription>
          {canWrite ? (
            <CardAction className="flex flex-wrap gap-2">
              {syncedMeta.length ? (
                <Button variant="outline" size="sm" onClick={() => setLookalike(true)}>
                  <CopyPlus /> Lookalike
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> Add destination
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {a.destinations.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Uploaded</TableHead>
                  <TableHead className="text-right">Matched</TableHead>
                  <TableHead className="text-right">Last sync</TableHead>
                  {canWrite ? <TableHead className="w-12" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.destinations.map((d) => (
                  <TableRow key={d.adAccountId}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <PlatformIcon platform={d.platform} />
                        <span className="min-w-0">
                          <span className="block max-w-56 truncate font-medium">{d.adAccountName}</span>
                          {d.externalAudienceId ? (
                            <span className="block font-mono text-xs text-muted-foreground">{d.externalAudienceId}</span>
                          ) : null}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                      {d.error ? <p className="mt-1 max-w-72 text-xs text-red-600 dark:text-red-400">{d.error}</p> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(d.uploadedCount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.matchedCount === null ? "—" : formatNumber(d.matchedCount)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground" title={formatDateTime(d.lastSyncedAt)}>
                      {timeAgo(d.lastSyncedAt)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeDest.mutate(d.adAccountId)}
                          disabled={removeDest.isPending}
                          aria-label="Remove destination"
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Not synced anywhere yet. Add a Google Ads or Meta ad account.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sample members</CardTitle>
            <CardDescription>Masked for privacy</CardDescription>
          </CardHeader>
          <CardContent>
            {a.sample.length ? (
              <div className="divide-y rounded-lg border text-sm">
                {a.sample.map((m, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3 px-3 py-2">
                    <span className="truncate">{m.name || "—"}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{m.email || "—"}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{m.phone || "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {a.type !== "upload" ? (
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="block font-medium">Daily re-sync</span>
                  <span className="block text-muted-foreground">Recompute members and push them every day</span>
                </span>
                <Switch checked={a.autoSync} disabled={!canWrite || autoSync.isPending} onCheckedChange={(v) => autoSync.mutate(v)} />
              </label>
            ) : null}
            <RulesSummary rules={a.rules} />
            <p className="text-xs text-muted-foreground">Created {formatDateTime(a.createdAt)}</p>
          </CardContent>
        </Card>
      </div>

      {editing ? <EditAudienceDialog audience={a} onClose={() => setEditing(false)} /> : null}
      {adding ? <AddDestinationDialog audience={a} onClose={() => setAdding(false)} /> : null}
      {lookalike ? <LookalikeDialog audience={a} onClose={() => setLookalike(false)} /> : null}
    </div>
  )
}

function RulesSummary({ rules }: { rules: AudienceRules }) {
  const { wid } = useWorkspace()
  const pipeline = usePipeline(wid)
  const stage = (k: string) => pipeline.data?.find((s) => s.key === k)?.label ?? k
  const rows: [string, string][] = []
  if (rules.stages?.length) rows.push(["Stages", rules.stages.map(stage).join(", ")])
  if (rules.excludeStages?.length) rows.push(["Excluding", rules.excludeStages.map(stage).join(", ")])
  if (rules.channels?.length) rows.push(["Channels", rules.channels.map(humanize).join(", ")])
  if (rules.campaignIds?.length) rows.push(["Campaigns", `${rules.campaignIds.length} selected`])
  if (rules.minIntentScore) rows.push(["Intent score", `≥ ${rules.minIntentScore}`])
  if (rules.contactStatus?.length) rows.push(["Identity", rules.contactStatus.map(humanize).join(", ")])
  if (rules.eventTypes?.length) rows.push(["Activity", rules.eventTypes.map(humanize).join(", ")])
  if (rules.createdWithinDays) rows.push(["Created", `last ${rules.createdWithinDays} days`])
  if (!rows.length) return <p className="text-muted-foreground">No rules: everyone eligible is included.</p>
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function EditAudienceDialog({ audience, onClose }: { audience: Audience; onClose: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState(audience.name)
  const [description, setDescription] = useState(audience.description ?? "")
  const [rules, setRules] = useState<AudienceRules>(audience.rules)
  const save = useMutation({
    mutationFn: () =>
      api.updateAudience(wid, audience.id, {
        name: name.trim(),
        description: description.trim(),
        rules: cleanRules(audience.type, rules),
      }),
    onSuccess: () => {
      toast.success("Audience updated. Sync to push the new members.")
      qc.invalidateQueries({ queryKey: ["ws", wid, "audiences"] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit audience</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="aname">Name</Label>
              <Input id="aname" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adesc">Description</Label>
              <Textarea id="adesc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <RuleBuilder type={audience.type} rules={rules} onChange={setRules} />
          </div>
          <AudiencePreviewCard type={audience.type} rules={rules} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddDestinationDialog({ audience, onClose }: { audience: Audience; onClose: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const accounts = useAdAccounts(wid)
  const existing = new Set(audience.destinations.map((d) => d.adAccountId))
  const options = (accounts.data ?? []).filter((a) => a.status === "active" && !existing.has(a.id))
  const [picked, setPicked] = useState<string[]>([])
  const add = useMutation({
    mutationFn: () => api.addAudienceDestinations(wid, audience.id, picked),
    onSuccess: () => {
      toast.success("Sync started")
      qc.invalidateQueries({ queryKey: ["ws", wid, "audiences"] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sync to ad accounts</DialogTitle>
          <DialogDescription>
            Google Customer Match needs an eligible account; Meta needs the Custom Audience terms accepted in Business Manager.
          </DialogDescription>
        </DialogHeader>
        {accounts.isPending ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : options.length ? (
          <div className="space-y-2">
            {options.map((acc) => (
              <label key={acc.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Checkbox
                  checked={picked.includes(acc.id)}
                  onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, acc.id] : p.filter((x) => x !== acc.id)))}
                />
                <PlatformIcon platform={acc.platform} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{acc.name}</span>
                  <span className="block text-xs text-muted-foreground">{acc.externalId}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No more active ad accounts. Connect one on the{" "}
            <Link href={`/w/${wid}/integrations`} className="text-primary hover:underline">
              Integrations
            </Link>{" "}
            page.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => add.mutate()} disabled={!picked.length || add.isPending}>
            {add.isPending ? <Loader2 className="animate-spin" /> : null}
            Add and sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LookalikeDialog({ audience, onClose }: { audience: Audience; onClose: () => void }) {
  const { wid } = useWorkspace()
  const metaDests = audience.destinations.filter((d) => d.platform === "meta" && d.externalAudienceId)
  const [adAccountId, setAdAccountId] = useState(metaDests[0]?.adAccountId ?? "")
  const [country, setCountry] = useState("IN")
  const [ratio, setRatio] = useState(1)
  const create = useMutation({
    mutationFn: () => api.createLookalike(wid, audience.id, { adAccountId, country, ratio: ratio / 100 }),
    onSuccess: (r) => {
      toast.success(`Created "${r.name}" in Meta (${r.externalAudienceId})`)
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a Meta lookalike</DialogTitle>
          <DialogDescription>Meta finds new people similar to this audience. 1% is the closest match; 10% reaches more people.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Ad account</Label>
            <Select value={adAccountId} onValueChange={setAdAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {metaDests.map((d) => (
                  <SelectItem key={d.adAccountId} value={d.adAccountId}>
                    {d.adAccountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Audience size</Label>
              <span className="text-sm font-medium tabular-nums">{ratio}%</span>
            </div>
            <Slider min={1} max={10} step={1} value={[ratio]} onValueChange={([v]) => setRatio(v ?? 1)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!adAccountId || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <CopyPlus />}
            Create lookalike
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteAudience({ audience, onDeleted }: { audience: Audience; onDeleted: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [fromPlatforms, setFromPlatforms] = useState(true)
  const remove = useMutation({
    mutationFn: () => api.deleteAudience(wid, audience.id, fromPlatforms),
    onSuccess: () => {
      toast.success("Audience deleted")
      qc.invalidateQueries({ queryKey: ["ws", wid, "audiences"] })
      onDeleted()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Delete audience" className="text-destructive">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {audience.name}?</AlertDialogTitle>
          <AlertDialogDescription>The audience and its members are removed from AdsAssist.</AlertDialogDescription>
        </AlertDialogHeader>
        {audience.destinations.length ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={fromPlatforms} onCheckedChange={(v) => setFromPlatforms(v === true)} />
            Also delete it from Google Ads and Meta
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
