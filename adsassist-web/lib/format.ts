import { formatDistanceToNowStrict, format, parseISO } from "date-fns"

export function formatMoney(value: number | null | undefined, currency = "INR", compact = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact || Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function formatNumber(value: number | null | undefined, compact = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat("en-IN", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value)
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return `${value.toFixed(digits)}%`
}

export function formatRatio(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return `${value.toFixed(2)}x`
}

/** % change from previous to current; null when previous is 0 or missing. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined) {
  if (current === null || current === undefined || !previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never"
  try {
    return `${formatDistanceToNowStrict(parseISO(iso))} ago`
  } catch {
    return "—"
  }
}

export function formatDate(iso: string | null | undefined, pattern = "d MMM yyyy") {
  if (!iso) return "—"
  try {
    return format(parseISO(iso), pattern)
  } catch {
    return iso
  }
}

export function formatDateTime(iso: string | null | undefined) {
  return formatDate(iso, "d MMM yyyy, HH:mm")
}

export function shortDay(day: string) {
  return formatDate(day, "d MMM")
}

export function initials(name?: string | null) {
  if (!name) return "?"
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}

export function humanize(value: string | null | undefined) {
  if (!value) return "—"
  return value.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}


/** Splits "a@x.com, b@y.com\nc@z.com" into a clean, de-duplicated list. */
export function splitList(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean))]
}
