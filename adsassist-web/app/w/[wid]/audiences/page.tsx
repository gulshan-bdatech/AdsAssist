"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plus, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AUDIENCE_TYPE_LABEL, DestinationBadge, lastSync } from "@/components/app/audiences/shared"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { api } from "@/lib/api"
import { formatNumber, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export default function AudiencesPage() {
  const { wid, canWrite } = useWorkspace()
  const list = useQuery({
    queryKey: ["ws", wid, "audiences"],
    queryFn: () => api.audiences(wid),
    refetchInterval: (q) => (q.state.data?.some((a) => a.destinations.some((d) => d.status === "syncing")) ? 5_000 : false),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audiences"
        description="Build audiences from your leads and website visitors and keep them synced to Meta Custom Audiences and Google Customer Match"
        actions={
          canWrite ? (
            <Button asChild>
              <Link href={`/w/${wid}/audiences/new`}>
                <Plus /> New audience
              </Link>
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent>
          {list.isPending ? (
            <TableSkeleton />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Audience</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Synced to</TableHead>
                  <TableHead className="text-right">Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/w/${wid}/audiences/${a.id}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                      {a.description ? <p className="max-w-80 truncate text-xs text-muted-foreground">{a.description}</p> : null}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{AUDIENCE_TYPE_LABEL[a.type]}</span>
                      {a.autoSync ? <span className="ml-2 text-xs text-muted-foreground">· daily</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(a.size)}</TableCell>
                    <TableCell>
                      {a.destinations.length ? (
                        <div className="flex flex-wrap gap-1">
                          {a.destinations.map((d) => (
                            <DestinationBadge key={d.adAccountId} d={d} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not synced</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{timeAgo(lastSync(a))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={Target}
              title="No audiences yet"
              description="Retarget people who abandoned a form, exclude existing customers, or seed a lookalike from your best leads."
              action={
                canWrite ? (
                  <Button asChild>
                    <Link href={`/w/${wid}/audiences/new`}>
                      <Plus /> New audience
                    </Link>
                  </Button>
                ) : null
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
