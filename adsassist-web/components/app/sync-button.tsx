"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

/** Queues a sync for every sync-enabled ad account in the workspace. */
export function SyncNowButton({ lastSyncedAt }: { lastSyncedAt?: string | null }) {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ["ws", wid, "ad-accounts"], queryFn: () => api.adAccounts(wid) })
  const targets = (accounts.data ?? []).filter((a) => a.syncEnabled && a.status !== "disconnected")

  const sync = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(targets.map((a) => api.syncAdAccount(wid, a.id)))
      const failed = results.filter((r) => r.status === "rejected").length
      if (failed === results.length) throw new Error("Could not queue the sync")
      return { queued: results.length - failed, failed }
    },
    onSuccess: ({ queued, failed }) => {
      toast.success(`Sync queued for ${queued} account${queued === 1 ? "" : "s"}`, {
        description: failed ? `${failed} account(s) failed to queue.` : "New numbers show up in a minute or two.",
      })
      setTimeout(() => qc.invalidateQueries({ queryKey: ["ws", wid] }), 15_000)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline">Synced {timeAgo(lastSyncedAt)}</span>
      {canWrite ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="outline"
                size="sm"
                disabled={sync.isPending || targets.length === 0}
                onClick={() => sync.mutate()}
              >
                {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Sync now
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {targets.length === 0 ? "Connect an ad account first" : "Pull the latest numbers from Google Ads and Meta"}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
