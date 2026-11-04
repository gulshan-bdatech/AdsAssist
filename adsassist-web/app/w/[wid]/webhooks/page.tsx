"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, ListTree, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/app/badges"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { CodeBlock, CopyButton } from "@/components/app/copy-button"
import { PageHeader } from "@/components/app/page-header"
import { Pagination } from "@/components/app/pagination"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { api, type Webhook, type WebhookDelivery, type WebhookEvent } from "@/lib/api"
import { formatDateTime, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

const EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: "lead.created", label: "Lead created" },
  { value: "lead.stage_changed", label: "Lead stage changed" },
  { value: "lead.won", label: "Lead won" },
  { value: "contact.identified", label: "Visitor identified" },
  { value: "form.submitted", label: "Form submitted" },
  { value: "form.abandoned", label: "Form abandoned" },
  { value: "conversion.sent", label: "Conversion sent to ads" },
  { value: "conversion.failed", label: "Conversion upload failed" },
  { value: "alert.triggered", label: "Alert triggered" },
]

const VERIFY_SNIPPET = `import crypto from "node:crypto"

// Express: app.post("/hooks/adsassist", express.raw({ type: "application/json" }), handler)
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")))
  const expected = crypto.createHmac("sha256", secret).update(\`\${parts.t}.\${rawBody}\`).digest("hex")
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300 // reject replays older than 5 min
  return fresh && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""))
}

// verify(req.body.toString(), req.get("X-AdsAssist-Signature"), process.env.ADSASSIST_WEBHOOK_SECRET)`

