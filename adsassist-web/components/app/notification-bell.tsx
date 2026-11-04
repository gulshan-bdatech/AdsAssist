"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api, type AppNotification } from "@/lib/api"
import { formatDateTime, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const SEVERITY: Record<AppNotification["severity"], { icon: LucideIcon; tone: string }> = {
  critical: { icon: XCircle, tone: "text-red-600 dark:text-red-400" },
  warning: { icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, tone: "text-sky-600 dark:text-sky-400" },
  success: { icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
}

export function NotificationBell() {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const key = ["ws", wid, "notifications"]
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.notifications(wid, { pageSize: 20 }),
    refetchInterval: 60_000,
  })
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.markNotificationsRead(wid, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const unread = list.data?.unreadCount ?? 0
  const items = list.data?.items ?? []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications (${unread} unread)`}>
          <Bell />
          {unread ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-medium">Notifications</p>
          <Button variant="ghost" size="sm" disabled={!unread || markRead.isPending} onClick={() => markRead.mutate(undefined)}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        {list.isError ? (
          <p className="p-4 text-sm text-muted-foreground">Could not load notifications.</p>
        ) : items.length ? (
          <ScrollArea className="max-h-96">
            <div className="divide-y">
              {items.map((n) => {
                const meta = SEVERITY[n.severity] ?? SEVERITY.info
                const body = (
                  <div className={cn("flex gap-3 px-4 py-3 text-left hover:bg-muted/50", !n.read && "bg-primary/5")}>
                    <meta.icon className={cn("mt-0.5 size-4 shrink-0", meta.tone)} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className={cn("text-sm", !n.read && "font-medium")}>{n.title}</p>
                      {n.body ? <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p> : null}
                      <time className="text-xs text-muted-foreground" title={formatDateTime(n.createdAt)}>
                        {timeAgo(n.createdAt)}
                      </time>
                    </div>
                    {!n.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
                  </div>
                )
                const onOpen = () => {
                  if (!n.read) markRead.mutate([n.id])
                }
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={onOpen} className="block">
                    {body}
                  </Link>
                ) : (
                  <button key={n.id} type="button" onClick={onOpen} className="block w-full">
                    {body}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {list.isPending ? "Loading…" : "You're all caught up."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
