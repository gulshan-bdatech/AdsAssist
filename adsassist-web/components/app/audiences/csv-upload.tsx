"use client"

import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileSpreadsheet, Loader2, Upload } from "lucide-react"
import Papa from "papaparse"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type AudienceUploadRow } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { useWorkspace } from "@/lib/workspace"

type Field = keyof AudienceUploadRow
const FIELDS: { key: Field; label: string; match: RegExp }[] = [
  { key: "email", label: "Email", match: /e-?mail/i },
  { key: "phone", label: "Phone", match: /(phone|mobile|whatsapp|contact)/i },
  { key: "firstName", label: "First name", match: /(first|given|^name$|full.?name|customer.?name)/i },
  { key: "lastName", label: "Last name", match: /(last|sur|family)/i },
]
const CHUNK = 50_000
const NONE = "__none"

interface Parsed {
  fileName: string
  headers: string[]
  rows: Record<string, string>[]
}

/** Detects the best column for each field from header names. */
function autoMap(headers: string[]): Record<Field, string> {
  const used = new Set<string>()
  const out = {} as Record<Field, string>
  for (const f of FIELDS) {
    const hit = headers.find((h) => !used.has(h) && f.match.test(h))
    out[f.key] = hit ?? ""
    if (hit) used.add(hit)
  }
  return out
}

export function CsvUpload({ audienceId, onDone }: { audienceId: string; onDone?: () => void }) {
  const { wid } = useWorkspace()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<Record<Field, string>>({ email: "", phone: "", firstName: "", lastName: "" })
  const [mode, setMode] = useState<"append" | "replace">("append")
  const [progress, setProgress] = useState(0)

  const onFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = res.meta.fields ?? []
        if (!headers.length || !res.data.length) {
          toast.error("That file has no rows")
          return
        }
        setParsed({ fileName: file.name, headers, rows: res.data })
        setMapping(autoMap(headers))
      },
      error: (err) => toast.error(`Could not read CSV: ${err.message}`),
    })
  }

  const upload = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error("Choose a file first")
      const rows: AudienceUploadRow[] = parsed.rows
        .map((r) => {
          const row: AudienceUploadRow = {}
          for (const f of FIELDS) {
            const col = mapping[f.key]
            const v = col ? r[col]?.trim() : ""
            if (v) row[f.key] = v
          }
          return row
        })
        .filter((r) => r.email || r.phone)
      if (!rows.length) throw new Error("No rows have an email or phone in the mapped columns")
      let added = 0
      let skipped = parsed.rows.length - rows.length
      let size = 0
      // Only the first chunk may replace; later chunks append to it.
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await api.uploadAudience(wid, audienceId, {
          mode: i === 0 ? mode : "append",
          rows: rows.slice(i, i + CHUNK),
        })
        added += res.added
        skipped += res.skipped
        size = res.size
        setProgress(Math.min(100, Math.round(((i + CHUNK) / rows.length) * 100)))
      }
      return { added, skipped, size }
    },
    onSuccess: (r) => {
      toast.success(`Added ${formatNumber(r.added)} people (${formatNumber(r.skipped)} skipped). Audience size ${formatNumber(r.size)}.`)
      qc.invalidateQueries({ queryKey: ["ws", wid, "audiences"] })
      setParsed(null)
      setProgress(0)
      onDone?.()
    },
    onError: (e: Error) => {
      toast.error(e.message)
      setProgress(0)
    },
  })

  const mappedSomething = Boolean(mapping.email || mapping.phone)

  return (
    <div className="space-y-4">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ""
        }}
      />
      {!parsed ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center hover:bg-muted/40"
        >
          <FileSpreadsheet className="size-8 text-muted-foreground" />
          <span className="font-medium">Choose a CSV file</span>
          <span className="text-sm text-muted-foreground">Needs an email or phone column. Header row required.</span>
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{parsed.fileName}</span>
              <span className="text-muted-foreground">· {formatNumber(parsed.rows.length)} rows</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setParsed(null)} disabled={upload.isPending}>
              Change
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label} column</Label>
                <Select
                  value={mapping[f.key] || NONE}
                  onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === NONE ? "" : v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not in file</SelectItem>
                    {parsed.headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {FIELDS.map((f) => (
                    <TableHead key={f.key}>{f.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.rows.slice(0, 3).map((r, i) => (
                  <TableRow key={i}>
                    {FIELDS.map((f) => (
                      <TableCell key={f.key} className="max-w-40 truncate text-xs">
                        {mapping[f.key] ? r[mapping[f.key]] || "—" : "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "append" | "replace")}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="append">Add to existing members</SelectItem>
                  <SelectItem value="replace">Replace all members</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => upload.mutate()} disabled={!mappedSomething || upload.isPending}>
              {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              Upload {formatNumber(parsed.rows.length)} rows
            </Button>
          </div>
          {!mappedSomething ? <p className="text-xs text-destructive">Map at least an email or a phone column.</p> : null}
          {upload.isPending ? <Progress value={progress} /> : null}
          <p className="text-xs text-muted-foreground">
            Emails and phones are normalised and SHA-256 hashed before they are sent to Google or Meta.
          </p>
        </>
      )}
    </div>
  )
}
