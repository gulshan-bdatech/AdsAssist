"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Loader2,
  MoreHorizontal,
  Plug,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Unplug,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GoogleMark, MetaMark, PlatformIcon, StatusBadge } from "@/components/app/badges"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { AccountPickerDialog } from "@/components/app/integrations/account-picker"
import { AccountSettingsDialog } from "@/components/app/integrations/account-settings"
import { LeadFormsCard } from "@/components/app/integrations/lead-forms"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { api, type AdAccount, type Connection, type Platform } from "@/lib/api"
import { formatDate, formatDateTime, formatNumber, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export default function IntegrationsPage() {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  // Returning from the OAuth consent screen: ?connected=google&connectionId=... or ?error=...
  const [pickerId, setPickerId] = useState<string | null>(() => params.get("connectionId"))
  const [oauthError, setOauthError] = useState<string | null>(() => params.get("error"))
  const [settingsFor, setSettingsFor] = useState<AdAccount | null>(null)

  const connections = useQuery({ queryKey: ["ws", wid, "connections"], queryFn: () => api.connections(wid) })
  const accounts = useQuery({
    queryKey: ["ws", wid, "ad-accounts"],
    queryFn: () => api.adAccounts(wid),
    refetchInterval: (q) => (q.state.data?.some((a) => a.lastSyncStatus === "running") ? 5_000 : false),
  })
  const runs = useQuery({
    queryKey: ["ws", wid, "sync-runs"],
    queryFn: () => api.syncRuns(wid),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 5_000 : 60_000),
  })

  useEffect(() => {
    if (!params.get("connectionId") && !params.get("error")) return
    if (params.get("connectionId")) {
      toast.success(`${params.get("connected") === "meta" ? "Meta" : "Google"} connected`)
      qc.invalidateQueries({ queryKey: ["ws", wid, "connections"] })
    }
    router.replace(pathname, { scroll: false })
  }, [params, pathname, qc, router, wid])

  const connect = useMutation({
    mutationFn: (platform: Platform) => api.connectUrl(wid, platform),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pickerConnection = connections.data?.find((c) => c.id === pickerId)
  const connectedPlatforms = new Set((connections.data ?? []).filter((c) => c.status === "active").map((c) => c.platform))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect Google Ads and Meta to pull live performance data and send conversions back"
      />

      {oauthError ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>
            <p>{oauthError}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setOauthError(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <ConnectCard
          platform="google"
          title="Google Ads"
          description="Campaigns, ad groups, ads and daily metrics via the Google Ads API. Offline conversions with gclid and enhanced conversions."
          connected={connectedPlatforms.has("google")}
          canWrite={canWrite}
          pending={connect.isPending && connect.variables === "google"}
          onConnect={() => connect.mutate("google")}
        />
        <ConnectCard
          platform="meta"
          title="Meta Ads"
          description="Facebook & Instagram campaigns, ad sets, ads and insights via the Marketing API. Lead events through the Conversions API."
          connected={connectedPlatforms.has("meta")}
          canWrite={canWrite}
          pending={connect.isPending && connect.variables === "meta"}
          onConnect={() => connect.mutate("meta")}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ad accounts</CardTitle>
          <CardDescription>Synced automatically every few minutes. Turn sync off to pause an account.</CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.isPending ? (
            <TableSkeleton rows={3} />
          ) : accounts.isError ? (
            <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />
          ) : accounts.data.length ? (
            <AdAccountsTable accounts={accounts.data} onSettings={setSettingsFor} />
          ) : (
            <EmptyState
              icon={Plug}
              title="No ad accounts yet"
              description="Connect Google Ads or Meta above, then choose which ad accounts to track."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected logins</CardTitle>
          <CardDescription>The Google / Facebook users whose access is used to read data</CardDescription>
        </CardHeader>
        <CardContent>
          {connections.isPending ? (
            <TableSkeleton rows={2} />
          ) : connections.isError ? (
            <ErrorState error={connections.error} onRetry={() => connections.refetch()} />
          ) : connections.data.length ? (
            <ConnectionsList connections={connections.data} onAddAccounts={setPickerId} />
          ) : (
            <p className="text-sm text-muted-foreground">No logins connected yet.</p>
          )}
        </CardContent>
      </Card>

      <LeadFormsCard hasMeta={connectedPlatforms.has("meta")} onReconnect={() => connect.mutate("meta")} />

      <Card>
        <CardHeader>
          <CardTitle>Recent syncs</CardTitle>
          <CardDescription>The latest 50 pulls from the ad platforms</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.isPending ? (
            <TableSkeleton rows={3} />
          ) : runs.isError ? (
            <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
          ) : runs.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead className="text-right">Campaigns</TableHead>
                  <TableHead className="text-right">Ads</TableHead>
                  <TableHead className="text-right">Metric rows</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.data.map((r) => {
                  const acct = accounts.data?.find((a) => a.id === r.adAccountId)
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <PlatformIcon platform={r.platform} />
                          <span className="max-w-48 truncate">{acct?.name ?? r.adAccountId}</span>
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{r.trigger}</TableCell>
                      <TableCell>
                        {r.error ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <StatusBadge status={r.status} />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm">{r.error}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <StatusBadge status={r.status} />
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(r.dateFrom, "d MMM")} – {formatDate(r.dateTo, "d MMM")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.stats?.campaigns ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.stats?.ads ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.stats?.metricRows ?? 0)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground" title={formatDateTime(r.startedAt)}>
                        {timeAgo(r.startedAt)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No syncs yet.</p>
          )}
        </CardContent>
      </Card>

      {pickerConnection ? <AccountPickerDialog connection={pickerConnection} onClose={() => setPickerId(null)} /> : null}
      {settingsFor ? <AccountSettingsDialog account={settingsFor} onClose={() => setSettingsFor(null)} /> : null}
    </div>
  )
}

function ConnectCard({
  platform,
  title,
  description,
  connected,
  canWrite,
  pending,
  onConnect,
}: {
  platform: Platform
  title: string
  description: string
  connected: boolean
  canWrite: boolean
  pending: boolean
  onConnect: () => void
}) {
  const Mark = platform === "google" ? GoogleMark : MetaMark
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border bg-background">
            <Mark className="size-5" />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            {connected ? <StatusBadge status="active" label="Connected" className="mt-1" /> : null}
          </div>
        </div>
        {canWrite ? (
          <CardAction>
            <Button variant={connected ? "outline" : "default"} onClick={onConnect} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : connected ? <Plus /> : <Plug />}
              {connected ? "Connect another" : "Connect"}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function AdAccountsTable({ accounts, onSettings }: { accounts: AdAccount[]; onSettings: (a: AdAccount) => void }) {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ws", wid] })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.updateAdAccount>[2] }) => api.updateAdAccount(wid, id, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })
  const sync = useMutation({
    mutationFn: ({ id, days }: { id: string; days?: number }) => api.syncAdAccount(wid, id, days),
    onSuccess: () => {
      toast.success("Sync queued")
      setTimeout(invalidate, 3_000)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAdAccount(wid, id),
    onSuccess: () => {
      toast.success("Ad account removed")
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last sync</TableHead>
          <TableHead>Conversions to</TableHead>
          <TableHead className="text-center">Sync</TableHead>
          {canWrite ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((a) => {
          const target = a.platform === "meta" ? a.metaPixelId : a.googleConversionActionId
          return (
            <TableRow key={a.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={a.platform} />
                  <div className="min-w-0">
                    <p className="max-w-56 truncate font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.externalId} · {a.currency}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={a.status} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 text-sm">
                  {a.lastSyncStatus === "running" ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Syncing…
                    </span>
                  ) : a.lastSyncStatus === "failed" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertTriangle className="size-3.5" /> Failed {timeAgo(a.lastSyncedAt)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">{a.lastSyncError ?? "Unknown error"}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-muted-foreground">{timeAgo(a.lastSyncedAt)}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {a.conversionsEnabled && target ? (
                  <span className="font-mono text-xs">{target}</span>
                ) : (
                  <button
                    type="button"
                    className="text-left text-xs text-amber-600 hover:underline disabled:no-underline dark:text-amber-400"
                    onClick={() => onSettings(a)}
                    disabled={!canWrite}
                  >
                    {a.conversionsEnabled ? `Set ${a.platform === "meta" ? "pixel" : "conversion action"}` : "Off"}
                  </button>
                )}
              </TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={a.syncEnabled}
                  disabled={!canWrite || update.isPending}
                  onCheckedChange={(v) => update.mutate({ id: a.id, body: { syncEnabled: v } })}
                  aria-label="Sync enabled"
                />
              </TableCell>
              {canWrite ? (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={sync.isPending || a.lastSyncStatus === "running"}
                          onClick={() => sync.mutate({ id: a.id })}
                          aria-label="Sync now"
                        >
                          <RefreshCw />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Sync last 3 days now</TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="More">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onSettings(a)}>
                          <Settings2 /> Conversion settings
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => sync.mutate({ id: a.id, days: 30 })}>
                          <RefreshCw /> Re-sync last 30 days
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => sync.mutate({ id: a.id, days: 90 })}>
                          <RefreshCw /> Backfill 90 days
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <ConfirmDialog
                          title={`Remove ${a.name}?`}
                          description="Synced campaigns and metrics for this account are removed from the dashboard. Leads are kept."
                          confirmLabel="Remove"
                          onConfirm={() => remove.mutate(a.id)}
                          trigger={
                            <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                              <Trash2 /> Remove
                            </DropdownMenuItem>
                          }
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function ConnectionsList({ connections, onAddAccounts }: { connections: Connection[]; onAddAccounts: (id: string) => void }) {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const refresh = useMutation({
    mutationFn: (id: string) => api.refreshConnectionAccounts(wid, id),
    onSuccess: (c) => {
      toast.success(`Found ${c.availableAccounts.length} account(s)`)
      qc.invalidateQueries({ queryKey: ["ws", wid, "connections"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const disconnect = useMutation({
    mutationFn: (id: string) => api.deleteConnection(wid, id),
    onSuccess: () => {
      toast.success("Disconnected")
      qc.invalidateQueries({ queryKey: ["ws", wid] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="divide-y">
      {connections.map((c) => (
        <div key={c.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PlatformIcon platform={c.platform} className="size-5" />
            <div className="min-w-0">
              <p className="truncate font-medium">{c.externalUserName || c.externalUserEmail || "Connected user"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {c.externalUserEmail ? `${c.externalUserEmail} · ` : ""}
                {c.availableAccounts.filter((a) => a.selected).length}/{c.availableAccounts.length} accounts tracked · connected{" "}
                {formatDate(c.createdAt)}
              </p>
              {c.lastError ? <p className="text-xs text-red-600 dark:text-red-400">{c.lastError}</p> : null}
            </div>
            <StatusBadge status={c.status} />
          </div>
          {canWrite ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onAddAccounts(c.id)}>
                <Plus /> Accounts
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refresh.mutate(c.id)}
                disabled={refresh.isPending && refresh.variables === c.id}
              >
                {refresh.isPending && refresh.variables === c.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Refresh
              </Button>
              <ConfirmDialog
                title="Disconnect this login?"
                description="Its ad accounts stop syncing and are marked disconnected. You can reconnect any time."
                confirmLabel="Disconnect"
                onConfirm={() => disconnect.mutate(c.id)}
                trigger={
                  <Button variant="ghost" size="sm" className="text-destructive">
                    <Unplug /> Disconnect
                  </Button>
                }
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
