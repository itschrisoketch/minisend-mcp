/**
 * The recipient matrix is duplicated from the merchant repo, so it can drift.
 * These assertions pin the values that an agent will build a payout body from.
 * If a currency's methods, networks or limits change upstream, this fails
 * loudly instead of every agent being quietly misinformed.
 *
 * Upstream source: minisend-merchant lib/pretium/config.ts, CURRENCY_CONFIG.
 */
import assert from 'node:assert/strict'
import {
  CURRENCY_RULES,
  requiredFields,
  methodsFor,
} from '../lib/knowledge/recipients'
import { findEndpoint, ENDPOINTS } from '../lib/knowledge/endpoints'
import { lookupError } from '../lib/knowledge/errors'
import { WEBHOOK_EVENTS } from '../lib/knowledge/webhooks'

let checks = 0
function check(name: string, fn: () => void) {
  fn()
  checks++
  console.log(`  ok  ${name}`)
}

console.log('\ncurrency matrix (mirrors CURRENCY_CONFIG upstream)')

check('KES supports all four payout methods', () => {
  assert.deepEqual(
    [...CURRENCY_RULES.KES.methods],
    ['MOBILE', 'BUY_GOODS', 'PAYBILL', 'BANK_TRANSFER']
  )
})

check('GHS and UGX are mobile-only', () => {
  assert.deepEqual([...CURRENCY_RULES.GHS.methods], ['MOBILE'])
  assert.deepEqual([...CURRENCY_RULES.UGX.methods], ['MOBILE'])
})

check('NGN is bank transfer only', () => {
  assert.deepEqual([...CURRENCY_RULES.NGN.methods], ['BANK_TRANSFER'])
})

check('network enums match the documented MNO values exactly', () => {
  assert.deepEqual([...CURRENCY_RULES.KES.networks], ['Safaricom', 'Airtel'])
  assert.deepEqual([...CURRENCY_RULES.GHS.networks], ['MTN', 'Vodafone', 'AirtelTigo'])
  assert.deepEqual([...CURRENCY_RULES.UGX.networks], ['MTN', 'Airtel'])
})

check('per-transaction limits match upstream', () => {
  assert.equal(CURRENCY_RULES.KES.minLocal, 20)
  assert.equal(CURRENCY_RULES.KES.maxLocal, 250_000)
  assert.equal(CURRENCY_RULES.GHS.minLocal, 5)
  assert.equal(CURRENCY_RULES.GHS.maxLocal, 5_000)
  assert.equal(CURRENCY_RULES.NGN.minLocal, 100)
  assert.equal(CURRENCY_RULES.NGN.maxLocal, 1_000_000)
  assert.equal(CURRENCY_RULES.UGX.minLocal, 500)
  assert.equal(CURRENCY_RULES.UGX.maxLocal, 5_000_000)
})

check('dial codes match upstream', () => {
  assert.equal(CURRENCY_RULES.KES.dialCode, '254')
  assert.equal(CURRENCY_RULES.GHS.dialCode, '233')
  assert.equal(CURRENCY_RULES.NGN.dialCode, '234')
  assert.equal(CURRENCY_RULES.UGX.dialCode, '256')
})

check('NGN routes to a watched address, the rest submit a hash', () => {
  assert.equal(CURRENCY_RULES.NGN.depositFlow, 'watched-address')
  for (const c of ['KES', 'GHS', 'UGX'] as const) {
    assert.equal(CURRENCY_RULES[c].depositFlow, 'submit-hash')
  }
})

console.log('\nrequired fields per method')

check('MOBILE needs phone and network', () => {
  assert.deepEqual(requiredFields('KES', 'MOBILE'), [
    'account_name',
    'phone',
    'mobile_network',
  ])
})

check('PAYBILL needs both the paybill and its account', () => {
  assert.deepEqual(requiredFields('KES', 'PAYBILL'), [
    'account_name',
    'paybill',
    'paybill_account',
  ])
})

check('BUY_GOODS needs only the till', () => {
  assert.deepEqual(requiredFields('KES', 'BUY_GOODS'), ['account_name', 'till'])
})

check('NGN ignores method and always needs institution + account number', () => {
  for (const m of ['BANK_TRANSFER', 'MOBILE'] as const) {
    assert.deepEqual(requiredFields('NGN', m), [
      'account_name',
      'institution',
      'account_number',
    ])
  }
})

check('methodsFor agrees with the matrix', () => {
  assert.deepEqual([...methodsFor('UGX')], ['MOBILE'])
})

console.log('\nendpoint lookup')

check('finds an endpoint by id and by path', () => {
  assert.equal(findEndpoint('offramp_create_order')?.method, 'POST')
  assert.equal(findEndpoint('/api/offramp/orders')?.id, 'offramp_create_order')
})

check('unknown endpoint returns undefined rather than a wrong guess', () => {
  assert.equal(findEndpoint('does_not_exist_anywhere'), undefined)
})

check('every endpoint documents auth and a response', () => {
  for (const e of ENDPOINTS) {
    assert.ok(e.auth.length > 0, `${e.id} has no auth note`)
    assert.ok(Object.keys(e.response).length > 0, `${e.id} documents no response`)
  }
})

check('the off-ramp create endpoint names refund_address as required', () => {
  const e = findEndpoint('offramp_create_order')!
  assert.match(e.request.refund_address, /REQUIRED/)
})

console.log('\nerror lookup')

check('the ambiguous 403 resolves to the dual-gate explanation', () => {
  const e = lookupError(403, "Your account doesn't have off-ramp access yet.")
  assert.ok(e)
  assert.equal(e.retryable, false)
  assert.match(e.fix, /info@minisend\.xyz/)
})

check('429 is retryable, 401 is not', () => {
  assert.equal(lookupError(429, 'Rate limit exceeded')?.retryable, true)
  assert.equal(lookupError(401, 'Invalid API key')?.retryable, false)
})

check('a specific 400 beats the generic 400', () => {
  const specific = lookupError(400, 'refund_address is required and must be a valid 0x EVM address.')
  assert.match(specific!.cause, /refund_address/)
})

check('the failed-auth 429 is distinguished from the rate-limit 429', () => {
  const authFail = lookupError(429, 'Too many failed authentication attempts')
  assert.match(authFail!.fix, /Fix the key first/)
})

check('an undocumented status returns undefined, not a wrong answer', () => {
  assert.equal(lookupError(418, 'teapot'), undefined)
})

console.log('\nwebhook facts')

check('the events that arrive after a terminal state carry a caveat', () => {
  const late = WEBHOOK_EVENTS.find((e) => e.name === 'onramp.completed')
  assert.match(late!.caveat!, /AFTER onramp\.expired/)
  const released = WEBHOOK_EVENTS.find((e) => e.name === 'onramp.released')
  assert.match(released!.caveat!, /No ordering/)
})

check('checkout.expired is present — it is emitted, contrary to old docs', () => {
  assert.ok(WEBHOOK_EVENTS.some((e) => e.name === 'checkout.expired'))
})

console.log(`\n${checks} checks passed\n`)
