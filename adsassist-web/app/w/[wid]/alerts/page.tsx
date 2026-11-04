"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellRing, FlaskConical, Info, Loader2, Mail, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PlatformIcon } from "@/components/app/badges"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { TagInput, isEmail } from "@/components/app/tag-input"
import { api, type AlertMetric, type AlertRule, type AlertRuleInput, type AlertWindow, type Platform, type ReportSettings } from "@/lib/api"
import { formatMoney, formatNumber, formatPercent, formatRatio, timeAgo } from "@/lib/format"
import { useCapabilities } from "@/lib/hooks"
import { presetRange } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

const METRICS: { value: AlertMetric; label: string; kind: "money" | "count" | "percent" | "ratio" }[] = [
  { value: "spend", label: "Spend", kind: "money" },
  { value: "leads", label: "Leads", kind: "count" },
  { value: "won_leads", label: "Won leads", kind: "count" },
  { value: "conversions", label: "Platform conversions", kind: "count" },
  { value: "cpl", label: "Cost per lead", kind: "money" },
  { value: "cpc", label: "Cost per click", kind: "money" },
  { value: "ctr", label: "Click-through rate (%)", kind: "percent" },
  { value: "roas", label: "ROAS", kind: "ratio" },
]

const WINDOWS: { value: AlertWindow; label: string }[] = [
  { value: "today", label: "Today so far" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "Last 7 days" },
]

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatMetric(metric: AlertMetric, v: number | null, currency: string) {
  const kind = METRICS.find((m) => m.value === metric)?.kind
  if (kind === "money") return formatMoney(v, currency)
  if (kind === "percent") return formatPercent(v)
  if (kind === "ratio") return formatRatio(v)
  return formatNumber(v)
}

