"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PlatformIcon } from "@/components/app/badges"
import { api, type Connection } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

export function AccountPickerDialog({
  connection,
  onClose,
}: {
  connection: Connection
  onClose: () => void
}) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const selectable = connection.availableAccounts.filter((a) => !a.selected)
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(selectable.filter((a) => !a.isManager).length === 1 ? selectable.filter((a) => !a.isManager).map((a) => a.externalId) : []),
  )

  const add = useMutation({
    mutationFn: () => api.addAdAccounts(wid, { connectionId: connection.id, externalIds: [...picked] }),
    onSuccess: (accounts) => {
      toast.success(`${accounts.length} account${accounts.length === 1 ? "" : "s"} added`, {
        description: "Pulling the last 30 days of data now. This can take a minute.",
      })
      qc.invalidateQueries({ queryKey: ["ws", wid] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const label = connection.platform === "google" ? "Google Ads" : "Meta"

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlatformIcon platform={connection.platform} className="size-5" /> Choose {label} accounts
          </DialogTitle>
          <DialogDescription>
            Signed in as {connection.externalUserEmail || connection.externalUserName || "your account"}. Pick the ad accounts this
            workspace should track.
          </DialogDescription>
        </DialogHeader>
        {connection.availableAccounts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No ad accounts were found for this login. Check that the user has access to at least one {label} ad account
            {connection.platform === "google" ? " and that the developer token is approved" : ""}.
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="space-y-2 pr-3">
              {connection.availableAccounts.map((a) => (
                <label
                  key={a.externalId}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5 has-[button:disabled]:cursor-default has-[button:disabled]:opacity-60"
                >
                  <Checkbox
                    checked={a.selected || picked.has(a.externalId)}
                    disabled={a.selected}
                    onCheckedChange={() => toggle(a.externalId)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.externalId} · {a.currency}
                      {a.timezone ? ` · ${a.timezone}` : ""}
                    </p>
                  </div>
                  {a.isManager ? (
                    <Badge variant="secondary" className="gap-1">
                      <Building className="size-3" /> Manager
                    </Badge>
                  ) : null}
                  {a.selected ? <Badge variant="outline">Added</Badge> : null}
                </label>
              ))}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {selectable.length ? "Later" : "Close"}
          </Button>
          {selectable.length ? (
            <Button disabled={picked.size === 0 || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? <Loader2 className="animate-spin" /> : null}
              Add {picked.size || ""} account{picked.size === 1 ? "" : "s"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
