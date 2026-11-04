"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Users } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { PlatformIcon } from "@/components/app/badges"
import { MultiSelect, type Option } from "@/components/app/multi-select"
import { ErrorState } from "@/components/app/states"
import { api, type AudienceEventType, type AudienceRules, type AudienceType, type Channel } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { usePipeline } from "@/lib/hooks"
import { presetRange } from "@/lib/range"
import { useWorkspace } from "@/lib/workspace"

const CHANNELS: Option[] = [
  { value: "google", label: "Google Ads", icon: <PlatformIcon platform="google" className="size-3.5" /> },
  { value: "meta", label: "Meta Ads", icon: <PlatformIcon platform="meta" className="size-3.5" /> },
  { value: "organic", label: "Organic" },
  { value: "other", label: "Other" },
]

const EVENT_TYPES: Option[] = [
  { value: "form_start", label: "Started a form" },
  { value: "form_abandon", label: "Abandoned a form" },
  { value: "form_submit", label: "Submitted a form" },
  { value: "conversion", label: "Converted" },
  { value: "email_open", label: "Opened an email" },
  { value: "email_click", label: "Clicked an email" },
]

const CONTACT_STATUS: Option[] = [
  { value: "known", label: "Known (one device)" },
  { value: "cross_device", label: "Cross-device" },
]

/** Removes empty arrays/undefined so the API only sees rules that are actually set. */
export function cleanRules(type: AudienceType, r: AudienceRules): AudienceRules {
  const out: AudienceRules = {}
  const keep = <K extends keyof AudienceRules>(k: K) => {
    const v = r[k]
    if (v === undefined || v === null) return
    if (Array.isArray(v) && !v.length) return
    out[k] = v
  }
  if (type === "leads") (["stages", "excludeStages", "channels", "campaignIds", "createdWithinDays"] as const).forEach(keep)
  if (type === "contacts") (["minIntentScore", "contactStatus", "eventTypes", "createdWithinDays"] as const).forEach(keep)
  return out
}

export function RuleBuilder({
  type,
  rules,
  onChange,
  disabled,
}: {
  type: AudienceType
  rules: AudienceRules
  onChange: (rules: AudienceRules) => void
  disabled?: boolean
}) {
  const { wid } = useWorkspace()
  const pipeline = usePipeline(wid)
  const campaigns = useQuery({
    queryKey: ["ws", wid, "campaigns", "picker"],
    queryFn: () => api.campaigns(wid, { ...presetRange(90), status: "all" }),
    enabled: type === "leads",
  })
  const set = (patch: Partial<AudienceRules>) => onChange({ ...rules, ...patch })
  const stageOptions: Option[] = (pipeline.data ?? []).map((s) => ({ value: s.key, label: s.label }))
  const campaignOptions: Option[] = (campaigns.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    icon: <PlatformIcon platform={c.platform} className="size-3.5" />,
  }))

  const daysField = (
    <div className="space-y-2">
      <Label htmlFor="within">Created in the last (days)</Label>
      <Input
        id="within"
        type="number"
        min={1}
        max={540}
        placeholder="Any time"
        disabled={disabled}
        value={rules.createdWithinDays ?? ""}
        onChange={(e) => set({ createdWithinDays: e.target.value ? Math.min(540, Math.max(1, Number(e.target.value))) : undefined })}
      />
    </div>
  )

  if (type === "leads") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>In stages</Label>
          <MultiSelect options={stageOptions} value={rules.stages ?? []} onChange={(v) => set({ stages: v })} placeholder="Any stage" disabled={disabled} />
        </div>
        <div className="space-y-2">
          <Label>Exclude stages</Label>
          <MultiSelect
            options={stageOptions}
            value={rules.excludeStages ?? []}
            onChange={(v) => set({ excludeStages: v })}
            placeholder="None"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>Channels</Label>
          <MultiSelect
            options={CHANNELS}
            value={rules.channels ?? []}
            onChange={(v) => set({ channels: v as Channel[] })}
            placeholder="Any channel"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>Campaigns</Label>
          <MultiSelect
            options={campaignOptions}
            value={rules.campaignIds ?? []}
            onChange={(v) => set({ campaignIds: v })}
            placeholder={campaigns.isPending ? "Loading…" : "Any campaign"}
            searchPlaceholder="Search campaigns…"
            disabled={disabled}
          />
        </div>
        {daysField}
      </div>
    )
  }

  if (type === "contacts") {
    const score = rules.minIntentScore ?? 0
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 sm:col-span-2">
          <div className="flex items-center justify-between">
            <Label>Minimum intent score</Label>
            <span className="text-sm font-medium tabular-nums">{score}</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[score]}
            disabled={disabled}
            onValueChange={([v]) => set({ minIntentScore: v || undefined })}
          />
          <p className="text-xs text-muted-foreground">
            Based on recent behaviour: form starts, submits and conversions score highest.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Identity</Label>
          <MultiSelect
            options={CONTACT_STATUS}
            value={rules.contactStatus ?? []}
            onChange={(v) => set({ contactStatus: v as AudienceRules["contactStatus"] })}
            placeholder="Any"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>Did any of</Label>
          <MultiSelect
            options={EVENT_TYPES}
            value={rules.eventTypes ?? []}
            onChange={(v) => set({ eventTypes: v as AudienceEventType[] })}
            placeholder="Any activity"
            disabled={disabled}
          />
        </div>
        {daysField}
      </div>
    )
  }

  return null
}

/** Live size estimate; refreshes 600 ms after the rules stop changing. */
export function AudiencePreviewCard({ type, rules }: { type: AudienceType; rules: AudienceRules }) {
  const { wid } = useWorkspace()
  const cleaned = cleanRules(type, rules)
  const key = JSON.stringify(cleaned)
  const [debounced, setDebounced] = useState(key)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), 600)
    return () => clearTimeout(t)
  }, [key])

  const preview = useQuery({
    queryKey: ["ws", wid, "audience-preview", type, debounced],
    queryFn: () => api.previewAudience(wid, { type, rules: JSON.parse(debounced) as AudienceRules }),
    enabled: type !== "upload",
    placeholderData: (prev) => prev,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Estimated size
          {preview.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </CardTitle>
        <CardDescription>People matching these rules who have an email or phone and haven&apos;t opted out</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview.isError ? (
          <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="People" value={preview.data?.size} />
              <Stat label="With email" value={preview.data?.emailCount} />
              <Stat label="With phone" value={preview.data?.phoneCount} />
            </div>
            {preview.data?.sample.length ? (
              <div className="divide-y rounded-lg border text-sm">
                {preview.data.sample.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <Users className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{m.name || "—"}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{m.email || m.phone || "—"}</span>
                  </div>
                ))}
              </div>
            ) : preview.data ? (
              <p className="text-sm text-muted-foreground">Nobody matches yet. Loosen the rules or wait for more leads.</p>
            ) : null}
            {preview.data && preview.data.size > 0 && preview.data.size < 100 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Ad platforms need roughly 100+ matched people before they will serve ads to an audience.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value === undefined ? "—" : formatNumber(value)}</p>
    </div>
  )
}
