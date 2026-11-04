"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ErrorState } from "@/components/app/states"
import { api, type PipelineStage, type StageKind } from "@/lib/api"
import { usePipeline } from "@/lib/hooks"
import { useWorkspace } from "@/lib/workspace"

const META_EVENTS = ["Lead", "CompleteRegistration", "SubmitApplication", "Contact", "Schedule", "Purchase", "Subscribe", "StartTrial"]

export function PipelineSettings() {
  const { wid } = useWorkspace()
  const pipeline = usePipeline(wid)
  if (pipeline.isPending) return <Skeleton className="h-96 w-full rounded-xl" />
  if (pipeline.isError) return <ErrorState error={pipeline.error} onRetry={() => pipeline.refetch()} />
  return <PipelineEditor key={JSON.stringify(pipeline.data)} initial={pipeline.data} />
}

function slugify(label: string) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
}

function PipelineEditor({ initial }: { initial: PipelineStage[] }) {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const [stages, setStages] = useState<PipelineStage[]>(initial)
  const dirty = JSON.stringify(stages) !== JSON.stringify(initial)

  const save = useMutation({
    mutationFn: () => api.savePipeline(wid, stages.map((s, i) => ({ ...s, order: i }))),
    onSuccess: () => {
      toast.success("Pipeline saved")
      qc.invalidateQueries({ queryKey: ["ws", wid] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const patch = (i: number, changes: Partial<PipelineStage>) =>
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...changes } : s)))
  const move = (i: number, dir: -1 | 1) =>
    setStages((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  const addStage = () =>
    setStages((prev) => {
      let key = "new_stage"
      let n = 1
      while (prev.some((s) => s.key === key)) key = `new_stage_${++n}`
      const lostIdx = prev.findIndex((s) => s.kind === "lost")
      const stage: PipelineStage = { key, label: "New stage", order: 0, kind: "open", pushToPlatforms: false }
      const next = [...prev]
      next.splice(lostIdx >= 0 ? lostIdx : next.length, 0, stage)
      return next
    })

  const keys = stages.map((s) => s.key)
  const duplicate = keys.some((k, i) => keys.indexOf(k) !== i)
  const invalid = duplicate || stages.some((s) => !s.key || !s.label.trim()) || !stages.some((s) => s.kind === "open")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead pipeline</CardTitle>
        <CardDescription>
          The stages a lead moves through. Stages marked <b>Send to platforms</b> report a conversion to Google Ads and Meta
          — this is what teaches their bidding which clicks become customers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {stages.map((s, i) => (
          <div key={i} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[auto_1fr_8rem_auto] md:items-start">
            <div className="flex gap-1 md:flex-col">
              <Button type="button" variant="ghost" size="icon-xs" disabled={!canWrite || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={!canWrite || i === stages.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move down"
              >
                <ArrowDown />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={s.label}
                  disabled={!canWrite}
                  onChange={(e) => {
                    const label = e.target.value
                    const isNew = !initial.some((x) => x.key === s.key)
                    patch(i, isNew ? { label, key: slugify(label) || s.key } : { label })
                  }}
                />
                <p className="font-mono text-[11px] text-muted-foreground">key: {s.key}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Default value (optional)</Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  disabled={!canWrite}
                  value={s.value ?? ""}
                  onChange={(e) => patch(i, { value: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch
                  id={`push-${i}`}
                  checked={s.pushToPlatforms}
                  disabled={!canWrite}
                  onCheckedChange={(v) => patch(i, { pushToPlatforms: v, metaEventName: v ? s.metaEventName || "Lead" : s.metaEventName })}
                />
                <Label htmlFor={`push-${i}`}>Send to platforms</Label>
              </div>
              {s.pushToPlatforms ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Meta event name</Label>
                    <Select value={s.metaEventName || "Lead"} onValueChange={(v) => patch(i, { metaEventName: v })} disabled={!canWrite}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {META_EVENTS.map((e) => (
                          <SelectItem key={e} value={e}>
                            {e}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Google conversion action ID (optional)</Label>
                    <Input
                      placeholder="Uses the ad account default"
                      disabled={!canWrite}
                      value={s.googleConversionActionId ?? ""}
                      onChange={(e) => patch(i, { googleConversionActionId: e.target.value || undefined })}
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={s.kind} onValueChange={(v) => patch(i, { kind: v as StageKind })} disabled={!canWrite}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canWrite ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={stages.length <= 2}
                onClick={() => setStages((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove stage"
                className="justify-self-end"
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        ))}
        {duplicate ? <p className="text-sm text-destructive">Two stages have the same key. Rename one of them.</p> : null}
      </CardContent>
      {canWrite ? (
        <CardFooter className="justify-between gap-2">
          <Button type="button" variant="outline" onClick={addStage}>
            <Plus /> Add stage
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={!dirty} onClick={() => setStages(initial)}>
              Reset
            </Button>
            <Button type="button" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save pipeline
            </Button>
          </div>
        </CardFooter>
      ) : null}
    </Card>
  )
}
