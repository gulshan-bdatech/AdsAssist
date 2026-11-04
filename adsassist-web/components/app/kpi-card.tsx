import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * `invert` marks metrics where going down is good (CPL, CPC, CPA).
 */
export function KpiCard({
  label,
  value,
  change,
  invert,
  icon: Icon,
  hint,
  className,
}: {
  label: string
  value: React.ReactNode
  change?: number | null
  invert?: boolean
  icon?: LucideIcon
  hint?: string
  className?: string
}) {
  const hasChange = change !== undefined
  const good = change !== null && change !== undefined && (invert ? change < 0 : change > 0)
  const bad = change !== null && change !== undefined && (invert ? change > 0 : change < 0)
  const Arrow = !change ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight

  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardContent className="space-y-2 px-4">
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="truncate">{label}</span>
          {Icon ? <Icon className="size-4 shrink-0" /> : null}
        </div>
        <div className="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {hasChange ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium",
                  good && "text-emerald-600 dark:text-emerald-400",
                  bad && "text-red-600 dark:text-red-400",
                  !good && !bad && "text-muted-foreground",
                )}
              >
                <Arrow className="size-3.5" />
                {change === null ? "no prior data" : `${Math.abs(change).toFixed(1)}%`}
              </div>
            </TooltipTrigger>
            <TooltipContent>{hint ?? "Compared with the previous period of the same length"}</TooltipContent>
          </Tooltip>
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
