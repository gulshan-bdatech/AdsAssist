import type { Role } from "@/lib/api"

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Full access, including billing and deleting the workspace" },
  admin: { label: "Admin", description: "Connect accounts, manage tracking, pipeline and team" },
  analyst: { label: "Analyst", description: "View everything, add leads and move them between stages" },
  viewer: { label: "Viewer", description: "Read-only access to dashboards and reports" },
}

export function assignableRoles(myRole: Role): Role[] {
  return myRole === "owner" ? ["owner", "admin", "analyst", "viewer"] : ["admin", "analyst", "viewer"]
}
