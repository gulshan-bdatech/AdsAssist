"use client"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PlatformIcon } from "@/components/app/badges"
import type { Audience, AudienceDestination } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export const AUDIENCE_TYPE_LABEL: Record<Audience["type"], string> = {
  leads: "Leads",
  contacts: "Website visitors",
  upload: "Uploaded list",
}

const DEST_TONE: Record<AudienceDestination["status"], string> = {
  synced: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  syncing: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
}

export function DestinationBadge({ d }: { d: AudienceDestination }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("gap-1.5 font-normal", DEST_TONE[d.status])}>
          <PlatformIcon platform={d.platform} className="size-3" />
          <span className="max-w-28 truncate">{d.adAccountName}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        {d.status === "failed" ? d.error ?? "Sync failed" : `${d.status} · ${formatNumber(d.uploadedCount)} uploaded`}
      </TooltipContent>
    </Tooltip>
  )
}

export function lastSync(a: Audience) {
  const times = a.destinations.map((d) => d.lastSyncedAt).filter(Boolean) as string[]
  return times.sort().at(-1) ?? null
}
