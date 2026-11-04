"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, LogOut } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Logo } from "@/components/app/logo"
import { WorkspaceFields, defaultWorkspaceForm, type WorkspaceForm } from "@/components/app/workspace-fields"
import { api } from "@/lib/api"
import { clearToken } from "@/lib/auth"

const STEPS = ["Create workspace", "Connect Google & Meta", "Install tracking pixel"]

export default function OnboardingPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ["me"], queryFn: api.me })
  const [form, setForm] = useState<WorkspaceForm>(defaultWorkspaceForm)

  const create = useMutation({
    mutationFn: () =>
      api.createWorkspace({
        name: form.name.trim(),
        type: form.type,
        currency: form.currency,
        timezone: form.timezone,
        phoneCountryCode: form.phoneCountryCode,
      }),
    onSuccess: (ws) => {
      toast.success("Workspace created")
      qc.invalidateQueries({ queryKey: ["me"] })
      router.replace(`/w/${ws.id}/integrations`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="flex min-h-svh flex-col items-center gap-8 bg-muted/40 px-4 py-10">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <Logo />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearToken()
            qc.clear()
            router.replace("/login")
          }}
        >
          <LogOut /> Log out
        </Button>
      </div>
      <ol className="flex w-full max-w-2xl gap-2 text-xs sm:text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-2">
            <div className={i === 0 ? "h-1 rounded-full bg-primary" : "h-1 rounded-full bg-border"} />
            <span className={i === 0 ? "font-medium" : "text-muted-foreground"}>
              {i + 1}. {s}
            </span>
          </li>
        ))}
      </ol>
      <Card className="w-full max-w-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (form.name.trim()) create.mutate()
          }}
        >
          <CardHeader>
            <CardTitle className="text-xl">
              {me.data ? `Hi ${me.data.user.name.split(" ")[0]}, let’s set up your workspace` : "Set up your workspace"}
            </CardTitle>
            <CardDescription>
              Choose <b>Agency</b> if you run ads for several clients — you can add client workspaces later.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-6">
            <WorkspaceFields form={form} onChange={setForm} />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={!form.name.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Continue
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
