/**
 * The one place that talks to Minisend over HTTP.
 *
 * Every tool goes through `call()`, so error shape, redaction, timeouts and
 * idempotency are decided once rather than twenty-three times.
 */
import { describe } from './credentials'

export const MERCHANT_API_BASE =
  process.env.MINISEND_API_BASE?.replace(/\/$/, '') || 'https://merchant.minisend.xyz'

/** Upstream can take a while: order creation calls a provider synchronously. */
const REQUEST_TIMEOUT_MS = 30_000

export interface ApiError {
  status: number
  message: string
  /** Whether retrying the identical call could plausibly succeed. */
  retryable: boolean
  /** What the agent should actually do about it, in plain words. */
  fix: string
}

export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError }

interface CallOptions {
  path: string
  method?: 'GET' | 'POST' | 'PATCH'
  key: string
  body?: unknown
  query?: Record<string, string | number | undefined>
  /**
   * Sent as `Idempotency-Key`. Supply for every create call: an agent that
   * retries after a timeout must not create a second order, and on the on-ramp
   * a second order means a second STK push at a real customer's phone.
   */
  idempotencyKey?: string
}

/**
 * Maps an upstream status to advice. The messages are written for an agent
 * deciding what to do next, not for a human reading a stack trace — "contact
 * info@minisend.xyz" is a real instruction here, because the account gates
 * genuinely cannot be opened any other way.
 */
function explain(status: number, message: string): ApiError {
  const base = { status, message }

  if (status === 401) {
    return {
      ...base,
      retryable: false,
      fix: 'The API key was rejected. Check it is a live key, copied whole, and not revoked in the Minisend dashboard. Retrying will not help.',
    }
  }
  if (status === 403) {
    return {
      ...base,
      retryable: false,
      fix: "This account does not have that product switched on, or the key lacks that scope — the API deliberately returns the same 403 for both and you cannot tell which from the response. Either way the fix is the same: email info@minisend.xyz to request access. Do not retry.",
    }
  }
  if (status === 404) {
    return {
      ...base,
      retryable: false,
      fix: 'Not found, or it belongs to another account — the API returns 404 for both so accounts cannot enumerate each other. Check the id came from this same key.',
    }
  }
  if (status === 422) {
    return {
      ...base,
      retryable: false,
      fix: 'The recipient was rejected by the payout provider. Confirm the account number, phone, till or paybill with the payer before trying again. Do not retry unchanged.',
    }
  }
  if (status === 429) {
    return {
      ...base,
      retryable: true,
      fix: 'Rate limited. Wait 60 seconds before retrying. If this is steady legitimate traffic rather than a burst, email info@minisend.xyz for a higher limit.',
    }
  }
  if (status === 503) {
    return {
      ...base,
      retryable: true,
      fix: 'This product is currently unavailable on the Minisend side. Retry later; nothing about the request needs changing.',
    }
  }
  if (status >= 500) {
    return {
      ...base,
      retryable: true,
      fix: 'Upstream error. Retry once. If the call was a create, reuse the SAME idempotency key so the retry cannot create a second order.',
    }
  }
  return {
    ...base,
    retryable: false,
    fix: 'The request was rejected as invalid. Fix the fields named in the message and try again — do not retry unchanged.',
  }
}

export async function call<T = unknown>(options: CallOptions): Promise<ApiResult<T>> {
  const { path, method = 'GET', key, body, query, idempotencyKey } = options

  const url = new URL(path, MERCHANT_API_BASE)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return {
      ok: false,
      error: {
        status: 0,
        message: timedOut
          ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000}s calling ${url.host}`
          : `Could not reach ${url.host}`,
        retryable: true,
        // The distinction that matters: a timeout on a create means the order
        // may already exist upstream. Blind retries are how one customer gets
        // two STK prompts.
        fix: timedOut
          ? 'The request may still have succeeded upstream. If this was a create, retry with the SAME idempotency key, or list orders to check before creating another.'
          : 'Network problem reaching Minisend. Retry in a few seconds.',
      },
    }
  }

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { error: text.slice(0, 500) }
  }

  if (!response.ok) {
    const message =
      (parsed as { error?: string })?.error ||
      `${response.status} ${response.statusText}`
    return { ok: false, error: explain(response.status, message) }
  }

  return { ok: true, data: parsed as T }
}

/**
 * A note on the calling key, safe to show. Used when a tool has to explain why
 * it cannot run — telling someone "no key" when they pasted a wallet key into
 * the wrong header is a frustrating dead end.
 */
export function keyNote(key: string | undefined): string {
  return `key: ${describe(key)}`
}
