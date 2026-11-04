"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GoogleMark, MetaMark } from "@/components/app/badges"
import { api } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

/** Shown when the workspace has no ad accounts yet. */
export function ConnectBanner() {
  const { wid, canWrite } = useWorkspace()
  const accounts = useQuery({ queryKey: ["ws", wid, "ad-accounts"], queryFn: () => api.adAccounts(wid) })
  if (!accounts.data || accounts.data.length > 0) return null
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-gradient-to-br from-primary/10 via-background to-background p-5 sm:flex-row sm:items-center">
      <div className="flex -space-x-2">
        <div className="flex size-10 items-center justify-center rounded-full border bg-background">
          <GoogleMark className="size-5" />
        </div>
        <div className="flex size-10 items-center justify-center rounded-full border bg-background">
          <MetaMark className="size-5" />
        </div>
      </div>
      <div className="flex-1">
        <p className="font-medium">Connect Google Ads and Meta to see live numbers</p>
        <p className="text-sm text-muted-foreground">
          Spend, clicks and conversions are pulled straight from the platforms and refreshed automatically.
        </p>
      </div>
      {canWrite ? (
        <Button asChild>
          <Link href={`/w/${wid}/integrations`}>
            <Plug /> Connect accounts
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
