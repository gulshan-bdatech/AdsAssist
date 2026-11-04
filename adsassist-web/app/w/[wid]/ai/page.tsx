"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, History, KeyRound, Loader2, Sparkles } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CodeBlock } from "@/components/app/copy-button"
import { PageHeader } from "@/components/app/page-header"
import { DateRangeFilter } from "@/components/app/range-filter"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states"
import { api, type AiSummary } from "@/lib/api"
import { formatDate, formatDateTime, timeAgo } from "@/lib/format"
import { useCapabilities } from "@/lib/hooks"
import { useRangeParams } from "@/lib/range"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const PRIORITY_TONE: Record<AiSummary["actions"][number]["priority"], string> = {
  high: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "border-border bg-muted text-muted-foreground",
}

export default function AiSummaryPage() {
  const { wid, canAnalyze } = useWorkspace()
  const qc = useQueryClient()
  const caps = useCapabilities()
  const { from, to } = useRangeParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const history = useQuery({
    queryKey: ["ws", wid, "ai-summaries"],
    queryFn: () => api.aiSummaries(wid),
    enabled: caps.data?.ai === true,
  })
  const generate = useMutation({
    mutationFn: () => api.generateAiSummary(wid, { from, to }),
    onSuccess: (s) => {
      qc.setQueryData<AiSummary[]>(["ws", wid, "ai-summaries"], (prev) => [s, ...(prev ?? []).filter((x) => x.id !== s.id)])
      setSelectedId(s.id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (caps.isPending) return <PageSkeleton />
  if (caps.isError) return <ErrorState error={caps.error} onRetry={() => caps.refetch()} />

  if (!caps.data.ai) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Summary" description="A plain-language read of your performance with prioritised next steps, written by Claude" />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> Turn on AI summaries
            </CardTitle>
            <CardDescription>Add an Anthropic API key to the API&apos;s environment and restart it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CodeBlock code={`# adsassist-api/.env\nANTHROPIC_API_KEY=sk-ant-...\n# optional, defaults to claude-opus-5-5\nANTHROPIC_MODEL=claude-opus-5-5`} />
            <p className="text-sm text-muted-foreground">
              Only aggregated metrics, campaign names and insight text are sent to the model. No lead names, emails or phone numbers.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const summaries = history.data ?? []
  const current = generate.isPending ? null : (summaries.find((s) => s.id === selectedId) ?? summaries[0] ?? null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Summary"
        description={`What happened, why, and what to do next · ${caps.data.aiModel ?? "Claude"}`}
        actions={
          <>
            <DateRangeFilter />
            {canAnalyze ? (
              <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
                {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Generate summary
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-6">
          {generate.isPending ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Analysing {formatDate(from, "d MMM")} – {formatDate(to, "d MMM")}
                </CardTitle>
                <CardDescription>Reading campaigns, leads and insights. This usually takes 15–30 seconds.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ) : current ? (
            <SummaryView summary={current} />
          ) : history.isPending ? (
            <PageSkeleton />
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={() => history.refetch()} />
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No summaries yet"
              description="Pick a date range and generate your first summary."
              action={
                canAnalyze ? (
                  <Button onClick={() => generate.mutate()}>
                    <Sparkles /> Generate summary
                  </Button>
                ) : null
              }
            />
          )}
        </div>

        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4" /> History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaries.length ? (
              <div className="space-y-1">
                {summaries.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      current?.id === s.id && "bg-muted font-medium",
                    )}
                  >
                    {formatDate(s.range.from, "d MMM")} – {formatDate(s.range.to, "d MMM")}
                    <span className="block text-xs font-normal text-muted-foreground">{timeAgo(s.createdAt)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Past summaries show up here.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryView({ summary }: { summary: AiSummary }) {
  const { wid } = useWorkspace()
  return (
    <>
      {summary.highlights.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Highlights</CardTitle>
            <CardDescription>
              {formatDate(summary.range.from)} – {formatDate(summary.range.to)} · generated {formatDateTime(summary.createdAt)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {summary.highlights.map((h, i) => (
                <li key={i} className="flex gap-2">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-500" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {summary.actions.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {summary.actions.map((a, i) => (
            <Card key={i} className="gap-3">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{a.title}</CardTitle>
                  <Badge variant="outline" className={cn("capitalize", PRIORITY_TONE[a.priority])}>
                    {a.priority}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{a.detail}</p>
                {a.campaignId ? (
                  <Button variant="link" size="sm" className="h-auto p-0" asChild>
                    <Link href={`/w/${wid}/campaigns/${a.campaignId}`}>
                      Open campaign <ArrowRight />
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Full analysis</CardTitle>
          <CardDescription>{summary.model}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-medium [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc">
            <ReactMarkdown>{summary.markdown}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
