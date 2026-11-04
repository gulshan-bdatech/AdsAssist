"use client"

import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PlatformBadge, StatusBadge } from "@/components/app/badges"
import { api, type ConversionPush } from "@/lib/api"
import { formatDateTime, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export function ConversionTable({ rows, showLead = true }: { rows: ConversionPush[]; showLead?: boolean }) {
  const { wid, canAnalyze } = useWorkspace()
  const qc = useQueryClient()
  const retry = useMutation({
    mutationFn: (id: string) => api.retryConversion(wid, id),
    onSuccess: (p) => {
      toast.success(p.status === "sent" ? "Conversion sent" : "Retry queued")
      qc.invalidateQueries({ queryKey: ["ws", wid] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showLead ? <TableHead>Lead</TableHead> : null}
          <TableHead>Platform</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Attempts</TableHead>
          <TableHead className="text-right">When</TableHead>
          {canAnalyze ? <TableHead className="w-12" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            {showLead ? (
              <TableCell className="max-w-48 truncate">
                <Link href={`/w/${wid}/leads/${p.leadId}`} className="font-medium hover:underline">
                  {p.leadName || "Lead"}
                </Link>
              </TableCell>
            ) : null}
            <TableCell>
              <PlatformBadge platform={p.platform} short />
            </TableCell>
            <TableCell>
              <div className="text-sm font-medium">{p.eventName}</div>
              <div className="text-xs text-muted-foreground">stage: {p.stage}</div>
            </TableCell>
            <TableCell>
              {p.lastError && p.status !== "sent" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <StatusBadge status={p.status} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">{p.lastError}</TooltipContent>
                </Tooltip>
              ) : (
                <StatusBadge status={p.status} />
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{p.attempts}</TableCell>
            <TableCell className="text-right text-sm text-muted-foreground" title={formatDateTime(p.sentAt ?? p.createdAt)}>
              {timeAgo(p.sentAt ?? p.createdAt)}
            </TableCell>
            {canAnalyze ? (
              <TableCell>
                {p.status === "failed" || p.status === "skipped" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Retry"
                    disabled={retry.isPending && retry.variables === p.id}
                    onClick={() => retry.mutate(p.id)}
                  >
                    {retry.isPending && retry.variables === p.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  </Button>
                ) : null}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
