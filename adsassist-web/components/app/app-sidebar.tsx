"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import {
  BellRing,
  Building2,
  Check,
  ChevronsUpDown,
  Code2,
  Fingerprint,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MailOpen,
  Megaphone,
  Plug,
  Plus,
  Radio,
  Send,
  Settings,
  Sparkles,
  Swords,
  Target,
  UserRound,
  Users,
  Webhook,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { NewWorkspaceDialog } from "@/components/app/new-workspace-dialog"
import { clearToken } from "@/lib/auth"
import { initials } from "@/lib/format"
import { roleAtLeast, useWorkspace } from "@/lib/workspace"

interface NavItem {
  title: string
  href: string
  icon: LucideIcon
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Performance",
    items: [
      { title: "Dashboard", href: "dashboard", icon: LayoutDashboard },
      { title: "Live", href: "live", icon: Radio },
      { title: "Campaigns", href: "campaigns", icon: Megaphone },
      { title: "Insights", href: "insights", icon: Lightbulb },
      { title: "AI Summary", href: "ai", icon: Sparkles },
    ],
  },
  {
    label: "Leads",
    items: [
      { title: "Leads", href: "leads", icon: Users },
      { title: "Contacts", href: "contacts", icon: Fingerprint },
      { title: "Conversions", href: "conversions", icon: Send },
    ],
  },
  {
    label: "Growth",
    items: [
      { title: "Audiences", href: "audiences", icon: Target },
      { title: "Competitors", href: "competitors", icon: Swords },
      { title: "Email tracking", href: "email", icon: MailOpen },
    ],
  },
  {
    label: "Automation",
    items: [
      { title: "Alerts", href: "alerts", icon: BellRing },
      { title: "Webhooks", href: "webhooks", icon: Webhook },
    ],
  },
  {
    label: "Setup",
    items: [
      { title: "Integrations", href: "integrations", icon: Plug },
      { title: "Tracking", href: "tracking", icon: Code2 },
      { title: "Settings", href: "settings", icon: Settings },
    ],
  },
]

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { wid } = useWorkspace()
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const href = `/w/${wid}/${item.href}`
                const active = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link href={href} onClick={() => setOpenMobile(false)}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function WorkspaceSwitcher() {
  const { workspace, workspaces } = useWorkspace()
  const { isMobile } = useSidebar()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const agencies = workspaces.filter((w) => w.type === "agency" && roleAtLeast(w.role, "admin"))
  const topLevel = workspaces.filter((w) => !w.parentId || !workspaces.some((p) => p.id === w.parentId))
  const childrenOf = (id: string) => workspaces.filter((w) => w.parentId === id)

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                  {initials(workspace.name)}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{workspace.name}</span>
                  <span className="truncate text-xs text-muted-foreground capitalize">
                    {workspace.type} · {workspace.role}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
              {topLevel.map((w) => (
                <DropdownMenuGroup key={w.id}>
                  <WorkspaceItem ws={w} current={workspace.id} onSelect={() => router.push(`/w/${w.id}/dashboard`)} />
                  {childrenOf(w.id).map((c) => (
                    <WorkspaceItem
                      key={c.id}
                      ws={c}
                      nested
                      current={workspace.id}
                      onSelect={() => router.push(`/w/${c.id}/dashboard`)}
                    />
                  ))}
                </DropdownMenuGroup>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
                <Plus /> New workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      {dialogOpen ? (
        <NewWorkspaceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          agencies={agencies}
          defaultParentId={workspace.type === "agency" && roleAtLeast(workspace.role, "admin") ? workspace.id : undefined}
        />
      ) : null}
    </>
  )
}

function WorkspaceItem({
  ws,
  current,
  nested,
  onSelect,
}: {
  ws: { id: string; name: string; type: string }
  current: string
  nested?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={nested ? "pl-6" : undefined}>
      {ws.type === "agency" ? <Building2 /> : <UserRound />}
      <span className="truncate">{ws.name}</span>
      {ws.id === current ? <Check className="ml-auto" /> : null}
    </DropdownMenuItem>
  )
}

function NavUser() {
  const { user, wid } = useWorkspace()
  const { isMobile } = useSidebar()
  const router = useRouter()
  const qc = useQueryClient()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="grid text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push(`/w/${wid}/settings?tab=profile`)}>
              <UserRound /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push(`/w/${wid}/settings`)}>
              <Settings /> Workspace settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                clearToken()
                qc.clear()
                router.replace("/login")
              }}
            >
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
