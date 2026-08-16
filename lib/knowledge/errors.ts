/**
 * Error lookup: status plus message in, cause and fix out.
 *
 * Matching is on message substrings rather than codes because the API returns
 * human-readable `error` strings, not codes. Entries are ordered most specific
 * first — the first match wins.
 */

export interface ErrorEntry {
  status: number
  /** Substring that identifies this specific error within the status. */
  match?: string
  cause: string
  fix: string
  retryable: boolean
}

export const ERRORS: ErrorEntry[] = [
  {
    status: 401,
    match: 'Missing or invalid Authorization',
    cause: 'No bearer token, or a header that is not in the Bearer <key> shape.',
    fix: 'Send Authorization: Bearer ms_live_... — the Wallet API uses wsk_live_ instead, and the two are not interchangeable.',
    retryable: false,
  },
  {
    status: 401,
    match: 'Invalid API key',
    cause: 'The key does not match any active key: mistyped, truncated, or revoked.',
    fix: 'Re-copy the key from the dashboard. If it was revoked, create a new one. Retrying changes nothing.',
    retryable: false,
  },
  {
    status: 403,
    match: "doesn't have",
    cause:
      'The dual gate. Either the key lacks the scope or the account lacks the capability — the API returns the identical message for both, deliberately, so you cannot tell which from the response.',
    fix: 'Email info@minisend.xyz to request access to that product. There is no self-service path and no retry that helps.',
    retryable: false,
  },
  {
    status: 403,
    match: 'not authorized',
    cause: 'The key exists but lacks the scope for this endpoint.',
    fix: 'Email info@minisend.xyz to have the scope added, or use a key that already has it.',
    retryable: false,
  },
  {
    status: 404,
    cause:
      'No such record, OR it belongs to a different account. Both return 404 so accounts cannot enumerate each other.',
    fix: 'Confirm the id came from a response on this same key.',
    retryable: false,
  },
  {
    status: 422,
    match: 'Recipient validation failed',
    cause:
      'The payout provider rejected the recipient. No funds moved and nothing was created.',
    fix: 'Confirm the account number, phone, till or paybill with the payer. For banks the lookup is authoritative; for mobile it is best-effort, so a valid number can still fail here.',
    retryable: false,
  },
  {
    status: 429,
    match: 'failed authentication',
    cause: 'Too many failed auth attempts from your IP.',
    fix: 'Fix the key first — retrying with the same bad key extends the block. Wait 60 seconds after correcting it.',
    retryable: true,
  },
  {
    status: 429,
    cause:
      'Rate limited. The general limit is 60 requests/minute for your account; creation endpoints are stricter (checkout 30/min, off-ramp 20/min, on-ramp 10/min because each fires a real payment prompt).',
    fix: 'Back off for 60 seconds. If this is steady legitimate traffic rather than a burst, email info@minisend.xyz for a higher limit.',
    retryable: true,
  },
  {
    status: 400,
    match: 'refund_address',
    cause: 'refund_address was missing or not a valid 0x address. It is mandatory on every off-ramp order.',
    fix: 'Supply a 0x EVM address you control. Failed payouts return there.',
    retryable: false,
  },
  {
    status: 400,
    match: 'mobile_network',
    cause: 'The network name did not match the exact enum for that currency. Values are case-sensitive.',
    fix: 'Use Safaricom or Airtel (KES); MTN, Vodafone or AirtelTigo (GHS); MTN or Airtel (UGX). Call minisend_recipient_rules for the exact list.',
    retryable: false,
  },
  {
    status: 400,
    match: 'phone',
    cause: 'The number is not a valid mobile number for that currency.',
    fix: 'Use the local 0XXXXXXXXX form or the full international form. Call minisend_recipient_rules for accepted shapes.',
    retryable: false,
  },
  {
    status: 400,
    match: 'method',
    cause: 'That payout method is not available for that currency.',
    fix: 'KES supports MOBILE, BUY_GOODS, PAYBILL and BANK_TRANSFER. GHS and UGX support MOBILE only. NGN is bank transfer only and takes an institution code.',
    retryable: false,
  },
  {
    status: 400,
    cause: 'The request body failed validation.',
    fix: 'The message names the field. Fix it and resend — do not retry unchanged.',
    retryable: false,
  },
  {
    status: 502,
    cause: 'A downstream provider failed while pricing or provisioning.',
    fix: 'Retry. If it was an order create, retry with a NEW idempotency key — the message will say so when that applies.',
    retryable: true,
  },
  {
    status: 503,
    cause: 'The product is switched off on the Minisend side, account-independent.',
    fix: 'Retry later. Nothing about the request needs changing.',
    retryable: true,
  },
]

export function lookupError(status: number, message = ''): ErrorEntry | undefined {
  const m = message.toLowerCase()
  const candidates = ERRORS.filter((e) => e.status === status)
  return (
    candidates.find((e) => e.match && m.includes(e.match.toLowerCase())) ||
    candidates.find((e) => !e.match)
  )
}
