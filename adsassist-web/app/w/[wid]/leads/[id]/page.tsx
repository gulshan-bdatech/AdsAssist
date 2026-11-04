"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { LEAD_SOURCE_LABEL, PlatformBadge, consentLabel } from "@/components/app/badges"
import { ConversionTable } from "@/components/app/conversion-table"
import { EventList } from "@/components/app/event-list"
import { PageHeader } from "@/components/app/page-header"
import { StageBadge, StageSelect } from "@/components/app/stage"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states"
import { api, type Lead } from "@/lib/api"
import { formatDateTime, formatMoney, humanize } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { wid, canAnalyze } = useWorkspace()
  const [editing, setEditing] = useState(false)
  const detail = useQuery({ queryKey: ["ws", wid, "lead", id], queryFn: () => api.lead(wid, id) })

  if (detail.isPending) return <PageSkeleton />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />

  const { lead, history, conversions, events } = detail.data
  const title = lead.name || lead.email || lead.phone || "Unnamed lead"

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/w/${wid}/leads`}>
          <ArrowLeft /> Leads
        </Link>
      </Button>
      <PageHeader
        title={title}
        description={`Created ${formatDateTime(lead.createdAt)} · ${LEAD_SOURCE_LABEL[lead.source] ?? lead.source}`}
        actions={
          canAnalyze ? (
            <>
              <StageSelect lead={lead} className="w-44" />
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            </>
          ) : (
            <StageBadge stage={lead.stage} label={lead.stageLabel} />
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label="Email" value={lead.email} />
              <Row label="Phone" value={lead.phone} />
              <Row label="Value" value={lead.value ? formatMoney(lead.value, lead.currency) : null} />
              <Row label="External ID" value={lead.externalId} mono />
              <Row label="Country" value={lead.country || null} />
              <Row label="Marketing consent" value={consentLabel(lead.consent)} />
              <Row label="Updated" value={formatDateTime(lead.updatedAt)} />
              {lead.notes ? (
                <div className="space-y-1 border-t pt-3">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{lead.notes}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Attribution</CardTitle>
            <CardDescription>The ad click that brought this lead in</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Channel</dt>
                <dd>
                  <PlatformBadge platform={lead.channel} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Campaign</dt>
                <dd className="truncate text-right">
                  {lead.campaignId ? (
                    <Link className="text-primary hover:underline" href={`/w/${wid}/campaigns/${lead.campaignId}`}>
                      {lead.campaignName ?? "View campaign"}
                    </Link>
                  ) : (
                    lead.utm?.campaign || "—"
                  )}
                </dd>
              </div>
              <Row label="UTM source / medium" value={[lead.utm?.source, lead.utm?.medium].filter(Boolean).join(" / ") || null} />
              <Row label="UTM content" value={lead.utm?.content} />
              <Row label="gclid" value={lead.gclid} mono />
              <Row label="fbclid" value={lead.fbclid} mono />
              {lead.contactId ? (
                <div className="border-t pt-3">
                  <Link href={`/w/${wid}/contacts/${lead.contactId}`} className="text-primary hover:underline">
                    View visitor journey →
                  </Link>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stage history</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length ? (
              <ol className="relative space-y-4 border-l pl-5">
                {[...history].reverse().map((h, i) => (
                  <li key={`${h.stage}-${h.at}-${i}`} className="relative">
                    <span className="absolute top-1 -left-[25px] size-2.5 rounded-full border-2 border-background bg-primary" />
                    <div className="flex items-center gap-2">
                      <StageBadge stage={h.stage} label={h.label} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(h.at)} · by {h.userName ?? humanize(h.by)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No stage changes yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sent to ad platforms</CardTitle>
          <CardDescription>Conversions reported back to Google and Meta for this lead</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/w/${wid}/conversions`}>All conversions</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {conversions.length ? (
            <ConversionTable rows={conversions} showLead={false} />
          ) : (
            <EmptyState title="Nothing sent yet" description="Conversions are sent when the lead reaches a stage marked “send to platforms”." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tracked activity</CardTitle>
          <CardDescription>What this person did on your site</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length ? (
            <EventList events={events} wid={wid} showContact={false} absoluteTime />
          ) : (
            <EmptyState title="No tracked activity" description="This lead was not matched to a pixel visitor." />
          )}
        </CardContent>
      </Card>

      {editing ? <EditLeadDialog lead={lead} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono text-xs" : "truncate text-right"}>{value || "—"}</dd>
    </div>
  )
}

function EditLeadDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: lead.name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    value: lead.value?.toString() ?? "",
    notes: lead.notes ?? "",
  })
  const save = useMutation({
    mutationFn: () =>
      api.updateLead(wid, lead.id, {
        name: form.name,
        email: form.email,
        phone: form.phone,
        notes: form.notes,
        value: form.value ? Number(form.value) : undefined,
      }),
    onSuccess: () => {
      toast.success("Lead updated")
      qc.invalidateQueries({ queryKey: ["ws", wid] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Value ({lead.currency})</Label>
              <Input type="number" min={0} step="any" value={form.value} onChange={(e) => set("value", e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
