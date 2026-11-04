"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { WorkspaceSummary, WorkspaceType } from "@/lib/api"

export interface WorkspaceForm {
  name: string
  type: WorkspaceType
  parentId: string
  currency: string
  timezone: string
  phoneCountryCode: string
}

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"
  } catch {
    return "Asia/Kolkata"
  }
}

export const defaultWorkspaceForm: WorkspaceForm = {
  name: "",
  type: "client",
  parentId: "",
  currency: "INR",
  timezone: typeof window === "undefined" ? "Asia/Kolkata" : browserTimezone(),
  phoneCountryCode: "91",
}

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"]

export const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
]

export function WorkspaceFields({
  form,
  onChange,
  agencies = [],
  hideType,
}: {
  form: WorkspaceForm
  onChange: (form: WorkspaceForm) => void
  agencies?: WorkspaceSummary[]
  hideType?: boolean
}) {
  const set = <K extends keyof WorkspaceForm>(key: K, value: WorkspaceForm[K]) => onChange({ ...form, [key]: value })
  const timezones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES]

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="ws-name">Workspace name</Label>
        <Input
          id="ws-name"
          placeholder="Acme Finance"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          autoFocus
          required
        />
      </div>
      {!hideType ? (
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={form.type} onValueChange={(v) => set("type", v as WorkspaceType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Business / client</SelectItem>
              <SelectItem value="agency">Agency (manages clients)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {!hideType && form.type === "client" && agencies.length > 0 ? (
        <div className="space-y-2">
          <Label>Under agency (optional)</Label>
          <Select value={form.parentId || "none"} onValueChange={(v) => set("parentId", v === "none" ? "" : v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No agency</SelectItem>
              {agencies.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label>Currency</Label>
        <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Timezone</Label>
        <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timezones.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ws-cc">Phone country code</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">+</span>
          <Input
            id="ws-cc"
            inputMode="numeric"
            value={form.phoneCountryCode}
            onChange={(e) => set("phoneCountryCode", e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </div>
        <p className="text-xs text-muted-foreground">Used to normalise phone numbers before hashing.</p>
      </div>
    </div>
  )
}
