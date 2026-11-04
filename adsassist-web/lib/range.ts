"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { format, subDays } from "date-fns"
import type { Platform, RangeParams } from "@/lib/api"

export type RangePreset = "today" | "7d" | "30d" | "90d" | "custom"

export const PRESETS: { value: Exclude<RangePreset, "custom">; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
]

export const toDay = (d: Date) => format(d, "yyyy-MM-dd")

export function presetRange(days: number) {
  const to = new Date()
  return { from: toDay(subDays(to, days - 1)), to: toDay(to) }
}

/** Date range + platform filter kept in the URL (?from=&to=&platform=). */
export function useRangeParams() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const fallback = presetRange(30)
  const from = searchParams.get("from") || fallback.from
  const to = searchParams.get("to") || fallback.to
  const platformParam = searchParams.get("platform")
  const platform: Platform | undefined =
    platformParam === "google" || platformParam === "meta" ? platformParam : undefined

  const preset: RangePreset = useMemo(() => {
    for (const p of PRESETS) {
      const r = presetRange(p.days)
      if (r.from === from && r.to === to) return p.value
    }
    return "custom"
  }, [from, to])

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      const s = next.toString()
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const range: RangeParams = useMemo(() => ({ from, to, platform }), [from, to, platform])

  return {
    from,
    to,
    platform,
    preset,
    range,
    setRange: (r: { from: string; to: string }) => update({ from: r.from, to: r.to }),
    setPlatform: (p?: Platform) => update({ platform: p }),
    update,
  }
}
