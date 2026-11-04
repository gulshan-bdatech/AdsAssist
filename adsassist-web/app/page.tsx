"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { ErrorState } from "@/components/app/states"
import { api } from "@/lib/api"
import { LAST_WORKSPACE_KEY } from "@/lib/workspace"

export default function Home() {
  const router = useRouter()
  const me = useQuery({ queryKey: ["me"], queryFn: api.me })

  useEffect(() => {
    if (!me.data) return
    const { workspaces } = me.data
    if (workspaces.length === 0) {
      router.replace("/onboarding")
      return
    }
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_WORKSPACE_KEY)
    } catch {}
    const target = workspaces.find((w) => w.id === last) ?? workspaces[0]!
    router.replace(`/w/${target.id}/dashboard`)
  }, [me.data, router])

  if (me.isError) {
    return (
      <div className="mx-auto max-w-xl p-6 pt-24">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
