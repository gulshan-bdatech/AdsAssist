"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Download, Loader2, Plug, Save } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MetaMark, StatusBadge } from "@/components/app/badges"
import { TableSkeleton } from "@/components/app/states"
import { api, type LeadFormOption } from "@/lib/api"
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

/**
 * Meta instant-form leads. Forms come live from Meta; ticking one subscribes it
 * and new form leads are imported every 15 minutes.
 */
export function LeadFormsCard({ hasMeta, onReconnect }: { hasMeta: boolean; onReconnect: () => void }) {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null)

  const subs = useQuery({ queryKey: ["ws", wid, "lead-forms"], queryFn: () => api.leadForms(wid), enabled: hasMeta })
  const available = useQuery({
    queryKey: ["ws", wid, "lead-forms", "available"],
    queryFn: () => api.leadFormsAvailable(wid),
    enabled: hasMeta && canWrite,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const keyOf = (f: { pageId: string; formId: string }) => `${f.pageId}:${f.formId}`
  const enabled = (f: LeadFormOption) => draft?.[keyOf(f)] ?? f.enabled

  const save = useMutation({
    mutationFn: () =>
      api.saveLeadForms(
        wid,
        (available.data ?? []).map((f) => ({
          connectionId: f.connectionId,
          pageId: f.pageId,
          pageName: f.pageName,
          formId: f.formId,
          formName: f.formName,
          enabled: enabled(f),
        })),
      ),
    onSuccess: () => {
      toast.success("Lead forms saved. New leads import every 15 minutes.")
      setDraft(null)
      qc.invalidateQueries({ queryKey: ["ws", wid, "lead-forms"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const importNow = useMutation({
    mutationFn: (id: string) => api.importLeadForm(wid, id),
    onSuccess: () => {
      toast.success("Import queued")
      setTimeout(() => qc.invalidateQueries({ queryKey: ["ws", wid] }), 5_000)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Group forms by Facebook page for the checklist.
  const pages = new Map<string, LeadFormOption[]>()
  for (const f of available.data ?? []) pages.set(f.pageName || f.pageId, [...(pages.get(f.pageName || f.pageId) ?? []), f])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MetaMark /> Meta Lead Ads
        </CardTitle>
        <CardDescription>
          Import leads from Facebook and Instagram instant forms straight into your pipeline, attributed to the right campaign.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasMeta ? (
          <p className="text-sm text-muted-foreground">Connect Meta above to import instant-form leads.</p>
        ) : (
          <>
            {canWrite ? (
              available.isPending ? (
                <TableSkeleton rows={2} />
              ) : available.isError ? (
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>Meta needs extra permissions</AlertTitle>
                  <AlertDescription>
                    <p>{available.error.message}</p>
                    <p>
                      Reconnect Meta once and approve the new permissions (leads_retrieval, pages_show_list, pages_read_engagement,
                      pages_manage_ads).
                    </p>
                    <Button size="sm" className="mt-2" onClick={onReconnect}>
                      <Plug /> Reconnect Meta
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : available.data.length ? (
                <div className="space-y-4">
                  {[...pages.entries()].map(([page, forms]) => (
                    <div key={page} className="space-y-2">
                      <p className="text-sm font-medium">{page}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {forms.map((f) => (
                          <label key={keyOf(f)} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                            <Checkbox
                              checked={enabled(f)}
                              onCheckedChange={(v) => setDraft((d) => ({ ...(d ?? {}), [keyOf(f)]: v === true }))}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{f.formName}</span>
                              <span className="block font-mono text-xs text-muted-foreground">{f.formId}</span>
                            </span>
                            <StatusBadge status={f.status.toLowerCase()} label={f.status} />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <Button onClick={() => save.mutate()} disabled={!draft || save.isPending}>
                      {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                      Save forms
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No instant forms found on the Facebook pages this login manages.</p>
              )
            ) : null}

            {subs.data?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Imported</TableHead>
                    <TableHead className="text-right">Last import</TableHead>
                    {canWrite ? <TableHead className="w-12" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.data.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <p className="max-w-64 truncate font-medium">{s.formName}</p>
                        <p className="text-xs text-muted-foreground">{s.pageName}</p>
                      </TableCell>
                      <TableCell>
                        {s.lastError ? (
                          <>
                            <StatusBadge status="failed" />
                            <p className="mt-1 max-w-72 text-xs text-red-600 dark:text-red-400">{s.lastError}</p>
                          </>
                        ) : (
                          <StatusBadge status={s.enabled ? "active" : "paused"} label={s.enabled ? "Importing" : "Off"} />
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(s.importedCount)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground" title={formatDateTime(s.lastImportedAt)}>
                        {timeAgo(s.lastImportedAt)}
                      </TableCell>
                      {canWrite ? (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Import now"
                            title="Import now"
                            disabled={!s.enabled || (importNow.isPending && importNow.variables === s.id)}
                            onClick={() => importNow.mutate(s.id)}
                          >
                            {importNow.isPending && importNow.variables === s.id ? <Loader2 className="animate-spin" /> : <Download />}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : subs.isPending ? null : (
              <p className="text-sm text-muted-foreground">No forms are being imported yet.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
