"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { StatusBadge, stageTone } from "@/components/app/badges"
import type { Lead, PipelineStage } from "@/lib/api"
import { usePipeline, useSetLeadStage } from "@/lib/hooks"
import { useWorkspace } from "@/lib/workspace"

export function StageBadge({ stage, label }: { stage: string; label?: string }) {
  const { wid } = useWorkspace()
  const pipeline = usePipeline(wid)
  const def = pipeline.data?.find((s) => s.key === stage)
  return <StatusBadge status={stage} label={label ?? def?.label ?? stage} tone={stageTone(def?.kind)} />
}

/**
 * Inline stage picker. Moving into a "won" stage asks for the deal value,
 * since revenue and ROAS are built from it.
 */
export function StageSelect({ lead, className }: { lead: Lead; className?: string }) {
  const { wid } = useWorkspace()
  const pipeline = usePipeline(wid)
  const setStage = useSetLeadStage(wid)
  const [pendingWon, setPendingWon] = useState<PipelineStage | null>(null)
  const [value, setValue] = useState("")

  const stages = pipeline.data ?? []

  return (
    <>
      <Select
        value={lead.stage}
        disabled={setStage.isPending || stages.length === 0}
        onValueChange={(key) => {
          const def = stages.find((s) => s.key === key)
          if (def?.kind === "won") {
            setValue(String(lead.value ?? def.value ?? ""))
            setPendingWon(def)
            return
          }
          setStage.mutate({ id: lead.id, stage: key })
        }}
      >
        <SelectTrigger size="sm" className={className ?? "w-40"}>
          {setStage.isPending ? <Loader2 className="animate-spin" /> : null}
          <SelectValue placeholder={lead.stageLabel} />
        </SelectTrigger>
        <SelectContent>
          {stages.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={Boolean(pendingWon)} onOpenChange={(o) => !o && setPendingWon(null)}>
        <DialogContent className="sm:max-w-sm">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!pendingWon) return
              const n = Number(value)
              setStage.mutate(
                { id: lead.id, stage: pendingWon.key, value: value && !Number.isNaN(n) ? n : undefined },
                { onSuccess: () => setPendingWon(null) },
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>Mark as {pendingWon?.label}</DialogTitle>
              <DialogDescription>
                Enter the deal value. It is used for revenue and ROAS{pendingWon?.pushToPlatforms ? ", and sent to Google and Meta" : ""}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="won-value">Value ({lead.currency})</Label>
              <Input id="won-value" type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPendingWon(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={setStage.isPending}>
                {setStage.isPending ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
