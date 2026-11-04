import Cookies from "js-cookie"

export const TOKEN_COOKIE = "aa_token"

export function getToken(): string | undefined {
  if (typeof document === "undefined") return undefined
  return Cookies.get(TOKEN_COOKIE)
}

export function setToken(token: string) {
  Cookies.set(TOKEN_COOKIE, token, {
    expires: 7,
    sameSite: "lax",
    secure: typeof window !== "undefined" && window.location.protocol === "https:",
  })
}

export function clearToken() {
  Cookies.remove(TOKEN_COOKIE)
}
