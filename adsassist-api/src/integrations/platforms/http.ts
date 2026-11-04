/** Error from an ad platform API, carrying a message safe to show in the UI. */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the grant is revoked/expired and the user must reconnect. */
    readonly authRevoked = false,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export async function requestJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  describeError: (status: number, body: any, text: string) => PlatformError,
): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new PlatformError(`Network error: ${(e as Error).message}`, 0);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON (HTML error pages)
  }
  if (!res.ok) throw describeError(res.status, body, text);
  return body as T;
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
};
