"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/app/states"
import { WorkspaceFields, type WorkspaceForm } from "@/components/app/workspace-fields"
import { api, type Workspace } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export function GeneralSettings() {
  const { wid } = useWorkspace()
  const ws = useQuery({ queryKey: ["ws", wid, "workspace"], queryFn: () => api.workspace(wid) })
  if (ws.isPending) return <Skeleton className="h-80 w-full rounded-xl" />
  if (ws.isError) return <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
  return <GeneralForm workspace={ws.data} />
}

function GeneralForm({ workspace }: { workspace: Workspace }) {
  const { wid, canWrite } = useWorkspace()
  const qc = useQueryClient()
  const [form, setForm] = useState<WorkspaceForm>({
    name: workspace.name,
    type: workspace.type,
    parentId: workspace.parentId ?? "",
    currency: workspace.currency,
    timezone: workspace.timezone,
    phoneCountryCode: workspace.phoneCountryCode,
  })
  const [brandColor, setBrandColor] = useState(workspace.brandColor || "#4f46e5")

  const save = useMutation({
    mutationFn: () =>
      api.updateWorkspace(wid, {
        name: form.name.trim(),
        currency: form.currency,
        timezone: form.timezone,
        phoneCountryCode: form.phoneCountryCode,
        brandColor,
      }),
    onSuccess: () => {
      toast.success("Workspace saved")
      qc.invalidateQueries({ queryKey: ["me"] })
      qc.invalidateQueries({ queryKey: ["ws", wid] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            {workspace.type === "agency" ? "Agency workspace" : "Client workspace"} · created {formatDate(workspace.createdAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 py-6">
          <fieldset disabled={!canWrite} className="space-y-4">
            <WorkspaceFields form={form} onChange={setForm} hideType />
            <div className="space-y-2">
              <Label htmlFor="brand">Brand colour</Label>
              <div className="flex items-center gap-2">
                <input
                  id="brand"
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border bg-transparent"
                />
                <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-32 font-mono" />
              </div>
              <p className="text-xs text-muted-foreground">Used for client-facing reports.</p>
            </div>
          </fieldset>
        </CardContent>
        {canWrite ? (
          <CardFooter className="justify-end">
            <Button type="submit" disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save changes
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  )
}
