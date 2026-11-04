"use client"

import { useState } from "react"
import { CalendarDays } from "lucide-react"
import { parseISO } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { PlatformIcon } from "@/components/app/badges"
import { formatDate } from "@/lib/format"
import { PRESETS, presetRange, toDay, useRangeParams } from "@/lib/range"
import { cn } from "@/lib/utils"

export function DateRangeFilter({ className }: { className?: string }) {
  const { from, to, preset, setRange } = useRangeParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()

  const label =
    preset === "custom"
      ? `${formatDate(from, "d MMM")} – ${formatDate(to, "d MMM yyyy")}`
      : PRESETS.find((p) => p.value === preset)?.label

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDraft({ from: parseISO(from), to: parseISO(to) })
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("justify-start", className)}>
          <CalendarDays />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 p-2 sm:w-36 sm:flex-col">
            {PRESETS.map((p) => (
              <Button
                key={p.value}
                variant={preset === p.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  setRange(presetRange(p.days))
                  setOpen(false)
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Separator orientation="vertical" className="hidden sm:block" />
          <div className="p-1">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from}
              disabled={{ after: new Date() }}
              className="[--cell-size:--spacing(8)]"
            />
            <div className="flex justify-end gap-2 border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!draft?.from}
                onClick={() => {
                  if (!draft?.from) return
                  setRange({ from: toDay(draft.from), to: toDay(draft.to ?? draft.from) })
                  setOpen(false)
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function PlatformFilter({ className }: { className?: string }) {
  const { platform, setPlatform } = useRangeParams()
  return (
    <Select
      value={platform ?? "all"}
      onValueChange={(v) => setPlatform(v === "google" || v === "meta" ? v : undefined)}
    >
      <SelectTrigger className={cn("w-40", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All platforms</SelectItem>
        <SelectItem value="google">
          <PlatformIcon platform="google" /> Google Ads
        </SelectItem>
        <SelectItem value="meta">
          <PlatformIcon platform="meta" /> Meta Ads
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
