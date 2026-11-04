"use client"

import { useDeferredValue, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Fingerprint, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PlatformIcon, StatusBadge } from "@/components/app/badges"
import { PageHeader } from "@/components/app/page-header"
import { Pagination } from "@/components/app/pagination"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { api } from "@/lib/api"
import { formatNumber, timeAgo } from "@/lib/format"
import { useRangeParams } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

export default function ContactsPage() {
  const { wid } = useWorkspace()
  const { update } = useRangeParams()
  const params = useSearchParams()
  const status = params.get("status") ?? ""
  const page = Number(params.get("page") ?? "1") || 1
  const [search, setSearch] = useState("")
  const q = useDeferredValue(search.trim())

  const contacts = useQuery({
    queryKey: ["ws", wid, "contacts", { status, q, page }],
    queryFn: () => api.contacts(wid, { status: status || undefined, search: q || undefined, page, pageSize: 25 }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description="Visitors identified by the pixel — stitched across devices by email and phone"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search email, phone or name"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              if (page !== 1) update({ page: undefined })
            }}
          />
        </div>
        <Select value={status || "all"} onValueChange={(v) => update({ status: v === "all" ? undefined : v, page: undefined })}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visitors</SelectItem>
            <SelectItem value="known">Known</SelectItem>
            <SelectItem value="cross_device">Cross-device</SelectItem>
            <SelectItem value="anonymous">Anonymous</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent>
          {contacts.isPending ? (
            <TableSkeleton />
          ) : contacts.isError ? (
            <ErrorState error={contacts.error} onRetry={() => contacts.refetch()} />
          ) : contacts.data.items.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>First touch</TableHead>
                    <TableHead className="w-36">Intent</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-64">
                        <Link href={`/w/${wid}/contacts/${c.id}`} className="group block min-w-0">
                          <div className="truncate font-medium group-hover:underline">
                            {c.name || c.email || c.phone || "Anonymous visitor"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[c.email, c.phone].filter(Boolean).join(" · ") || c.id}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="max-w-48">
                        {c.firstTouch ? (
                          <span className="flex items-center gap-1.5 truncate text-sm">
                            <PlatformIcon platform={c.firstTouch.channel ?? "other"} className="size-3.5 shrink-0" />
                            <span className="truncate">{c.firstTouch.campaign || c.firstTouch.source || c.firstTouch.channel || "Direct"}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Direct</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={c.intentScore} className="h-1.5" />
                          <span className="w-7 text-right text-xs tabular-nums">{c.intentScore}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.deviceCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(c.eventCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.leadCount}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{timeAgo(c.lastSeenAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={contacts.data.page}
                pageSize={contacts.data.pageSize}
                total={contacts.data.total}
                onPageChange={(p) => update({ page: p === 1 ? undefined : String(p) })}
              />
            </>
          ) : (
            <EmptyState
              icon={Fingerprint}
              title="No contacts yet"
              description="When a visitor types their email or phone into a tracked form, they appear here with their full journey."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
