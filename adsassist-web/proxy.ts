import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const TOKEN_COOKIE = "aa_token"
const PUBLIC_PATHS = ["/login", "/register", "/invite"]

// Optimistic check only: the API validates the JWT on every request.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const hasToken = Boolean(request.cookies.get(TOKEN_COOKIE)?.value)
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!hasToken && !isPublic) {
    const url = new URL("/login", request.url)
    if (pathname !== "/") url.searchParams.set("next", pathname + search)
    return NextResponse.redirect(url)
  }

  if (hasToken && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
