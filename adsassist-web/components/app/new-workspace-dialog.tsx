"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { WorkspaceFields, defaultWorkspaceForm, type WorkspaceForm } from "@/components/app/workspace-fields"
import { api, type WorkspaceSummary } from "@/lib/api"

export function NewWorkspaceDialog({
  open,
  onOpenChange,
  agencies,
  defaultParentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agencies: WorkspaceSummary[]
  defaultParentId?: string
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const [form, setForm] = useState<WorkspaceForm>(() => ({
    ...defaultWorkspaceForm,
    type: defaultParentId ? "client" : defaultWorkspaceForm.type,
    parentId: defaultParentId ?? "",
  }))

  const create = useMutation({
    mutationFn: () =>
      api.createWorkspace({
        name: form.name.trim(),
        type: form.type,
        parentId: form.type === "client" && form.parentId ? form.parentId : undefined,
        currency: form.currency,
        timezone: form.timezone,
        phoneCountryCode: form.phoneCountryCode,
      }),
    onSuccess: (ws) => {
      toast.success(`Workspace “${ws.name}” created`)
      qc.invalidateQueries({ queryKey: ["me"] })
      qc.invalidateQueries({ queryKey: ["workspaces"] })
      onOpenChange(false)
      router.push(`/w/${ws.id}/integrations`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (form.name.trim()) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A workspace holds one business&apos;s ad accounts, leads and tracking. Agencies can add client workspaces under them.
            </DialogDescription>
          </DialogHeader>
          <WorkspaceFields form={form} onChange={setForm} agencies={agencies} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!form.name.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
