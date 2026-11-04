"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Code2, KeyRound, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { CodeBlock, CopyButton } from "@/components/app/copy-button"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { API_URL, api, type SiteKey } from "@/lib/api"
import { formatDate, formatNumber, timeAgo } from "@/lib/format"
import { usePipeline } from "@/lib/hooks"
import { useWorkspace } from "@/lib/workspace"

export default function TrackingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tracking"
        description="Capture visitors and leads from your website and CRM, and match them to the ad that brought them in"
      />
      <SiteKeysCard />
      <ApiKeysCard />
      <DocsCard />
    </div>
  )
}

// ── Site keys ───────────────────────────────────────────────────────────────

function SiteKeysCard() {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ["ws", wid, "site-keys"], queryFn: () => api.siteKeys(wid) })
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<SiteKey | null>(null)

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.updateSiteKey>[2] }) => api.updateSiteKey(wid, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", wid, "site-keys"] }),
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSiteKey(wid, id),
    onSuccess: () => {
      toast.success("Site key deleted")
      qc.invalidateQueries({ queryKey: ["ws", wid, "site-keys"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 className="size-4" /> Website pixel
        </CardTitle>
        <CardDescription>
          One site key per website or funnel. The pixel records page views, form activity and ad click IDs (gclid / fbclid), and
          creates a lead when a form is submitted.
        </CardDescription>
        {canWrite ? (
          <CardAction>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New site key
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {keys.isPending ? (
          <TableSkeleton rows={2} />
        ) : keys.isError ? (
          <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
        ) : keys.data.length ? (
          keys.data.map((k) => (
            <div key={k.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{k.name}</p>
                    {k.active ? (
                      <Badge variant="outline" className="font-normal text-emerald-600 dark:text-emerald-400">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Paused</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{k.keyPrefix}…</span> · {formatNumber(k.eventsLast24h)} events in 24h · created{" "}
                    {formatDate(k.createdAt)}
                    {k.allowedDomains.length ? ` · ${k.allowedDomains.join(", ")}` : " · any domain"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={k.active}
                      disabled={!canWrite}
                      onCheckedChange={(v) => update.mutate({ id: k.id, body: { active: v } })}
                    />
                    Active
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={k.createLeadOnSubmit}
                      disabled={!canWrite}
                      onCheckedChange={(v) => update.mutate({ id: k.id, body: { createLeadOnSubmit: v } })}
                    />
                    Create leads on submit
                  </label>
                  <label className="flex items-center gap-2 text-sm" title="Send no email, phone or form values until the page calls adsassist.consent(true)">
                    <Switch
                      checked={k.requireConsent}
                      disabled={!canWrite}
                      onCheckedChange={(v) => update.mutate({ id: k.id, body: { requireConsent: v } })}
                    />
                    Require consent
                  </label>
                  {canWrite ? (
                    <ConfirmDialog
                      title={`Delete ${k.name}?`}
                      description="The pixel using this key will stop recording events immediately. Existing data is kept."
                      confirmLabel="Delete"
                      onConfirm={() => remove.mutate(k.id)}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label="Delete site key">
                          <Trash2 />
                        </Button>
                      }
                    />
                  ) : null}
                </div>
              </div>
              <CodeBlock code={k.installSnippet} />
            </div>
          ))
        ) : (
          <EmptyState
            icon={Code2}
            title="No site keys yet"
            description="Create a site key and paste the snippet into the <head> of your landing pages."
          />
        )}
      </CardContent>
      {creating ? (
        <CreateSiteKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(k) => {
            setCreating(false)
            setCreated(k)
          }}
        />
      ) : null}
      {created ? (
        <Dialog open onOpenChange={(o) => !o && setCreated(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Install the pixel</DialogTitle>
              <DialogDescription>
                Paste this into the &lt;head&gt; of every page of <b>{created.name}</b>. Forms are tracked automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Site key</Label>
                <div className="flex gap-2">
                  <Input readOnly value={created.key} className="font-mono text-xs" />
                  <CopyButton value={created.key} />
                </div>
              </div>
              <CodeBlock code={created.installSnippet} />
            </div>
            <DialogFooter>
              <Button onClick={() => setCreated(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}

function CreateSiteKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (k: SiteKey) => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [domains, setDomains] = useState("")
  const create = useMutation({
    mutationFn: () =>
      api.createSiteKey(wid, {
        name: name.trim(),
        allowedDomains: domains
          .split(/[\s,]+/)
          .map((d) => d.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
          .filter(Boolean),
      }),
    onSuccess: (k) => {
      qc.invalidateQueries({ queryKey: ["ws", wid, "site-keys"] })
      onCreated(k)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>New site key</DialogTitle>
            <DialogDescription>Use one key per website or funnel so you can compare them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sk-name">Name</Label>
            <Input id="sk-name" placeholder="Home loan landing page" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sk-domains">Allowed domains (optional)</Label>
            <Input
              id="sk-domains"
              placeholder="example.com, apply.example.com"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Events from other domains are rejected. Leave empty to allow any.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── API keys ────────────────────────────────────────────────────────────────

function ApiKeysCard() {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ["ws", wid, "api-keys"], queryFn: () => api.apiKeys(wid) })
  const [name, setName] = useState("")
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.createApiKey(wid, { name: name.trim() }),
    onSuccess: (k) => {
      qc.invalidateQueries({ queryKey: ["ws", wid, "api-keys"] })
      setSecret(k.key)
      setName("")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteApiKey(wid, id),
    onSuccess: () => {
      toast.success("API key revoked")
      qc.invalidateQueries({ queryKey: ["ws", wid, "api-keys"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> Server API keys
        </CardTitle>
        <CardDescription>
          Let your CRM, LMS or backend create leads and move them through the pipeline. Keep these secret.
        </CardDescription>
        {canWrite ? (
          <CardAction>
            <Button variant="outline" onClick={() => setOpen(true)}>
              <Plus /> New API key
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {keys.isPending ? (
          <TableSkeleton rows={2} />
        ) : keys.isError ? (
          <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
        ) : keys.data.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Created</TableHead>
                {canWrite ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.data.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : "Never"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(k.createdAt)}</TableCell>
                  {canWrite ? (
                    <TableCell>
                      <ConfirmDialog
                        title={`Revoke ${k.name}?`}
                        description="Any system using this key will get 401 errors immediately."
                        confirmLabel="Revoke"
                        onConfirm={() => remove.mutate(k.id)}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Revoke API key">
                            <Trash2 />
                          </Button>
                        }
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={KeyRound} title="No API keys" description="Create one to send leads and stage updates from your systems." />
        )}
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setSecret(null)
        }}
      >
        <DialogContent>
          {secret ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your API key</DialogTitle>
                <DialogDescription>This is the only time the full key is shown.</DialogDescription>
              </DialogHeader>
              <Alert>
                <KeyRound />
                <AlertTitle>Store it somewhere safe</AlertTitle>
                <AlertDescription>Anyone with this key can create and update leads in this workspace.</AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Input readOnly value={secret} className="font-mono text-xs" />
                <CopyButton value={secret} />
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setOpen(false)
                    setSecret(null)
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) create.mutate()
              }}
            >
              <DialogHeader>
                <DialogTitle>New API key</DialogTitle>
                <DialogDescription>Name it after the system that will use it.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="ak-name">Name</Label>
                <Input id="ak-name" placeholder="LMS production" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!name.trim() || create.isPending}>
                  {create.isPending ? <Loader2 className="animate-spin" /> : null}
                  Create key
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ── Docs ────────────────────────────────────────────────────────────────────

function DocsCard() {
  const { wid } = useWorkspace()
  const pipeline = usePipeline(wid)
  const stages = (pipeline.data ?? []).map((s) => s.key).join(" | ") || "new | qualified | won"
  const wonStage = pipeline.data?.find((s) => s.kind === "won")?.key ?? "won"

  const pixelJs = `<!-- Recommended: add the campaign ID to your ad URLs so leads match campaigns exactly -->
<!-- Google Ads final URL suffix:  utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_id={campaignid} -->
<!-- Meta URL parameters:         utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_id={{campaign.id}} -->

<script>
  // Identify a visitor as soon as you know who they are (e.g. after an OTP step)
  window.adsassist.identify({ email: "priya@example.com", phone: "+91 98765 43210", name: "Priya Sharma" })

  // Track any custom step in your funnel
  window.adsassist.track({ event_type: "custom", name: "eligibility_checked" })

  // Mark a conversion on the thank-you page (value is optional)
  window.adsassist.conversion({ value: 2500 })

  // Consent mode (turn on "Require consent" on the site key): call from your cookie banner.
  // Until consent(true), no email, phone or field values are sent and conversions aren't forwarded.
  window.adsassist.consent(true)   // visitor accepted marketing cookies
  window.adsassist.consent(false)  // visitor declined: recorded as an opt-out
</script>`

  const createLead = `curl -X POST ${API_URL}/api/v1/leads \\
  -H "X-API-Key: aak_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "externalId": "LOAN-10023",
    "name": "Priya Sharma",
    "email": "priya@example.com",
    "phone": "+919876543210",
    "stage": "new",
    "gclid": "Cj0KCQ...",
    "utm": { "source": "google", "campaign": "Home Loan - Search", "id": "21345678901" }
  }'`

  const moveStage = `# stage: ${stages}
curl -X PATCH ${API_URL}/api/v1/leads/LOAN-10023/stage \\
  -H "X-API-Key: aak_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "stage": "${wonStage}", "value": 500000, "currency": "INR" }'`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer guide</CardTitle>
        <CardDescription>
          The pixel tracks forms on its own. Use these when you need more control or want your CRM to report outcomes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="pixel">
          <TabsList>
            <TabsTrigger value="pixel">Pixel API</TabsTrigger>
            <TabsTrigger value="create">Create lead</TabsTrigger>
            <TabsTrigger value="stage">Update stage</TabsTrigger>
          </TabsList>
          <TabsContent value="pixel" className="pt-2">
            <CodeBlock code={pixelJs} />
          </TabsContent>
          <TabsContent value="create" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">
              Upserts by <code className="font-mono">externalId</code>. Include click IDs or UTMs so the lead is attributed to a campaign.
            </p>
            <CodeBlock code={createLead} />
          </TabsContent>
          <TabsContent value="stage" className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground">
              Moving a lead into a stage marked “send to platforms” reports the conversion to Google Ads and Meta automatically.
            </p>
            <CodeBlock code={moveStage} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
