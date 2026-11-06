import { WorkspaceShell } from "@/components/app/workspace-shell"

// Workspace pages are client-side shells (data comes from the API in the browser), so the
// server render never differs per user. An empty list renders each workspace's pages on
// first visit and then serves them from the CDN, so sidebar clicks don't wait on a server render.
export function generateStaticParams() {
  return []
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>
}
