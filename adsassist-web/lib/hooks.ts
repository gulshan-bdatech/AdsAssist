"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, type Lead, type PipelineStage } from "@/lib/api"

export function usePipeline(wid: string) {
  return useQuery({
    queryKey: ["ws", wid, "pipeline"],
    queryFn: () => api.pipeline(wid),
    staleTime: 5 * 60_000,
    select: (stages: PipelineStage[]) => [...stages].sort((a, b) => a.order - b.order),
  })
}

export function useSetLeadStage(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stage, value }: { id: string; stage: string; value?: number }) =>
      api.setLeadStage(wid, id, { stage, value }),
    onSuccess: (lead: Lead) => {
      toast.success(`Moved to ${lead.stageLabel}`)
      qc.invalidateQueries({ queryKey: ["ws", wid] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Which optional server features (SMTP email, Claude AI) are configured. */
export function useCapabilities() {
  return useQuery({ queryKey: ["capabilities"], queryFn: api.capabilities, staleTime: 10 * 60_000 })
}

export function useAdAccounts(wid: string) {
  return useQuery({ queryKey: ["ws", wid, "ad-accounts"], queryFn: () => api.adAccounts(wid) })
}
