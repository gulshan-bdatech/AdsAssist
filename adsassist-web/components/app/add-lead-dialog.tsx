"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, type Channel } from "@/lib/api"
import { usePipeline } from "@/lib/hooks"
import { presetRange } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

const empty = { name: "", email: "", phone: "", stage: "", value: "", channel: "other" as Channel, campaignId: "", notes: "" }

export function AddLeadDialog() {
  const { wid, currency } = useWorkspace()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const pipeline = usePipeline(wid)
  const campaigns = useQuery({
    queryKey: ["ws", wid, "campaigns", "picker"],
    queryFn: () => api.campaigns(wid, { ...presetRange(90), status: "all" }),
    enabled: open,
  })
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const create = useMutation({
    mutationFn: () =>
      api.createLead(wid, {
        name: form.name.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        stage: form.stage || undefined,
        value: form.value ? Number(form.value) : undefined,
        channel: form.channel,
        campaignId: form.campaignId || undefined,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Lead added")
      qc.invalidateQueries({ queryKey: ["ws", wid] })
      setForm(empty)
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canSubmit = Boolean(form.name.trim() || form.email.trim() || form.phone.trim())
  const channelCampaigns = (campaigns.data ?? []).filter((c) => form.channel === "google" || form.channel === "meta" ? c.platform === form.channel : true)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a lead</DialogTitle>
            <DialogDescription>For leads that came in by phone, walk-in or another tool. Needs a name, email or phone.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Stage">
              <Select value={form.stage || pipeline.data?.[0]?.key || ""} onValueChange={(v) => set("stage", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="First stage" />
                </SelectTrigger>
                <SelectContent>
                  {(pipeline.data ?? []).map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Value (${currency})`}>
              <Input type="number" min={0} step="any" value={form.value} onChange={(e) => set("value", e.target.value)} />
            </Field>
            <Field label="Channel">
              <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v as Channel, campaignId: "" }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">Google Ads</SelectItem>
                  <SelectItem value="meta">Meta Ads</SelectItem>
                  <SelectItem value="organic">Organic</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Campaign">
              <Select value={form.campaignId || "none"} onValueChange={(v) => set("campaignId", v === "none" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {channelCampaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-2">{label}</Label>
      {children}
    </div>
  )
}