export default function WebhooksPage() {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Webhook | "new" | null>(null)
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null)
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)
  const [testResult, setTestResult] = useState<WebhookDelivery | null>(null)
  const list = useQuery({ queryKey: ["ws", wid, "webhooks"], queryFn: () => api.webhooks(wid), enabled: canWrite })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ws", wid, "webhooks"] })

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updateWebhook(wid, id, { active }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })
  const rotate = useMutation({
    mutationFn: (w: Webhook) => api.rotateWebhookSecret(wid, w.id).then((r) => ({ name: w.name, secret: r.secret })),
    onSuccess: (r) => {
      setSecret(r)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const test = useMutation({
    mutationFn: (id: string) => api.testWebhook(wid, id),
    onSuccess: (d) => {
      setTestResult(d)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(wid, id),
    onSuccess: () => {
      toast.success("Webhook deleted")
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!canWrite) {
    return (
      <div className="space-y-6">
        <PageHeader title="Webhooks" />
        <EmptyState title="Admins only" description="Ask a workspace admin to manage webhooks." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Send leads, stage changes and form events to your CRM, Zapier, Slack or your own API in real time"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> New webhook
          </Button>
        }
      />

      <Card>
        <CardContent>
          {list.isPending ? (
            <TableSkeleton rows={3} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Last delivery</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      <p className="font-medium">{w.name}</p>
                      <p className="max-w-80 truncate font-mono text-xs text-muted-foreground">{w.url}</p>
                    </TableCell>
                    <TableCell className="max-w-64 text-sm text-muted-foreground">
                      {w.events.length === EVENTS.length ? "All events" : w.events.join(", ")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {w.lastStatus ? <StatusBadge status={w.lastStatus} /> : null}{" "}
                      <span className="text-muted-foreground">{w.lastDeliveryAt ? timeAgo(w.lastDeliveryAt) : "Never"}</span>
                      {w.failureCount ? (
                        <span className="block text-xs text-red-600 dark:text-red-400">{w.failureCount} failed in a row</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={w.active}
                        disabled={toggle.isPending}
                        onCheckedChange={(active) => toggle.mutate({ id: w.id, active })}
                        aria-label="Active"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => test.mutate(w.id)}
                          disabled={test.isPending && test.variables === w.id}
                          aria-label="Send test"
                          title="Send a test ping"
                        >
                          {test.isPending && test.variables === w.id ? <Loader2 className="animate-spin" /> : <Send />}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="More">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDeliveriesFor(w)}>
                              <ListTree /> Deliveries
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditing(w)}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            <ConfirmDialog
                              title="Rotate the signing secret?"
                              description="The old secret stops working immediately. Update your receiver with the new one."
                              confirmLabel="Rotate"
                              destructive={false}
                              onConfirm={() => rotate.mutate(w)}
                              trigger={
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                  <KeyRound /> Rotate secret
                                </DropdownMenuItem>
                              }
                            />
                            <DropdownMenuSeparator />
                            <ConfirmDialog
                              title={`Delete "${w.name}"?`}
                              confirmLabel="Delete"
                              onConfirm={() => remove.mutate(w.id)}
                              trigger={
                                <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                                  <Trash2 /> Delete
                                </DropdownMenuItem>
                              }
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={WebhookIcon}
              title="No webhooks yet"
              description="Every event is signed with HMAC-SHA256 and retried with back-off if your endpoint is down."
              action={
                <Button onClick={() => setEditing("new")}>
                  <Plus /> New webhook
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verifying signatures</CardTitle>
          <CardDescription>
            Each request carries <code className="font-mono text-xs">X-AdsAssist-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, an HMAC-SHA256
            of <code className="font-mono text-xs">&quot;&lt;t&gt;.&lt;raw body&gt;&quot;</code> with your webhook secret. Respond with any 2xx.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={VERIFY_SNIPPET} />
        </CardContent>
      </Card>

      {editing ? (
        <WebhookDialog
          webhook={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(name, s) => setSecret({ name, secret: s })}
        />
      ) : null}
      {secret ? <SecretDialog {...secret} onClose={() => setSecret(null)} /> : null}
      {testResult ? <DeliveryDialog delivery={testResult} title="Test ping result" onClose={() => setTestResult(null)} /> : null}
      <DeliveriesSheet webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
    </div>
  )
}

function WebhookDialog({
  webhook,
  onClose,
  onCreated,
}: {
  webhook: Webhook | null
  onClose: () => void
  onCreated: (name: string, secret: string) => void
}) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState(webhook?.name ?? "")
  const [url, setUrl] = useState(webhook?.url ?? "")
  const [events, setEvents] = useState<WebhookEvent[]>(webhook?.events ?? ["lead.created", "lead.stage_changed"])
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), url: url.trim(), events }
      if (webhook) {
        await api.updateWebhook(wid, webhook.id, body)
        return null
      }
      return api.createWebhook(wid, body)
    },
    onSuccess: (created) => {
      toast.success(webhook ? "Webhook updated" : "Webhook created")
      qc.invalidateQueries({ queryKey: ["ws", wid, "webhooks"] })
      if (created) onCreated(created.name, created.secret)
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const valid = name.trim() && /^https?:\/\/\S+$/.test(url.trim()) && events.length

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{webhook ? "Edit webhook" : "New webhook"}</DialogTitle>
            <DialogDescription>Must be an https:// URL that is reachable from the internet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="wh-name">Name</Label>
            <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CRM" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wh-url">URL</Label>
            <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.example.com/hooks/adsassist" required />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Events</Label>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setEvents(events.length === EVENTS.length ? [] : EVENTS.map((e) => e.value))}
              >
                {events.length === EVENTS.length ? "Clear" : "Select all"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {EVENTS.map((ev) => (
                <label key={ev.value} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={events.includes(ev.value)}
                    onCheckedChange={(v) => setEvents((list) => (v === true ? [...list, ev.value] : list.filter((x) => x !== ev.value)))}
                    className="mt-0.5"
                  />
                  <span>
                    {ev.label}
                    <span className="block font-mono text-xs text-muted-foreground">{ev.value}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {webhook ? "Save" : "Create webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SecretDialog({ name, secret, onClose }: { name: string; secret: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Signing secret for {name}</DialogTitle>
          <DialogDescription>Copy it now. It won&apos;t be shown again; rotate it if you lose it.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">{secret}</code>
          <CopyButton value={secret} />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeliveryDetails({ delivery }: { delivery: WebhookDelivery }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={delivery.status} />
        {delivery.responseStatus ? <span className="font-mono text-xs">HTTP {delivery.responseStatus}</span> : null}
        {delivery.durationMs !== null ? <span className="text-xs text-muted-foreground">{delivery.durationMs} ms</span> : null}
        <span className="text-xs text-muted-foreground">
          {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}
        </span>
      </div>
      {delivery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{delivery.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Payload</p>
        <CodeBlock code={JSON.stringify(delivery.payload, null, 2)} />
      </div>
      {delivery.responseBody ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Response body</p>
          <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">{delivery.responseBody}</pre>
        </div>
      ) : null}
    </div>
  )
}

function DeliveryDialog({ delivery, title, onClose }: { delivery: WebhookDelivery; title: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DeliveryDetails delivery={delivery} />
      </DialogContent>
    </Dialog>
  )
}

function DeliveriesSheet({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<WebhookDelivery | null>(null)
  const list = useQuery({
    queryKey: ["ws", wid, "webhooks", webhook?.id, "deliveries", page],
    queryFn: () => api.webhookDeliveries(wid, webhook!.id, { page, pageSize: 20 }),
    enabled: Boolean(webhook),
    placeholderData: (prev) => prev,
  })
  const redeliver = useMutation({
    mutationFn: (id: string) => api.redeliverWebhook(wid, id),
    onSuccess: (d) => {
      toast[d.status === "sent" ? "success" : "warning"](d.status === "sent" ? "Delivered" : "Redelivery queued")
      qc.invalidateQueries({ queryKey: ["ws", wid, "webhooks"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Sheet
      open={Boolean(webhook)}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setPage(1)
          setOpen(null)
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Deliveries · {webhook?.name}</SheetTitle>
          <SheetDescription className="truncate font-mono text-xs">{webhook?.url}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {list.isPending ? (
            <TableSkeleton />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.items.length ? (
            <>
              <div className="divide-y rounded-lg border">
                {list.data.items.map((d) => (
                  <div key={d.id}>
                    <div className="flex items-center gap-3 px-3 py-2 text-sm">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open?.id === d.id ? null : d)}>
                        <span className="font-mono text-xs">{d.event}</span>
                        <span className="block text-xs text-muted-foreground" title={formatDateTime(d.createdAt)}>
                          {timeAgo(d.createdAt)}
                          {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
                        </span>
                      </button>
                      <StatusBadge status={d.status} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Redeliver"
                        title="Redeliver"
                        disabled={redeliver.isPending && redeliver.variables === d.id}
                        onClick={() => redeliver.mutate(d.id)}
                      >
                        {redeliver.isPending && redeliver.variables === d.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                      </Button>
                    </div>
                    {open?.id === d.id ? (
                      <div className="border-t bg-muted/20 p-3">
                        <DeliveryDetails delivery={d} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPageChange={setPage} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No deliveries yet. Send a test ping from the list.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
