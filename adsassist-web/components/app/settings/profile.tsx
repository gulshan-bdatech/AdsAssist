"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { useWorkspace } from "@/lib/workspace"

export function ProfileSettings() {
  const { user } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState(user.name)
  const [currentPassword, setCurrent] = useState("")
  const [newPassword, setNew] = useState("")
  const [confirm, setConfirm] = useState("")

  const saveName = useMutation({
    mutationFn: () => api.updateMe({ name: name.trim() }),
    onSuccess: () => {
      toast.success("Profile updated")
      qc.invalidateQueries({ queryKey: ["me"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const savePassword = useMutation({
    mutationFn: () => api.updateMe({ currentPassword, newPassword }),
    onSuccess: () => {
      toast.success("Password changed")
      setCurrent("")
      setNew("")
      setConfirm("")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const mismatch = confirm.length > 0 && confirm !== newPassword

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) saveName.mutate()
          }}
        >
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 py-6">
            <Label htmlFor="p-name">Full name</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={saveName.isPending || !name.trim() || name.trim() === user.name}>
              {saveName.isPending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </CardFooter>
        </form>
      </Card>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!mismatch && newPassword.length >= 8) savePassword.mutate()
          }}
        >
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>At least 8 characters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 py-6">
            <div className="space-y-2">
              <Label htmlFor="p-cur">Current password</Label>
              <Input id="p-cur" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-new">New password</Label>
              <Input id="p-new" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-confirm">Confirm new password</Label>
              <Input
                id="p-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={mismatch}
              />
              {mismatch ? <p className="text-xs text-destructive">Passwords do not match.</p> : null}
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              type="submit"
              disabled={savePassword.isPending || !currentPassword || newPassword.length < 8 || mismatch || !confirm}
            >
              {savePassword.isPending ? <Loader2 className="animate-spin" /> : null}
              Change password
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
