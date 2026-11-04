"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CopyButton({
  value,
  label,
  className,
  size = "icon-sm",
}: {
  value: string
  label?: string
  className?: string
  size?: "icon-sm" | "sm" | "icon-xs"
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size={label ? "sm" : size}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          toast.success("Copied to clipboard")
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error("Could not copy")
        }
      }}
      aria-label="Copy"
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  )
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn("group relative", className)}>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 pr-12 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} className="absolute top-2 right-2" />
    </div>
  )
}
