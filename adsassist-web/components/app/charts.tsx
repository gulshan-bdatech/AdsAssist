"use client"

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { PlatformIcon } from "@/components/app/badges"
import type { Platform, TimeseriesPoint, Totals } from "@/lib/api"
import { formatMoney, formatNumber, formatPercent, shortDay } from "@/lib/format"
import { cn } from "@/lib/utils"

const performanceConfig = {
  googleSpend: { label: "Google spend", color: "var(--chart-1)" },
  metaSpend: { label: "Meta spend", color: "var(--chart-2)" },
  spend: { label: "Spend", color: "var(--chart-1)" },
  leads: { label: "Leads", color: "var(--chart-3)" },
} satisfies ChartConfig

/** Spend bars (stacked Google/Meta, or a single series) with leads as a line on the right axis. */
export function PerformanceChart({
  data,
  currency,
  split = true,
  className,
}: {
  data: TimeseriesPoint[]
  currency: string
  split?: boolean
  className?: string
}) {
  return (
    <ChartContainer config={performanceConfig} className={cn("aspect-auto h-72 w-full", className)}>
      <ComposedChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(v: string) => shortDay(v)}
        />
        <YAxis
          yAxisId="spend"
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => formatMoney(v, currency, true)}
        />
        <YAxis yAxisId="leads" orientation="right" tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => shortDay(String(v))}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2.5 rounded-[2px]" style={{ background: item.color }} />
                    {performanceConfig[name as keyof typeof performanceConfig]?.label ?? name}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {name === "leads" ? formatNumber(Number(value)) : formatMoney(Number(value), currency)}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {split ? (
          <>
            <Bar yAxisId="spend" dataKey="googleSpend" stackId="spend" fill="var(--color-googleSpend)" radius={[0, 0, 0, 0]} />
            <Bar yAxisId="spend" dataKey="metaSpend" stackId="spend" fill="var(--color-metaSpend)" radius={[4, 4, 0, 0]} />
          </>
        ) : (
          <Bar yAxisId="spend" dataKey="spend" fill="var(--color-spend)" radius={[4, 4, 0, 0]} />
        )}
        <Line
          yAxisId="leads"
          dataKey="leads"
          type="monotone"
          stroke="var(--color-leads)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartContainer>
  )
}

export function FunnelBars({ stages }: { stages: { key: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count))
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1]!.count : null
        const rate = prev ? (s.count / prev) * 100 : null
        return (
          <div key={s.key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {rate !== null ? <span className="text-xs text-muted-foreground">{rate.toFixed(0)}% of prev</span> : null}
                <span className="font-semibold">{formatNumber(s.count)}</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(2, (s.count / max) * 100)}%`, opacity: 1 - i * 0.08 }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PlatformSplit({
  rows,
  currency,
}: {
  rows: (Totals & { platform: Platform })[]
  currency: string
}) {
  const total = rows.reduce((sum, r) => sum + r.spend, 0)
  return (
    <div className="space-y-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {rows.map((r) => (
          <div
            key={r.platform}
            style={{
              width: `${total ? (r.spend / total) * 100 : 0}%`,
              background: r.platform === "google" ? "var(--chart-1)" : "var(--chart-2)",
            }}
          />
        ))}
      </div>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.platform} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium">
                <PlatformIcon platform={r.platform} />
                {r.platform === "google" ? "Google Ads" : "Meta Ads"}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {total ? ((r.spend / total) * 100).toFixed(0) : 0}% of spend
              </span>
            </div>
            <dl className="grid grid-cols-4 gap-2 text-sm">
              <Stat label="Spend" value={formatMoney(r.spend, currency, true)} />
              <Stat label="Leads" value={formatNumber(r.leads)} />
              <Stat label="CPL" value={formatMoney(r.cpl, currency, true)} />
              <Stat label="CTR" value={formatPercent(r.ctr)} />
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
