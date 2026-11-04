"use client"

import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { LeadSourceBadge, PlatformBadge } from "@/components/app/badges"
import { StageSelect, StageBadge } from "@/components/app/stage"
import type { Lead } from "@/lib/api"
import { formatMoney, timeAgo, formatDateTime } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export function LeadTable({ leads, editableStage }: { leads: Lead[]; editableStage?: boolean }) {
  const { wid, canAnalyze } = useWorkspace()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lead</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead>Channel</TableHead>
          <TableHead>Campaign</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="text-right">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="max-w-64">
              <Link href={`/w/${wid}/leads/${l.id}`} className="group block min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium group-hover:underline">{l.name || l.email || l.phone || "Unnamed lead"}</span>
                  <LeadSourceBadge source={l.source} />
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[l.email, l.phone].filter(Boolean).join(" · ") || l.externalId || "—"}
                </div>
              </Link>
            </TableCell>
            <TableCell>
              {editableStage && canAnalyze ? <StageSelect lead={l} /> : <StageBadge stage={l.stage} label={l.stageLabel} />}
            </TableCell>
            <TableCell>
              <PlatformBadge platform={l.channel} short />
            </TableCell>
            <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
              {l.campaignId ? (
                <Link href={`/w/${wid}/campaigns/${l.campaignId}`} className="hover:underline">
                  {l.campaignName ?? "Campaign"}
                </Link>
              ) : (
                l.utm?.campaign || "—"
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{l.value ? formatMoney(l.value, l.currency) : "—"}</TableCell>
            <TableCell className="text-right text-sm text-muted-foreground" title={formatDateTime(l.createdAt)}>
              {timeAgo(l.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
