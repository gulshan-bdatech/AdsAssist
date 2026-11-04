"use client"

import { useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface Option {
  value: string
  label: string
  icon?: React.ReactNode
}

/** Searchable checkbox list in a popover; selected values show as removable chips. */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Any",
  searchPlaceholder = "Search…",
  disabled,
  className,
}: {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = new Set(value)
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v])
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
            <span className={cn("truncate", !value.length && "text-muted-foreground")}>
              {value.length ? `${value.length} selected` : placeholder}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
          <Command>
            {options.length > 6 ? <CommandInput placeholder={searchPlaceholder} /> : null}
            <CommandList>
              <CommandEmpty>Nothing found.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)}>
                    <Check className={cn("size-4", selected.has(o.value) ? "opacity-100" : "opacity-0")} />
                    {o.icon}
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length ? (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1 font-normal">
              {labelOf(v)}
              {!disabled ? (
                <button type="button" onClick={() => toggle(v)} aria-label={`Remove ${labelOf(v)}`} className="rounded-full hover:bg-muted">
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
