"use client"

import { useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/app/page-header"
import { GeneralSettings } from "@/components/app/settings/general"
import { InvitesSettings } from "@/components/app/settings/invites"
import { MembersSettings } from "@/components/app/settings/members"
import { PipelineSettings } from "@/components/app/settings/pipeline"
import { ProfileSettings } from "@/components/app/settings/profile"
import { useRangeParams } from "@/lib/range"

const TABS = ["general", "pipeline", "members", "invites", "profile"] as const

export default function SettingsPage() {
  const params = useSearchParams()
  const { update } = useRangeParams()
  const raw = params.get("tab")
  const tab = TABS.includes(raw as (typeof TABS)[number]) ? (raw as string) : "general"

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Workspace, lead pipeline, team and your profile" />
      <Tabs value={tab} onValueChange={(v) => update({ tab: v === "general" ? undefined : v })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="pt-2">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="pipeline" className="pt-2">
          <PipelineSettings />
        </TabsContent>
        <TabsContent value="members" className="pt-2">
          <MembersSettings />
        </TabsContent>
        <TabsContent value="invites" className="pt-2">
          <InvitesSettings />
        </TabsContent>
        <TabsContent value="profile" className="pt-2">
          <ProfileSettings />
        </TabsContent>
      </Tabs>
    </div>
  )
}
