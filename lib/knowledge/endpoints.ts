/**
 * Endpoint schemas, for the agent that is about to construct a request body and
 * wants a field list rather than a paragraph.
 *
 * Covers what the docs site conveys least reliably: which fields are genuinely
 * required, which headers change behaviour, and what the response is actually
 * good for once you have it.
 */

export interface EndpointDoc {
  id: string
  method: string
  path: string
  product: 'offramp' | 'onramp' | 'checkout' | 'wallets' | 'account'
  summary: string
  auth: string
  request: Record<string, string>
  headers?: Record<string, string>
  response: Record<string, string>
  /** The thing that trips people up on this specific endpoint. */
  gotcha?: string
}

export const ENDPOINTS: EndpointDoc[] = [
  {
    id: 'offramp_quote',
    method: 'POST',
    path: '/api/offramp/quote',
    product: 'offramp',
    summary: 'Price a payout without creating anything.',
    auth: 'ms_live_ key, offramp scope',
    request: {
      amount: 'number, required. USDC to convert.',
      currency: 'string, required. KES | NGN | GHS | UGX.',
      recipient: 'object, optional. Include it to also resolve the account name.',
    },
    response: {
      rate: 'number. Exchange rate applied.',
      amount_local: 'number. Local currency before fee.',
      fee: 'number. Platform fee.',
      recipient_amount: 'number. What the recipient actually receives.',
      recipient_name: 'string, present only if you passed a recipient and it resolved.',
      expires_at: 'ISO timestamp, about 5 minutes out.',
    },
    gotcha:
      'expires_at does NOT mean the price is held. The quote reserves nothing and the order is priced fresh at creation. Read the final numbers back from the create response.',
  },
  {
    id: 'offramp_create_order',
    method: 'POST',
    path: '/api/offramp/orders',
    product: 'offramp',
    summary: 'Create a payout order and get the deposit target.',
    auth: 'ms_live_ key, offramp scope',
    request: {
      amount: 'number, required.',
      currency: 'string, required.',
      refund_address: 'string, REQUIRED. 0x EVM address you control.',
      recipient: 'object, required. Fields depend on currency and method.',
      reference: 'string, optional. Echoed on webhooks as external_reference.',
    },
    headers: {
      'Idempotency-Key':
        'Strongly recommended. A replay returns the original order rather than creating a second.',
    },
    response: {
      id: 'string. Use for status and deposit submission.',
      deposit_address: 'string. Where to send the USDC, on Base.',
      expires_at: 'ISO timestamp. Deposit after this and the order expires.',
      instructions: 'string. Read this — it states which deposit path this order took.',
      recipient_amount: 'number.',
    },
    gotcha:
      'Creating an order pays nobody. It is non-custodial: you send the USDC yourself, then for KES/GHS/UGX you must also report the tx hash. NGN orders are watched automatically and must not be submitted.',
  },
  {
    id: 'offramp_submit_deposit',
    method: 'POST',
    path: '/api/offramp/orders/{orderId}/deposit',
    product: 'offramp',
    summary: 'Report the USDC transfer and release the payout.',
    auth: 'ms_live_ key, offramp scope',
    request: { transaction_hash: 'string, required. 0x + 64 hex, confirmed on Base.' },
    response: { status: 'string. The order moves toward processing.' },
    gotcha:
      'KES/GHS/UGX only. Each hash can be used by exactly one order. A rejected submission releases the claim so you can retry with a corrected hash.',
  },
  {
    id: 'onramp_create_order',
    method: 'POST',
    path: '/api/onramp/orders',
    product: 'onramp',
    summary: 'Collect KES from a phone and release USDC.',
    auth: 'ms_live_ key, onramp scope',
    request: {
      currency: "string, required. 'KES' — the only corridor.",
      phone: 'string, required. Customer mobile, normalised to 0XXXXXXXXX.',
      address: 'string, required. YOUR Base address, where USDC is released.',
      amount_usdc: 'number. Net USDC to receive. Give this OR amount_kes, not both.',
      amount_kes: 'number. Exact KES charged. Give this OR amount_usdc, not both.',
      network: "string, optional. 'Safaricom' | 'Airtel'. Auto-detected.",
      reference: 'string, optional.',
    },
    headers: {
      'Idempotency-Key':
        'A replay returns the original order WITHOUT firing a second prompt at the customer.',
    },
    response: { id: 'string.', status: 'string.' },
    gotcha:
      'The payment prompt fires at creation, at a real phone. One-shot: if the customer cancels, create a NEW order rather than retrying this one.',
  },
  {
    id: 'checkout_create_session',
    method: 'POST',
    path: '/api/merchant/checkout',
    product: 'checkout',
    summary: 'Create a hosted payment page.',
    auth: 'ms_live_ key, checkout scope',
    request: {
      amount: 'number, required. USDC.',
      description: 'string, optional. Shown to the customer.',
      external_id: 'string, optional. Your order id, echoed on webhooks.',
      customer_email: 'string, optional.',
      settlement_mode: "string, optional. 'fiat' | 'usdc'. Defaults to the account setting.",
      settlement_chain: "string, optional. BASE | ETH | MATIC | ARB | OP | AVAX. Only with 'usdc'.",
    },
    response: {
      session_id: 'string.',
      checkout_url: 'string. Send the customer here.',
      deposit_address: 'string.',
      settlement_chain: 'string. What was ACTUALLY pinned — read it back.',
      expires_at: 'ISO timestamp, 30 minutes out.',
    },
    gotcha:
      'Sessions expire 30 minutes after creation, so create one when the customer is ready to pay, not in advance.',
  },
  {
    id: 'wallet_create',
    method: 'POST',
    path: '/api/v1/wallets',
    product: 'wallets',
    summary: 'Create a wallet for one of your end users.',
    auth: 'wsk_live_ key — a DIFFERENT key namespace from everything above',
    request: {
      walletRef: 'string, required. Your own user id. 1-128 chars, letters/numbers/_/:/./- only.',
      chain: 'string, optional. BASE | MATIC | ARB | OP | ETH | AVAX. Defaults to BASE.',
      metadata: 'object, optional.',
    },
    response: { id: 'string.', address: 'string.', chain: 'string.' },
    gotcha:
      'Idempotent on walletRef — calling twice never mints a second address. The chain must already be activated on your account or this fails.',
  },
  {
    id: 'account_me',
    method: 'GET',
    path: '/api/merchant/me',
    product: 'account',
    summary: 'Introspect the calling key: scopes and which products it can use.',
    auth: 'ms_live_ key, any scope',
    request: {},
    response: {
      scopes: 'string[]. Scopes on this key.',
      products: 'object. Effective per-product booleans: can this key do this today.',
    },
    gotcha:
      'products reports EFFECTIVE capability (key scope AND account flag). It deliberately does not tell you which of the two gates is closed — the fix is the same either way.',
  },
]

export function findEndpoint(query: string): EndpointDoc | undefined {
  const q = query.trim().toLowerCase()
  return (
    ENDPOINTS.find((e) => e.id === q) ||
    ENDPOINTS.find((e) => e.path.toLowerCase() === q) ||
    ENDPOINTS.find((e) => e.id.includes(q) || e.path.toLowerCase().includes(q))
  )
}
