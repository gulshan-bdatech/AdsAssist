"use client"

import { createContext, useContext } from "react"
import type { Role, User, WorkspaceSummary } from "@/lib/api"

export interface WorkspaceContextValue {
  wid: string
  workspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  user: User
  role: Role
  canWrite: boolean
  canAnalyze: boolean
  isOwner: boolean
  currency: string
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used inside a workspace layout")
  return ctx
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2, owner: 3 }

export function roleAtLeast(role: Role, min: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export const LAST_WORKSPACE_KEY = "aa_last_workspace"
