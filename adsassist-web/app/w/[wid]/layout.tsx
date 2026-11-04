"use client"

import { Suspense, useEffect, useMemo } from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { AppSidebar } from "@/components/app/app-sidebar"
import { NotificationBell } from "@/components/app/notification-bell"
import { ThemeToggle } from "@/components/app/theme-toggle"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states"
import { api } from "@/lib/api"
import { humanize } from "@/lib/format"
import { LAST_WORKSPACE_KEY, WorkspaceContext, roleAtLeast, type WorkspaceContextValue } from "@/lib/workspace"

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { wid } = useParams<{ wid: string }>()
  const me = useQuery({ queryKey: ["me"], queryFn: api.me })

  const value = useMemo<WorkspaceContextValue | null>(() => {
    if (!me.data) return null
    const workspace = me.data.workspaces.find((w) => w.id === wid)
    if (!workspace) return null
    return {
      wid,
      workspace,
      workspaces: me.data.workspaces,
      user: me.data.user,
      role: workspace.role,
      canWrite: roleAtLeast(workspace.role, "admin"),
      canAnalyze: roleAtLeast(workspace.role, "analyst"),
      isOwner: workspace.role === "owner",
      currency: workspace.currency || "INR",
    }
  }, [me.data, wid])

  useEffect(() => {
    if (!value) return
    try {
      localStorage.setItem(LAST_WORKSPACE_KEY, value.wid)
    } catch {}
  }, [value])

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-7xl p-6">
        <PageSkeleton />
      </div>
    )
  }
  if (me.isError) {
    return (
      <div className="mx-auto max-w-xl p-6 pt-24">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    )
  }
  if (!value) {
    return (
      <div className="mx-auto max-w-xl p-6 pt-24">
        <EmptyState
          title="Workspace not found"
          description="It may have been removed, or you are not a member of it."
          action={
            <Button asChild>
              <Link href="/">Go to my workspaces</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <WorkspaceContext.Provider value={value}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <PageCrumbs />
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
            <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceContext.Provider>
  )
}

const SECTION_LABEL: Record<string, string> = { ai: "AI Summary", email: "Email tracking" }

function PageCrumbs() {
  const pathname = usePathname()
  const parts = pathname.split("/").filter(Boolean).slice(2)
  const section = parts[0] ?? "dashboard"
  const label = SECTION_LABEL[section] ?? humanize(section)
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {parts.length > 1 ? (
            <BreadcrumbLink asChild>
              <Link href={pathname.split("/").slice(0, 4).join("/")}>{label}</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>{label}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {parts.length > 1 ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Details</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
