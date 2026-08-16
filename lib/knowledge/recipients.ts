/**
 * The recipient matrix.
 *
 * This MIRRORS `CURRENCY_CONFIG` in the minisend-merchant repo
 * (lib/pretium/config.ts). It is duplicated rather than imported because the
 * two live in different repos, which means it can drift — and drift here is
 * worse than useless, since an agent will construct a payout body from it.
 * `scripts/test-knowledge-data.ts` asserts the values against the numbers
 * recorded below, so a change upstream that isn't mirrored fails the test run
 * rather than quietly misinforming every agent that asks.
 *
 * Source of truth for the underlying rules: docs.pretium.africa
 *   - payment types per country: on-off-ramps/{country}
 *   - MNO enum values: utilities/mnos (case-sensitive)
 *   - per-transaction limits: utilities/limits
 */

export const CURRENCIES = ['KES', 'NGN', 'GHS', 'UGX'] as const
export type Currency = (typeof CURRENCIES)[number]

export type PayoutMethod = 'MOBILE' | 'BUY_GOODS' | 'PAYBILL' | 'BANK_TRANSFER'

export interface CurrencyRules {
  country: string
  dialCode: string
  methods: readonly PayoutMethod[]
  networks: readonly string[]
  minLocal: number
  maxLocal: number
  /** Which provider settles it — affects the deposit flow, not the fields. */
  depositFlow: 'watched-address' | 'submit-hash'
}

export const CURRENCY_RULES: Record<Currency, CurrencyRules> = {
  KES: {
    country: 'Kenya',
    dialCode: '254',
    methods: ['MOBILE', 'BUY_GOODS', 'PAYBILL', 'BANK_TRANSFER'],
    networks: ['Safaricom', 'Airtel'],
    minLocal: 20,
    maxLocal: 250_000,
    depositFlow: 'submit-hash',
  },
  NGN: {
    country: 'Nigeria',
    dialCode: '234',
    methods: ['BANK_TRANSFER'],
    networks: [],
    minLocal: 100,
    maxLocal: 1_000_000,
    depositFlow: 'watched-address',
  },
  GHS: {
    country: 'Ghana',
    dialCode: '233',
    methods: ['MOBILE'],
    networks: ['MTN', 'Vodafone', 'AirtelTigo'],
    minLocal: 5,
    maxLocal: 5_000,
    depositFlow: 'submit-hash',
  },
  UGX: {
    country: 'Uganda',
    dialCode: '256',
    methods: ['MOBILE'],
    networks: ['MTN', 'Airtel'],
    minLocal: 500,
    maxLocal: 5_000_000,
    depositFlow: 'submit-hash',
  },
}

/** Aliases accepted for network names, so an agent's guess still resolves. */
export const NETWORK_ALIASES: Record<string, string> = {
  mpesa: 'Safaricom',
  'm-pesa': 'Safaricom',
  telecel: 'Vodafone',
}

export function methodsFor(currency: Currency): readonly PayoutMethod[] {
  return CURRENCY_RULES[currency].methods
}

/** Required recipient fields for a currency + method pair. */
export function requiredFields(currency: Currency, method: PayoutMethod): string[] {
  if (currency === 'NGN') return ['account_name', 'institution', 'account_number']
  switch (method) {
    case 'MOBILE':
      return ['account_name', 'phone', 'mobile_network']
    case 'BUY_GOODS':
      return ['account_name', 'till']
    case 'PAYBILL':
      return ['account_name', 'paybill', 'paybill_account']
    case 'BANK_TRANSFER':
      return ['account_name', 'account_number', 'bank_code']
  }
}

/**
 * Accepted phone shapes, and what they normalise to. Written out per currency
 * because "we accept most formats" is the kind of reassurance that produces
 * a rejected payout.
 */
export function phoneGuidance(currency: Currency): string {
  const { dialCode } = CURRENCY_RULES[currency]
  return [
    `Accepted: +${dialCode}7XXXXXXXX, ${dialCode}7XXXXXXXX, 07XXXXXXXX, or 7XXXXXXXX.`,
    `All normalise to local 0XXXXXXXXX (10 digits).`,
    `The API returns the normalised value — read it back rather than assuming your input survived unchanged.`,
  ].join(' ')
}
