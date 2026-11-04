import { Activity } from "lucide-react"
import { cn } from "@/lib/utils"

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "AdsAssist"

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 font-semibold", className)}>
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Activity className="size-4" />
      </div>
      <span className="text-lg tracking-tight">{APP_NAME}</span>
    </div>
  )
}
