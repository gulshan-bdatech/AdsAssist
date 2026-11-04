"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, FileSpreadsheet, Fingerprint, Loader2, Users } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { AudiencePreviewCard, RuleBuilder, cleanRules } from "@/components/app/audiences/rule-builder"
import { PageHeader } from "@/components/app/page-header"
import { EmptyState } from "@/components/app/states"
import { api, type AudienceRules, type AudienceType } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const TYPES: { value: AudienceType; title: string; description: string; icon: LucideIcon }[] = [
  { value: "leads", title: "Leads", description: "From your pipeline: stage, channel, campaign", icon: Users },
  { value: "contacts", title: "Website visitors", description: "Identified by the pixel: intent and behaviour", icon: Fingerprint },
  { value: "upload", title: "Upload a list", description: "Customer CSV with emails or phones", icon: FileSpreadsheet },
]

export default function NewAudiencePage() {
  const { wid, canWrite } = useWorkspace()
  const router = useRouter()
  const qc = useQueryClient()
  const [type, setType] = useState<AudienceType>("leads")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [rules, setRules] = useState<AudienceRules>({})
  const [autoSync, setAutoSync] = useState(true)
  const [consent, setConsent] = useState(false)

  const create = useMutation({
    mutationFn: () =>
      api.createAudience(wid, {
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        rules: cleanRules(type, rules),
        autoSync: type === "upload" ? false : autoSync,
        consentConfirmed: true,
      }),
    onSuccess: (a) => {
      toast.success("Audience created")
      qc.invalidateQueries({ queryKey: ["ws", wid, "audiences"] })
      // Upload lists are filled on the detail page.
      router.push(`/w/${wid}/audiences/${a.id}${type === "upload" ? "?upload=1" : ""}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!canWrite) {
    return <EmptyState title="Admins only" description="Ask a workspace admin to create audiences." />
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/w/${wid}/audiences`}>
          <ArrowLeft /> Audiences
        </Link>
      </Button>
      <PageHeader title="New audience" description="Who should be in it? You can sync it to ad accounts after it is created." />

      <div className="grid gap-3 sm:grid-cols-3">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              setType(t.value)
              setRules({})
            }}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/40",
              type === t.value && "border-primary ring-1 ring-primary",
            )}
          >
            <t.icon className="mt-0.5 size-5 text-muted-foreground" />
            <span>
              <span className="block font-medium">{t.title}</span>
              <span className="block text-sm text-muted-foreground">{t.description}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && consent) create.mutate()
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Abandoned loan applications – last 30 days"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
            </CardContent>
          </Card>

          {type !== "upload" ? (
            <Card>
              <CardHeader>
                <CardTitle>Rules</CardTitle>
                <CardDescription>All rules must match. Leave a rule empty to ignore it.</CardDescription>
              </CardHeader>
              <CardContent>
                <RuleBuilder type={type} rules={rules} onChange={setRules} />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Upload</CardTitle>
                <CardDescription>Create the audience first, then upload your CSV on the next screen.</CardDescription>
              </CardHeader>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-4">
              {type !== "upload" ? (
                <label className="flex items-start justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">Keep it up to date</span>
                    <span className="block text-sm text-muted-foreground">Recompute and re-sync to ad platforms every day.</span>
                  </span>
                  <Switch checked={autoSync} onCheckedChange={setAutoSync} />
                </label>
              ) : null}
              <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                <span className="text-sm">
                  I confirm these people agreed to be contacted and to their data being used for advertising, as required by
                  Google&apos;s Customer Match and Meta&apos;s Custom Audience terms.
                </span>
              </label>
              <div className="flex justify-end">
                <Button type="submit" disabled={!name.trim() || !consent || create.isPending}>
                  {create.isPending ? <Loader2 className="animate-spin" /> : null}
                  Create audience
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>

        {type !== "upload" ? (
          <div className="lg:sticky lg:top-20 lg:self-start">
            <AudiencePreviewCard type={type} rules={rules} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
