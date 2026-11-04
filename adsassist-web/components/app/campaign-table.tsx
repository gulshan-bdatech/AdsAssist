"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PlatformIcon, StatusBadge } from "@/components/app/badges"
import type { CampaignRow } from "@/lib/api"
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format"
import { cn } from "@/lib/utils"

type SortKey =
  | "name"
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "leads"
  | "cpl"
  | "wonLeads"
  | "revenue"
  | "roas"

interface Column {
  key: SortKey
  label: string
  render: (c: CampaignRow, currency: string) => React.ReactNode
  compact?: boolean
}

const COLUMNS: Column[] = [
  { key: "spend", label: "Spend", render: (c, cur) => formatMoney(c.spend, cur), compact: true },
  { key: "impressions", label: "Impr.", render: (c) => formatNumber(c.impressions, true) },
  { key: "clicks", label: "Clicks", render: (c) => formatNumber(c.clicks) },
  { key: "ctr", label: "CTR", render: (c) => formatPercent(c.ctr) },
  { key: "cpc", label: "CPC", render: (c, cur) => formatMoney(c.cpc, cur) },
  { key: "leads", label: "Leads", render: (c) => formatNumber(c.leads), compact: true },
  { key: "cpl", label: "CPL", render: (c, cur) => formatMoney(c.cpl, cur), compact: true },
  { key: "wonLeads", label: "Won", render: (c) => formatNumber(c.wonLeads) },
  { key: "revenue", label: "Revenue", render: (c, cur) => formatMoney(c.revenue, cur) },
  { key: "roas", label: "ROAS", render: (c) => formatRatio(c.roas), compact: true },
]

export function CampaignTable({
  wid,
  rows,
  currency,
  compact,
  defaultSort = "spend",
}: {
  wid: string
  rows: CampaignRow[]
  currency: string
  compact?: boolean
  defaultSort?: SortKey
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: defaultSort, dir: "desc" })
  const columns = compact ? COLUMNS.filter((c) => c.compact) : COLUMNS

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (typeof av === "string" || typeof bv === "string") {
        return String(av ?? "").localeCompare(String(bv ?? "")) * (sort.dir === "asc" ? 1 : -1)
      }
      const an = av ?? -Infinity
      const bn = bv ?? -Infinity
      return (an - bn) * (sort.dir === "asc" ? 1 : -1)
    })
    return copy
  }, [rows, sort])

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }))

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead label="Campaign" active={sort.key === "name"} dir={sort.dir} onClick={() => toggle("name")} align="left" />
          {!compact ? <TableHead>Status</TableHead> : null}
          {columns.map((c) => (
            <SortHead key={c.key} label={c.label} active={sort.key === c.key} dir={sort.dir} onClick={() => toggle(c.key)} />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="max-w-72">
              <Link href={`/w/${wid}/campaigns/${c.id}`} className="group flex items-center gap-2">
                <PlatformIcon platform={c.platform} className="shrink-0" />
                <div className="min-w-0">
                  <div className="truncate font-medium group-hover:underline">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.adAccountName}</div>
                </div>
              </Link>
            </TableCell>
            {!compact ? (
              <TableCell>
                <StatusBadge status={c.status} />
              </TableCell>
            ) : null}
            {columns.map((col) => (
              <TableCell key={col.key} className="text-right tabular-nums">
                {col.render(c, currency)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SortHead({
  label,
  active,
  dir,
  onClick,
  align = "right",
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
  align?: "left" | "right"
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={cn(align === "right" && "text-right")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </TableHead>
  )
}
