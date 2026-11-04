"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { MailOpen, MousePointerClick, Search, Send } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CodeBlock } from "@/components/app/copy-button"
import { KpiCard } from "@/components/app/kpi-card"
import { PageHeader } from "@/components/app/page-header"
import { Pagination } from "@/components/app/pagination"
import { DateRangeFilter } from "@/components/app/range-filter"
import { CardGridSkeleton, EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { API_URL, api } from "@/lib/api"
import { formatDateTime, formatNumber, formatPercent, timeAgo } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

export default function EmailTrackingPage() {
  const { wid } = useWorkspace()
  const { from, to, update } = useRangeParams()
  const params = useSearchParams()
  const page = Number(params.get("page") ?? "1") || 1
  const campaign = params.get("campaign") ?? ""
  const [search, setSearch] = useState(params.get("q") ?? "")
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== search) update({ q: search || undefined, page: undefined })
    }, 400)
    return () => clearTimeout(t)
  }, [search, params, update])

  const stats = useQuery({ queryKey: ["ws", wid, "email-stats", from, to], queryFn: () => api.emailStats(wid, { from, to }) })
  const messages = useQuery({
    queryKey: ["ws", wid, "email-messages", { page, q: params.get("q"), campaign }],
    queryFn: () => api.emailMessages(wid, { page, pageSize: 25, search: params.get("q") || undefined, campaign: campaign || undefined }),
    placeholderData: (prev) => prev,
  })
  const s = stats.data

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email tracking"
        description="Opens and clicks from the emails your CRM or ESP sends, tied to the same contacts as your ads"
        actions={<DateRangeFilter />}
      />

      {stats.isPending ? (
        <CardGridSkeleton />
      ) : stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
      ) : s ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Sent" icon={Send} value={formatNumber(s.sent)} hint="Messages registered in this range" />
          <KpiCard label="Opened" icon={MailOpen} value={formatNumber(s.opened)} hint="Unique messages opened" />
          <KpiCard label="Open rate" value={formatPercent(s.openRate, 1)} hint="Apple Mail privacy can inflate opens" />
          <KpiCard label="Click rate" icon={MousePointerClick} value={formatPercent(s.clickRate, 1)} hint={`${formatNumber(s.clicked)} clicked`} />
        </div>
      ) : null}

      {s?.byCampaign.length ? (
        <Card>
          <CardHeader>
            <CardTitle>By campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                  <TableHead className="text-right">Clicked</TableHead>
                  <TableHead className="text-right">Open rate</TableHead>
                  <TableHead className="text-right">Click rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.byCampaign.map((c) => (
                  <TableRow key={c.campaign ?? "none"}>
                    <TableCell>
                      {c.campaign ? (
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => update({ campaign: campaign === c.campaign ? undefined : c.campaign!, page: undefined })}
                        >
                          {c.campaign}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">No campaign</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.opened)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.clicked)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(c.openRate, 1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(c.clickRate, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Messages</CardTitle>
            <CardDescription>
              {campaign ? (
                <>
                  Campaign <span className="font-medium">{campaign}</span> ·{" "}
                  <button type="button" className="text-primary hover:underline" onClick={() => update({ campaign: undefined, page: undefined })}>
                    show all
                  </button>
                </>
              ) : (
                "Most recent first"
              )}
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or subject" className="pl-8" />
          </div>
        </CardHeader>
        <CardContent>
          {messages.isPending ? (
            <TableSkeleton />
          ) : messages.isError ? (
            <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
          ) : messages.data.items.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="text-right">Opens</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">First opened</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.data.items.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        {m.contactId ? (
                          <Link href={`/w/${wid}/contacts/${m.contactId}`} className="font-medium hover:underline">
                            {m.to}
                          </Link>
                        ) : (
                          <span className="font-medium">{m.to}</span>
                        )}
                        {m.campaign ? <span className="block text-xs text-muted-foreground">{m.campaign}</span> : null}
                      </TableCell>
                      <TableCell className="max-w-72 truncate text-sm">{m.subject || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(m.opens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(m.clicks)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground" title={formatDateTime(m.firstOpenedAt)}>
                        {m.firstOpenedAt ? timeAgo(m.firstOpenedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground" title={formatDateTime(m.createdAt)}>
                        {timeAgo(m.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={messages.data.page}
                pageSize={messages.data.pageSize}
                total={messages.data.total}
                onPageChange={(p) => update({ page: p === 1 ? undefined : String(p) })}
              />
            </>
          ) : (
            <EmptyState icon={MailOpen} title="No tracked emails yet" description="Register messages with the API below before you send them." />
          )}
        </CardContent>
      </Card>

      <IntegrationGuide />
    </div>
  )
}

function IntegrationGuide() {
  const { wid } = useWorkspace()
  const register = `curl -X POST ${API_URL}/api/v1/email/messages \\
  -H "X-API-Key: aak_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "priya@example.com",
    "subject": "Your loan offer is ready",
    "campaign": "loan-offer-nov",
    "links": ["https://example.com/offer?id=123"]
  }'

# → { "messageId": "...", "openPixelUrl": "...", "openPixelHtml": "<img ...>",
#     "links": [{ "url": "https://example.com/offer?id=123", "trackedUrl": "${API_URL}/api/v1/e/c/..." }] }`

  const html = `<!-- 1. Replace every link with its trackedUrl -->
<a href="{{trackedUrl}}">See your offer</a>

<!-- 2. Paste openPixelHtml just before </body> -->
{{openPixelHtml}}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integration guide</CardTitle>
        <CardDescription>
          Call the API once per email, right before sending, with a workspace API key from{" "}
          <Link href={`/w/${wid}/tracking`} className="text-primary hover:underline">
            Tracking
          </Link>
          . Opens and clicks then show on the contact&apos;s timeline and can feed audiences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">1. Register the message</p>
          <CodeBlock code={register} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">2. Use the returned values in the email HTML</p>
          <CodeBlock code={html} />
        </div>
      </CardContent>
    </Card>
  )
}