export default function AlertsPage() {
  const { wid, canAnalyze, currency } = useWorkspace()
  const qc = useQueryClient()
  const caps = useCapabilities()
  const [editing, setEditing] = useState<AlertRule | "new" | null>(null)
  const list = useQuery({ queryKey: ["ws", wid, "alerts"], queryFn: () => api.alerts(wid) })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ws", wid, "alerts"] })

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updateAlert(wid, id, { active }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAlert(wid, id),
    onSuccess: () => {
      toast.success("Alert deleted")
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const test = useMutation({
    mutationFn: (id: string) => api.testAlert(wid, id),
    onSuccess: (r) => (r.triggered ? toast.warning(r.message) : toast.success(r.message)),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Get told when spend, cost per lead or results cross a line. Checked every 15 minutes."
        actions={
          canAnalyze ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> New alert
            </Button>
          ) : null
        }
      />

      {caps.data && !caps.data.email ? (
        <Alert>
          <Info />
          <AlertTitle>SMTP not configured – alerts appear in-app only</AlertTitle>
          <AlertDescription>
            Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in the API&apos;s .env to also email recipients.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          {list.isPending ? (
            <TableSkeleton />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Notify</TableHead>
                  <TableHead>Last triggered</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  {canAnalyze ? <TableHead className="w-32 text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-medium">{r.name}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {r.platform ? <PlatformIcon platform={r.platform} className="size-3" /> : null}
                        {r.campaignName ?? (r.platform ? (r.platform === "google" ? "Google Ads" : "Meta") : "All campaigns")}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {METRICS.find((m) => m.value === r.metric)?.label} {r.operator === "gt" ? ">" : "<"}{" "}
                      <span className="font-medium">{formatMetric(r.metric, r.threshold, currency)}</span>
                      <span className="text-muted-foreground"> · {WINDOWS.find((w) => w.value === r.window)?.label.toLowerCase()}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[r.notifyInApp ? "In-app" : null, r.recipients.length ? `${r.recipients.length} email` : null].filter(Boolean).join(" · ") ||
                        "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.lastTriggeredAt ? (
                        <>
                          {timeAgo(r.lastTriggeredAt)}
                          <span className="block text-xs text-muted-foreground">value {formatMetric(r.metric, r.lastValue, currency)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={r.active}
                        disabled={!canAnalyze || toggle.isPending}
                        onCheckedChange={(active) => toggle.mutate({ id: r.id, active })}
                        aria-label="Active"
                      />
                    </TableCell>
                    {canAnalyze ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => test.mutate(r.id)}
                            disabled={test.isPending && test.variables === r.id}
                            aria-label="Test now"
                            title="Evaluate now (sends nothing)"
                          >
                            {test.isPending && test.variables === r.id ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(r)} aria-label="Edit">
                            <Pencil />
                          </Button>
                          <ConfirmDialog
                            title={`Delete "${r.name}"?`}
                            confirmLabel="Delete"
                            onConfirm={() => remove.mutate(r.id)}
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label="Delete">
                                <Trash2 />
                              </Button>
                            }
                          />
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={BellRing}
              title="No alerts yet"
              description="Example: alert me when cost per lead is above ₹800 today, or when Meta spend passes ₹20,000 in a day."
              action={
                canAnalyze ? (
                  <Button onClick={() => setEditing("new")}>
                    <Plus /> New alert
                  </Button>
                ) : null
              }
            />
          )}
        </CardContent>
      </Card>

      <DigestCard emailEnabled={caps.data?.email ?? true} aiEnabled={caps.data?.ai ?? false} />

      {editing ? <AlertRuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

const EMPTY: AlertRuleInput = {
  name: "",
  metric: "cpl",
  operator: "gt",
  threshold: 0,
  window: "today",
  platform: null,
  campaignId: null,
  recipients: [],
  notifyInApp: true,
  active: true,
  cooldownHours: 24,
}

function AlertRuleDialog({ rule, onClose }: { rule: AlertRule | null; onClose: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [form, setForm] = useState<AlertRuleInput>(() => (rule ? { ...EMPTY, ...rule } : EMPTY))
  const [threshold, setThreshold] = useState(rule ? String(rule.threshold) : "")
  const set = (patch: Partial<AlertRuleInput>) => setForm((f) => ({ ...f, ...patch }))
  const campaigns = useQuery({
    queryKey: ["ws", wid, "campaigns", "picker"],
    queryFn: () => api.campaigns(wid, { ...presetRange(90), status: "all" }),
  })
  const scoped = (campaigns.data ?? []).filter((c) => !form.platform || c.platform === form.platform)

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, name: form.name.trim(), threshold: Number(threshold) }
      return rule ? api.updateAlert(wid, rule.id, body) : api.createAlert(wid, body)
    },
    onSuccess: () => {
      toast.success(rule ? "Alert updated" : "Alert created")
      qc.invalidateQueries({ queryKey: ["ws", wid, "alerts"] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const valid = form.name.trim() && threshold !== "" && !Number.isNaN(Number(threshold)) && (form.notifyInApp || form.recipients.length)

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
            <DialogTitle>{rule ? "Edit alert" : "New alert"}</DialogTitle>
            <DialogDescription>Triggers once per cooldown period while the condition holds.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alert-name">Name</Label>
            <Input id="alert-name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="CPL too high today" required />
          </div>
          <div className="grid grid-cols-[1fr_90px_1fr] gap-2">
            <div className="space-y-2">
              <Label>Metric</Label>
              <Select value={form.metric} onValueChange={(v) => set({ metric: v as AlertMetric })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Is</Label>
              <Select value={form.operator} onValueChange={(v) => set({ operator: v as "gt" | "lt" })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gt">above</SelectItem>
                  <SelectItem value="lt">below</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="threshold">Threshold</Label>
              <Input id="threshold" type="number" step="any" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Window</Label>
              <Select value={form.window} onValueChange={(v) => set({ window: v as AlertWindow })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select
                value={form.platform ?? "all"}
                onValueChange={(v) => set({ platform: v === "all" ? null : (v as Platform), campaignId: null })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="google">Google Ads</SelectItem>
                  <SelectItem value="meta">Meta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Campaign (optional)</Label>
            <Select value={form.campaignId ?? "all"} onValueChange={(v) => set({ campaignId: v === "all" ? null : v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {scoped.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <PlatformIcon platform={c.platform} /> {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Email recipients</Label>
            <TagInput
              value={form.recipients}
              onChange={(recipients) => set({ recipients })}
              validate={isEmail}
              placeholder="name@company.com, press Enter"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.notifyInApp} onCheckedChange={(notifyInApp) => set({ notifyInApp })} />
              Show in the notification bell
            </label>
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="cooldown" className="font-normal">
                Cooldown (h)
              </Label>
              <Input
                id="cooldown"
                type="number"
                min={1}
                max={168}
                className="w-20"
                value={form.cooldownHours}
                onChange={(e) => set({ cooldownHours: Math.max(1, Number(e.target.value) || 24) })}
              />
            </div>
          </div>
          {!form.notifyInApp && !form.recipients.length ? (
            <p className="text-xs text-destructive">Add a recipient or keep in-app notifications on.</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {rule ? "Save" : "Create alert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DigestCard({ emailEnabled, aiEnabled }: { emailEnabled: boolean; aiEnabled: boolean }) {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ["ws", wid, "report-settings"], queryFn: () => api.reportSettings(wid) })
  const [draft, setDraft] = useState<ReportSettings | null>(null)
  const current = draft ?? settings.data
  const set = (patch: Partial<ReportSettings>) => current && setDraft({ ...current, ...patch })
  const save = useMutation({
    mutationFn: (body: ReportSettings) => api.saveReportSettings(wid, body),
    onSuccess: (s) => {
      toast.success("Digest settings saved")
      qc.setQueryData(["ws", wid, "report-settings"], s)
      setDraft(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" /> Weekly digest
        </CardTitle>
        <CardDescription>A weekly email with spend, leads, cost per lead and the top insights.</CardDescription>
        {current && canWrite ? (
          <CardAction>
            <Switch checked={current.weeklyDigest} onCheckedChange={(weeklyDigest) => set({ weeklyDigest })} aria-label="Weekly digest" />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {settings.isPending ? (
          <TableSkeleton rows={2} />
        ) : settings.isError ? (
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        ) : current ? (
          <div className="space-y-4">
            {!emailEnabled ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">Emails can&apos;t be sent until SMTP is configured on the API.</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <div className="space-y-2">
                <Label>Recipients</Label>
                <TagInput
                  value={current.digestRecipients}
                  onChange={(digestRecipients) => set({ digestRecipients })}
                  validate={isEmail}
                  disabled={!canWrite}
                  placeholder="name@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Send on</Label>
                <Select value={String(current.digestDay)} onValueChange={(v) => set({ digestDay: Number(v) })} disabled={!canWrite}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d, i) => (
                      <SelectItem key={d} value={String(i)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={current.aiInDigest}
                disabled={!canWrite || !aiEnabled}
                onCheckedChange={(aiInDigest) => set({ aiInDigest })}
              />
              Include an AI summary {!aiEnabled ? <span className="text-muted-foreground">(AI not configured)</span> : null}
            </label>
            {canWrite ? (
              <div className="flex justify-end">
                <Button onClick={() => save.mutate(current)} disabled={!draft || save.isPending}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : null}
                  Save digest
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
