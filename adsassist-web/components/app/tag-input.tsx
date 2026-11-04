"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { splitList } from "@/lib/format"

/** Free-text chips (emails, page IDs). Enter, comma or paste adds; backspace on empty removes the last. */
export function TagInput({
  value,
  onChange,
  placeholder,
  validate,
  disabled,
}: {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  validate?: (v: string) => boolean
  disabled?: boolean
}) {
  const [draft, setDraft] = useState("")
  const [invalid, setInvalid] = useState(false)

  const commit = (text: string) => {
    const parts = splitList(text)
    if (!parts.length) return
    const ok = validate ? parts.filter(validate) : parts
    setInvalid(ok.length < parts.length)
    onChange([...new Set([...value, ...ok])])
    setDraft("")
  }

  return (
    <div className="space-y-2">
      <Input
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setInvalid(false)
          setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            commit(draft)
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text")
          if (/[\s,;]/.test(text)) {
            e.preventDefault()
            commit(text)
          }
        }}
      />
      {invalid ? <p className="text-xs text-destructive">Some values were not valid and were skipped.</p> : null}
      {value.length ? (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1 font-normal">
              {v}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="rounded-full hover:bg-muted"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
