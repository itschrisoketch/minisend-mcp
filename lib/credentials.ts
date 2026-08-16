/**
 * Credentials arrive per request and leave with it.
 *
 * Nothing here is stored, cached, or logged. The server holds no Minisend
 * credentials of its own — it forwards the caller's. That is the whole security
 * model, and it only holds if key material never escapes this module's return
 * value, so:
 *
 *   - no key is ever interpolated into an error message or a log line
 *   - no key is used as a cache key, map key, or metric label
 *   - `describe()` exists so diagnostics can say WHICH key shape was seen
 *     without ever revealing the key itself
 */

/** Merchant API key: off-ramp, on-ramp, checkout. */
const MERCHANT_KEY_PREFIX = 'ms_live_'
/** Wallet API key — a different product with a different key namespace. */
const WALLET_KEY_PREFIX = 'wsk_live_'

export const WALLET_KEY_HEADER = 'x-minisend-wallet-key'

export interface Credentials {
  /** Raw `ms_live_...`, forwarded verbatim. Absent when the caller sent none. */
  merchantKey?: string
  /** Raw `wsk_live_...`, forwarded verbatim. Absent unless the header is set. */
  walletKey?: string
  /**
   * A key was sent in the Authorization header but doesn't look like either
   * namespace. Worth distinguishing from "no key at all": it almost always
   * means a typo or a pasted placeholder, and the tools can say so instead of
   * letting the caller wonder why only knowledge tools appeared.
   */
  malformedMerchantKey: boolean
  /** Same, for the wallet header. */
  malformedWalletKey: boolean
}

function bearer(header: string | null): string | undefined {
  if (!header) return undefined
  const trimmed = header.trim()
  // Case-insensitive: clients differ, and "bearer ms_live_x" should not read as
  // a malformed key.
  if (!/^bearer\s+/i.test(trimmed)) return trimmed || undefined
  const value = trimmed.replace(/^bearer\s+/i, '').trim()
  return value || undefined
}

export function extractCredentials(request: Request): Credentials {
  const authValue = bearer(request.headers.get('authorization'))
  const walletValue = bearer(request.headers.get(WALLET_KEY_HEADER))

  // A wallet key pasted into Authorization is a common enough mistake that
  // accepting it costs nothing and saves a confusing empty tool list.
  const merchantKey =
    authValue?.startsWith(MERCHANT_KEY_PREFIX) ? authValue : undefined
  const walletFromAuth =
    authValue?.startsWith(WALLET_KEY_PREFIX) ? authValue : undefined

  const walletKey = walletValue?.startsWith(WALLET_KEY_PREFIX)
    ? walletValue
    : walletFromAuth

  return {
    merchantKey,
    walletKey,
    malformedMerchantKey: !!authValue && !merchantKey && !walletFromAuth,
    malformedWalletKey: !!walletValue && !walletValue.startsWith(WALLET_KEY_PREFIX),
  }
}

/**
 * A safe label for a key, for diagnostics only. Never returns enough to
 * authenticate with: the shared prefix plus four characters, which is enough
 * for a human to tell two of their own keys apart and useless to anyone else.
 */
export function describe(key: string | undefined): string {
  if (!key) return 'none'
  const prefix = key.startsWith(MERCHANT_KEY_PREFIX)
    ? MERCHANT_KEY_PREFIX
    : key.startsWith(WALLET_KEY_PREFIX)
      ? WALLET_KEY_PREFIX
      : ''
  if (!prefix) return 'unrecognised'
  return `${prefix}${key.slice(prefix.length, prefix.length + 4)}…`
}
