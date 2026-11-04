"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, MailCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/app/states"
import { api } from "@/lib/api"
import { getToken } from "@/lib/auth"

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const loggedIn = Boolean(getToken())
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.inviteInfo(token) })

  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: (ws) => {
      toast.success(`You joined ${ws.name}`)
      qc.invalidateQueries({ queryKey: ["me"] })
      router.replace(`/w/${ws.id}/dashboard`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (info.isPending) return <Skeleton className="h-48 w-full" />
  if (info.isError) return <ErrorState error={info.error} />

  const { workspaceName, email, role, status } = info.data
  const next = encodeURIComponent(`/invite/${token}`)

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <MailCheck className="size-6 text-primary" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Join {workspaceName}</h1>
        <p className="text-sm text-muted-foreground">
          {email} was invited as <span className="font-medium capitalize text-foreground">{role}</span>.
        </p>
      </div>
      {status !== "pending" ? (
        <p className="text-sm text-muted-foreground">This invite has already been {status}.</p>
      ) : loggedIn ? (
        <Button className="w-full" onClick={() => accept.mutate()} disabled={accept.isPending}>
          {accept.isPending ? <Loader2 className="animate-spin" /> : null}
          Accept invite
        </Button>
      ) : (
        <div className="grid w-full gap-2">
          <Button asChild>
            <Link href={`/register?next=${next}&email=${encodeURIComponent(email)}`}>Create account to join</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/login?next=${next}&email=${encodeURIComponent(email)}`}>I already have an account</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
