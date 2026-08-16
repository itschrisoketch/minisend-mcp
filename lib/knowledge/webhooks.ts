/**
 * Webhook facts an agent needs before writing a handler.
 *
 * Weighted towards the things that break integrations rather than the things
 * that are easy to describe: raw-body verification, the events that legitimately
 * arrive out of order or after a terminal state, and the dedup keys that follow
 * from that.
 */

export interface WebhookEvent {
  name: string
  product: 'offramp' | 'onramp' | 'checkout'
  meaning: string
  /** Anything that will surprise someone who assumes a simple state machine. */
  caveat?: string
}

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  {
    name: 'offramp.completed',
    product: 'offramp',
    meaning: 'The order reached completed — the recipient was paid.',
  },
  { name: 'offramp.failed', product: 'offramp', meaning: 'The order reached failed.' },
  {
    name: 'offramp.expired',
    product: 'offramp',
    meaning: 'The deposit window closed with no accepted deposit.',
    caveat:
      'Delivered whether the periodic sweep or a read of the status endpoint expires the order.',
  },
  {
    name: 'onramp.completed',
    product: 'onramp',
    meaning: 'The local currency was collected and the order is completed.',
    caveat:
      'Can legitimately arrive AFTER onramp.expired or onramp.failed for the same order. A late confirmation that the customer really was charged moves the order to completed. Only completed is immutable.',
  },
  {
    name: 'onramp.released',
    product: 'onramp',
    meaning: 'The on-chain USDC transfer to your release address was recorded.',
    caveat:
      'Not a status change — it carries release_tx_hash and leaves the status alone. No ordering with onramp.completed is guaranteed; it can arrive first.',
  },
  {
    name: 'onramp.failed',
    product: 'onramp',
    meaning: 'The payment prompt did not produce a payment.',
  },
  {
    name: 'onramp.expired',
    product: 'onramp',
    meaning: 'The order window closed unpaid.',
  },
  {
    name: 'checkout.completed',
    product: 'checkout',
    meaning: 'The session reached completed.',
    caveat:
      'Can arrive for a session you already saw expire: an M-Pesa-paid session confirming after the window goes expired → completed. For a stablecoin-paid session, expired really is terminal.',
  },
  {
    name: 'checkout.failed',
    product: 'checkout',
    meaning: 'The session reached failed, by any route.',
  },
  {
    name: 'checkout.expired',
    product: 'checkout',
    meaning: 'The window passed with no deposit.',
  },
]

export const SIGNATURE = {
  header: 'X-Minisend-Signature',
  algorithm: 'HMAC-SHA256',
  key: 'your webhook secret, as raw bytes',
  message: 'the exact bytes of the request body',
  encoding: 'lower-case hex, 64 characters',
  format:
    'The bare digest. No t=/v1= scheme, no sha256= prefix, no version, no timestamp anywhere in the request.',
  replay:
    'Because there is no timestamp there is no replay window to enforce. Your defence against a replay is idempotency, not signature age.',
}

export const RAW_BODY_RULE = `Compute the HMAC over the exact bytes you received, BEFORE any JSON parsing. Parsing and re-serializing produces different bytes — key order, whitespace and number formatting all shift — and the signature will never match. This is the single most common way a Minisend webhook integration fails.

The nasty version is the near miss: a framework parses the body for you, hands your handler an object, and you JSON.stringify it back. That looks correct and never verifies.

Per framework:
  - Next.js App Router — await request.text(), not await request.json(). Parse afterwards.
  - Express — mount express.raw({ type: 'application/json' }) on the webhook route, not the global express.json().
  - Flask — request.get_data(), not request.json.
  - Go net/http — io.ReadAll(r.Body), then json.Unmarshal the same slice.

Verify first, parse second, always from the same buffer.

Fail closed on a missing secret. An unset or empty secret keys the HMAC on the empty string, so verification still "passes" for anyone who knows it is unset. Refuse to start rather than accept that.`

export const DEDUP_KEYS = {
  offramp: 'order_id + event',
  onramp:
    'order_id + event — REQUIRED. One order legitimately emits several events (onramp.released alongside onramp.completed, or onramp.expired then onramp.completed). Keying on order_id alone silently drops the second.',
  checkout:
    'session_id + event. A session can deliver two different event names, and session_id alone collapses them.',
}

export const DELIVERY = {
  url: 'One URL for the whole account — off-ramp, on-ramp and checkout all deliver there. Branch on the payload\'s `event` field. The Wallet API emits nothing.',
  requirements:
    'Must be https, a publicly resolvable hostname (no localhost/.local/.internal/private ranges), free of credentials, at most 2048 chars. The check runs again before every delivery: if your hostname stops resolving publicly the event is REFUSED and never retried — dropped, not queued.',
  retries: 'Up to 5 attempts with exponential backoff.',
  rotation:
    'Regenerating the secret invalidates the previous one immediately — no overlap window. Signatures are computed at send time, so a retry queued before rotation goes out signed with the NEW secret; you do not need to keep the old one to drain a backlog.',
}

/**
 * The reconciliation trap. Called out separately because it is the one that
 * costs money rather than time: it produces books that look fine and are wrong.
 */
export const REVENUE_HAZARD = `amount_usdc on a checkout.completed payload is the amount the session EXPECTED, not the amount that arrived — it is copied from the session unchanged.

Book amount_received_usdc instead, and treat amount_matched: false as needing review. Keep the number of simultaneously open sessions per account low: with two or more open, an off-amount payment is not attributed at all and parks for manual review.`
