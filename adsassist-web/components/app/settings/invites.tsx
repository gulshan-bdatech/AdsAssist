"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, MailPlus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/app/badges"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { CopyButton } from "@/components/app/copy-button"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states"
import { ROLE_INFO, assignableRoles } from "@/components/app/settings/roles"
import { api, type Role } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export function InvitesSettings() {
  const { wid, canWrite, role: myRole } = useWorkspace()
  const qc = useQueryClient()
  const invites = useQuery({ queryKey: ["ws", wid, "invites"], queryFn: () => api.invites(wid), enabled: canWrite })
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("analyst")
  const [lastLink, setLastLink] = useState<{ email: string; url: string } | null>(null)

  const create = useMutation({
    mutationFn: () => api.createInvite(wid, { email: email.trim(), role }),
    onSuccess: (inv) => {
      setLastLink({ email: inv.email, url: inv.acceptUrl })
      setEmail("")
      qc.invalidateQueries({ queryKey: ["ws", wid, "invites"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvite(wid, id),
    onSuccess: () => {
      toast.success("Invite revoked")
      qc.invalidateQueries({ queryKey: ["ws", wid, "invites"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!canWrite) {
    return <EmptyState icon={MailPlus} title="Only admins can invite people" description="Ask a workspace admin to send you an invite link." />
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>They get a link to join this workspace. Share it by email or chat.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              if (email.trim()) create.mutate()
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles(myRole).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_INFO[r].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!email.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <MailPlus />}
              Create invite
            </Button>
          </form>
          {lastLink ? (
            <Alert>
              <MailPlus />
              <AlertTitle>Invite link for {lastLink.email}</AlertTitle>
              <AlertDescription>
                <div className="mt-2 flex w-full gap-2">
                  <Input readOnly value={lastLink.url} className="font-mono text-xs" />
                  <CopyButton value={lastLink.url} />
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invites</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.isPending ? (
            <TableSkeleton rows={2} />
          ) : invites.isError ? (
            <ErrorState error={invites.error} onRetry={() => invites.refetch()} />
          ) : invites.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.data.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.email}</TableCell>
                    <TableCell>{ROLE_INFO[i.role]?.label ?? i.role}</TableCell>
                    <TableCell>
                      <StatusBadge status={i.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(i.expiresAt)}</TableCell>
                    <TableCell>
                      {i.status === "pending" ? (
                        <ConfirmDialog
                          title="Revoke this invite?"
                          description={`The link sent to ${i.email} will stop working.`}
                          confirmLabel="Revoke"
                          onConfirm={() => revoke.mutate(i.id)}
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label="Revoke invite">
                              <Trash2 />
                            </Button>
                          }
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No invites sent yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
