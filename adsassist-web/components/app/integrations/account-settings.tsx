"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type AdAccount } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

const MANUAL = "__manual__"

/** Where conversions for this ad account are sent: a Meta pixel/dataset or a Google conversion action. */
export function AccountSettingsDialog({ account, onClose }: { account: AdAccount; onClose: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const isMeta = account.platform === "meta"
  const [target, setTarget] = useState((isMeta ? account.metaPixelId : account.googleConversionActionId) ?? "")
  const [manual, setManual] = useState(false)
  const [conversionsEnabled, setConversionsEnabled] = useState(account.conversionsEnabled)

  const options = useQuery({
    queryKey: ["ws", wid, "ad-account-targets", account.id],
    queryFn: async () =>
      isMeta
        ? (await api.metaPixels(wid, account.id)).map((p) => ({ id: p.id, name: p.name, note: "" }))
        : (await api.googleConversionActions(wid, account.id)).map((c) => ({
            id: c.id,
            name: c.name,
            note: [c.category, c.status].filter(Boolean).join(" · ").toLowerCase(),
          })),
  })

  const save = useMutation({
    mutationFn: () =>
      api.updateAdAccount(wid, account.id, {
        conversionsEnabled,
        ...(isMeta ? { metaPixelId: target.trim() } : { googleConversionActionId: target.trim() }),
      }),
    onSuccess: () => {
      toast.success("Settings saved")
      qc.invalidateQueries({ queryKey: ["ws", wid, "ad-accounts"] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const list = options.data ?? []
  const inList = list.some((o) => o.id === target)
  const showManual = manual || (target !== "" && !inList && !options.isPending)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{account.name}</DialogTitle>
            <DialogDescription>
              {isMeta
                ? "Pick the Meta pixel (dataset) that receives lead events through the Conversions API."
                : "Pick the Google Ads conversion action that receives offline / enhanced conversions."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="conv-enabled">Send conversions</Label>
              <p className="text-xs text-muted-foreground">Report qualified and won leads back to {isMeta ? "Meta" : "Google"}.</p>
            </div>
            <Switch id="conv-enabled" checked={conversionsEnabled} onCheckedChange={setConversionsEnabled} />
          </div>

          <div className="space-y-2">
            <Label>{isMeta ? "Meta pixel" : "Conversion action"}</Label>
            {options.isPending ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <>
                {options.isError ? (
                  <Alert>
                    <AlertDescription>Could not load the list ({options.error.message}). You can enter the ID manually.</AlertDescription>
                  </Alert>
                ) : null}
                {!showManual && list.length ? (
                  <Select
                    value={target || undefined}
                    onValueChange={(v) => {
                      if (v === MANUAL) {
                        setManual(true)
                        return
                      }
                      setTarget(v)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={isMeta ? "Select a pixel" : "Select a conversion action"} />
                    </SelectTrigger>
                    <SelectContent>
                      {list.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          <span className="truncate">{o.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {o.id}
                            {o.note ? ` · ${o.note}` : ""}
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem value={MANUAL}>Enter an ID manually…</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder={isMeta ? "Pixel / dataset ID" : "Conversion action ID"}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                )}
                {!options.isError && list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    None found on this account. {isMeta ? "Create a pixel in Meta Events Manager" : "Create an “Import → Other data sources or CRMs” conversion action in Google Ads"} or paste an ID.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
