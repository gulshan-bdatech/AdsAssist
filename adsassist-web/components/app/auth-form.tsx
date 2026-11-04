"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { setToken } from "@/lib/auth"

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next")
  const [name, setName] = useState("")
  const [email, setEmail] = useState(params.get("email") ?? "")
  const [password, setPassword] = useState("")

  const submit = useMutation({
    mutationFn: () =>
      mode === "login"
        ? api.login({ email: email.trim(), password })
        : api.register({ name: name.trim(), email: email.trim(), password }),
    onSuccess: ({ accessToken }) => {
      setToken(accessToken)
      router.replace(next && next.startsWith("/") ? next : "/")
      router.refresh()
    },
  })

  const isLogin = mode === "login"
  const otherHref = `${isLogin ? "/register" : "/login"}${next ? `?next=${encodeURIComponent(next)}` : ""}`

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate()
      }}
    >
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{isLogin ? "Welcome back" : "Create your account"}</h1>
        <p className="text-sm text-muted-foreground">
          {isLogin ? "Sign in to see your live ad performance." : "Connect Google Ads and Meta in a couple of minutes."}
        </p>
      </div>

      {submit.error ? (
        <Alert variant="destructive">
          <AlertDescription>{submit.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4">
        {!isLogin ? (
          <div className="grid gap-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={isLogin ? undefined : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {!isLogin ? <p className="text-xs text-muted-foreground">At least 8 characters.</p> : null}
        </div>
        <Button type="submit" className="w-full" disabled={submit.isPending}>
          {submit.isPending ? <Loader2 className="animate-spin" /> : null}
          {isLogin ? "Sign in" : "Create account"}
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? "New to AdsAssist? " : "Already have an account? "}
        <Link href={otherHref} className="font-medium text-foreground underline underline-offset-4">
          {isLogin ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  )
}
