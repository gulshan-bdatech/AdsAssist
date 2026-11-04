"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ErrorState, TableSkeleton } from "@/components/app/states"
import { ROLE_INFO, assignableRoles } from "@/components/app/settings/roles"
import { api, type Role } from "@/lib/api"
import { formatDate, initials } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

export function MembersSettings() {
  const { wid, canWrite, role: myRole, user } = useWorkspace()
  const qc = useQueryClient()
  const members = useQuery({ queryKey: ["ws", wid, "members"], queryFn: () => api.members(wid) })

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.updateMember(wid, userId, role),
    onSuccess: () => {
      toast.success("Role updated")
      qc.invalidateQueries({ queryKey: ["ws", wid, "members"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(wid, userId),
    onSuccess: () => {
      toast.success("Member removed")
      qc.invalidateQueries({ queryKey: ["ws", wid, "members"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const roles = assignableRoles(myRole)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>People with access to this workspace. Invite new people from the Invites tab.</CardDescription>
      </CardHeader>
      <CardContent>
        {members.isPending ? (
          <TableSkeleton rows={3} />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {canWrite ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.map((m) => {
                const isMe = m.userId === user.id
                const locked = !canWrite || isMe || (m.role === "owner" && myRole !== "owner")
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarFallback>{initials(m.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {m.name} {isMe ? <Badge variant="secondary" className="ml-1">You</Badge> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {locked ? (
                        <span className="text-sm">{ROLE_INFO[m.role].label}</span>
                      ) : (
                        <Select value={m.role} onValueChange={(v) => setRole.mutate({ userId: m.userId, role: v as Role })}>
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((r) => (
                              <SelectItem key={r} value={r}>
                                {ROLE_INFO[r].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(m.joinedAt)}</TableCell>
                    {canWrite ? (
                      <TableCell>
                        {!locked ? (
                          <ConfirmDialog
                            title={`Remove ${m.name}?`}
                            description="They lose access to this workspace immediately."
                            confirmLabel="Remove"
                            onConfirm={() => remove.mutate(m.userId)}
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label="Remove member">
                                <Trash2 />
                              </Button>
                            }
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
            <div key={r} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{ROLE_INFO[r].label}</p>
              <p className="text-muted-foreground">{ROLE_INFO[r].description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
