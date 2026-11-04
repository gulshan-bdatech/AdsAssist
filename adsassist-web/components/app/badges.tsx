import { Badge } from "@/components/ui/badge"
import type { Channel } from "@/lib/api"
import { humanize } from "@/lib/format"
import { cn } from "@/lib/utils"

export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.83z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}

export function MetaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <path
        fill="#0866FF"
        d="M6.9 5C4 5 2 8.6 2 12.3 2 15.3 3.4 17 5.7 17c1.7 0 2.9-.8 4.7-3.9l1.4-2.4.4.7 1.2 2c1.8 3 3 3.6 4.8 3.6 2.4 0 3.8-2 3.8-5.2C22 8.2 19.9 5 17 5c-1.6 0-2.9 1-4.4 3.1L12 9l-.6-.9C10 6 8.6 5 6.9 5zm.1 2.3c1 0 1.9.7 3.3 2.8l-1.2 1.9c-1.5 2.4-2.1 2.8-2.9 2.8-.9 0-1.6-.8-1.6-2.6 0-2.7 1.2-4.9 2.4-4.9zm9.9 0c1.3 0 2.5 2.2 2.5 4.9 0 1.6-.6 2.5-1.5 2.5-.9 0-1.4-.5-3-3.1l-1.1-1.9c1.3-2 2.1-2.4 3.1-2.4z"
      />
    </svg>
  )
}

export function PlatformIcon({ platform, className }: { platform: Channel | string; className?: string }) {
  if (platform === "google") return <GoogleMark className={className} />
  if (platform === "meta") return <MetaMark className={className} />
  return <span className={cn("inline-block size-2 rounded-full bg-muted-foreground/60", className)} aria-hidden />
}

const CHANNEL_LABEL: Record<string, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
  organic: "Organic",
  other: "Other",
}

export function PlatformBadge({ platform, short }: { platform: Channel | string; short?: boolean }) {
  const label = CHANNEL_LABEL[platform] ?? humanize(platform)
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <PlatformIcon platform={platform} className="size-3" />
      {short ? label.replace(" Ads", "") : label}
    </Badge>
  )
}

type Tone = "green" | "amber" | "red" | "blue" | "gray" | "violet"

const TONE: Record<Tone, string> = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  red: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  gray: "border-border bg-muted text-muted-foreground",
}

const STATUS_TONE: Record<string, Tone> = {
  active: "green",
  success: "green",
  sent: "green",
  synced: "green",
  won: "green",
  accepted: "green",
  known: "blue",
  cross_device: "violet",
  running: "blue",
  pending: "amber",
  paused: "amber",
  skipped: "gray",
  anonymous: "gray",
  other: "gray",
  removed: "gray",
  revoked: "gray",
  disconnected: "gray",
  lost: "red",
  failed: "red",
  error: "red",
}

export function StatusBadge({
  status,
  label,
  tone,
  className,
}: {
  status: string | null | undefined
  label?: string
  tone?: Tone
  className?: string
}) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const t = tone ?? STATUS_TONE[status] ?? "gray"
  return (
    <Badge variant="outline" className={cn("font-normal capitalize", TONE[t], className)}>
      {label ?? humanize(status)}
    </Badge>
  )
}

export function stageTone(kind?: "open" | "won" | "lost"): Tone {
  if (kind === "won") return "green"
  if (kind === "lost") return "red"
  return "blue"
}

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  pixel: "Website pixel",
  api: "CRM / API",
  manual: "Added manually",
  meta_form: "Meta instant form",
}

/** Marks leads imported from Meta instant forms (shown next to the name in tables). */
export function LeadSourceBadge({ source }: { source: string }) {
  if (source !== "meta_form") return null
  return (
    <Badge variant="outline" className="gap-1 px-1.5 font-normal">
      <MetaMark className="size-3" /> Form
    </Badge>
  )
}

/** Consent from the pixel or form: null means it was never asked. */
export function consentLabel(consent: boolean | null | undefined) {
  if (consent === true) return "Given"
  if (consent === false) return "Opted out"
  return "Not asked"
}
