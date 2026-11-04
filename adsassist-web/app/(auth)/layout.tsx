import { BarChart3, Radio, Send } from "lucide-react"
import { Logo } from "@/components/app/logo"

const POINTS = [
  { icon: Radio, title: "Live Google & Meta data", text: "Spend, clicks and conversions synced from the ad platforms every few minutes." },
  { icon: BarChart3, title: "Ad → lead → revenue", text: "See which campaign produced the leads that actually converted." },
  { icon: Send, title: "Smarter bidding", text: "Qualified and won leads are sent back to Google and Meta automatically." },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-muted lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklch,var(--primary)_25%,transparent),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-center gap-8 p-12">
          <h2 className="max-w-md text-3xl font-semibold tracking-tight">
            Know which ad rupee turned into a customer.
          </h2>
          <div className="space-y-6">
            {POINTS.map((p) => (
              <div key={p.title} className="flex max-w-md gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
                  <p.icon className="size-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{p.title}</p>
                  <p className="text-sm text-muted-foreground">{p.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
