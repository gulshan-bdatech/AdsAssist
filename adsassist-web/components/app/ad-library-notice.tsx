import { Info } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/** Meta's Ad Library API coverage limits, shown wherever competitor ads appear. */
export function AdLibraryNotice() {
  return (
    <Alert>
      <Info />
      <AlertTitle>What Meta&apos;s Ad Library API can show</AlertTitle>
      <AlertDescription>
        <p>
          It returns <strong>all ads only when they ran in the EU or UK</strong>. For other countries (including India) it returns only
          political and social-issue ads, so most commercial competitor ads there won&apos;t appear. It also needs a connected Meta
          user who has confirmed their identity for the Ad Library API.
        </p>
      </AlertDescription>
    </Alert>
  )
}
