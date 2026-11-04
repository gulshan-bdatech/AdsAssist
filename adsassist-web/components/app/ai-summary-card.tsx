"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { api } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { useCapabilities } from "@/lib/hooks"
import { useWorkspace } from "@/lib/workspace"

/** Dashboard teaser for the latest AI summary. Renders nothing when AI isn't configured. */
export function AiSummaryCard() {
  const { wid } = useWorkspace()
  const caps = useCapabilities()
  const latest = useQuery({
    queryKey: ["ws", wid, "ai-summaries"],
    queryFn: () => api.aiSummaries(wid),
    enabled: caps.data?.ai === true,
    select: (list) => list[0] ?? null,
  })
  if (!caps.data?.ai) return null

  const s = latest.data
  return (
    <Card className="gap-0 border-violet-500/20 bg-gradient-to-r from-violet-500/5 to-transparent py-4">
      <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
          <Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{s ? "Latest AI summary" : "Get an AI summary of this period"}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {s ? `${s.highlights[0] ?? s.actions[0]?.title ?? "Summary ready"} · ${timeAgo(s.createdAt)}` : "Claude reads your campaigns and leads and suggests what to change."}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/w/${wid}/ai`}>
            {s ? "Open" : "Generate"} <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
