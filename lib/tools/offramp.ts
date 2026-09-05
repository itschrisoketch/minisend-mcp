/**
 * Off-ramp: pay out KES, NGN, GHS or UGX from a USDC balance.
 *
 * The flow is non-custodial and that shapes every description here. Minisend
 * never holds the funds: creating an order returns an address, the integrator
 * sends USDC from their own wallet, and for Pretium-routed currencies they then
 * report the transaction hash. An agent that stops after `create_order` has not
 * paid anyone.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { call } from '../client'
import { render, missingKey, idempotencyKey } from './shared'
import { CURRENCIES, methodsFor } from '../knowledge/recipients'

const currency = z
  .enum(CURRENCIES)
  .describe('Payout currency. KES, GHS and UGX settle via mobile money and bank; NGN is bank transfer only.')

const recipientSchema = z
  .object({
    account_name: z
      .string()
      .describe("Recipient's name. Required for every currency and method."),
    method: z
      .enum(['MOBILE', 'BUY_GOODS', 'PAYBILL', 'BANK_TRANSFER'])
      .optional()
      .describe(
        'Payout method. Required for KES/GHS/UGX; ignored for NGN, which is always bank transfer. KES supports all four; GHS and UGX support MOBILE only. Call minisend_recipient_rules first if unsure.'
      ),
    phone: z
      .string()
      .optional()
      .describe(
        'For MOBILE. Several formats are accepted and normalised to local 0XXXXXXXXX — read the normalised value back from the response rather than assuming yours survived.'
      ),
    mobile_network: z
      .string()
      .optional()
      .describe(
        'For MOBILE. Case-sensitive exact value: Safaricom or Airtel (KES); MTN, Vodafone or AirtelTigo (GHS); MTN or Airtel (UGX). "M-Pesa" maps to Safaricom, "Telecel" to Vodafone.'
      ),
    till: z.string().optional().describe('For BUY_GOODS (KES only). 5-7 digits.'),
    paybill: z.string().optional().describe('For PAYBILL (KES only). 5-7 digits.'),
    paybill_account: z
      .string()
      .optional()
      .describe('For PAYBILL. The account/reference number the paybill expects.'),
    account_number: z
      .string()
      .optional()
      .describe('For BANK_TRANSFER, and required for all NGN payouts.'),
    bank_code: z.string().optional().describe('For BANK_TRANSFER on KES.'),
    institution: z
      .string()
      .optional()
      .describe('Bank institution code. Required for NGN.'),
    bank_name: z.string().optional().describe('Optional, for readability on receipts.'),
  })
  .describe('Recipient. Required fields depend on currency and method.')

export function registerOfframpTools(server: McpServer, key: string | undefined) {
  server.registerTool(
    'offramp_quote',
    {
      title: 'Quote an off-ramp payout',
      description:
        'Price a payout of USDC into KES, NGN, GHS or UGX without creating anything or moving money. Optionally pass a recipient to also resolve their registered account name. IMPORTANT: a quote is not a lock — it reserves nothing, and the order is priced fresh when you create it. Show this to a user for confirmation, but always read the final numbers back from the create response.',
      inputSchema: z.object({
        amount: z.number().positive().describe('USDC to convert.'),
        currency,
        recipient: recipientSchema.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ amount, currency: c, recipient }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({
          path: '/api/offramp/quote',
          method: 'POST',
          key,
          body: { amount, currency: c, ...(recipient ? { recipient } : {}) },
        })
      )
    }
  )

  server.registerTool(
    'offramp_validate_account',
    {
      title: 'Validate a payout recipient',
      description:
        "Check a recipient before creating an order and resolve their registered account name. Bank lookups are authoritative. Mobile, till and paybill lookups are best-effort — recipient_name can come back null for a perfectly valid number, so treat null as 'unknown', not 'invalid'.",
      inputSchema: z.object({ currency, recipient: recipientSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ currency: c, recipient }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({
          path: '/api/offramp/validate-account',
          method: 'POST',
          key,
          body: { currency: c, recipient },
        })
      )
    }
  )

  server.registerTool(
    'offramp_create_order',
    {
      title: 'Create an off-ramp payout order',
      description:
        'Create a payout order and get the address to send USDC to. This does NOT pay anyone by itself — the flow is non-custodial. After this returns you must send the USDC from your own wallet to deposit_address, and then, if the response tells you to, report the transaction hash with offramp_submit_deposit. Read the returned `instructions` field: it states exactly which of the two paths this order took. refund_address is mandatory and must be a wallet you control — a failed payout returns the funds there.',
      inputSchema: z.object({
        amount: z.number().positive().describe('USDC to convert.'),
        currency,
        refund_address: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x EVM address')
          .describe(
            'Mandatory. Where funds return if the payout fails. Must be an address you control.'
          ),
        recipient: recipientSchema,
        reference: z
          .string()
          .optional()
          .describe('Your own reference, echoed back on webhooks.'),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            'Pass the same value to retry safely after a timeout — a replay returns the original order instead of creating a second one. Generated automatically if omitted.'
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ amount, currency: c, refund_address, recipient, reference, idempotency_key }) => {
      if (!key) return missingKey('merchant')
      const result = await call({
        path: '/api/offramp/orders',
        method: 'POST',
        key,
        idempotencyKey: idempotencyKey(idempotency_key),
        body: { amount, currency: c, refund_address, recipient, reference },
      })
      return render(
        result,
        result.ok
          ? 'Order created. No money has moved yet — send the USDC to deposit_address, then follow the `instructions` field below.'
          : undefined
      )
    }
  )

  server.registerTool(
    'offramp_submit_deposit',
    {
      title: 'Report the USDC transfer for an order',
      description:
        'Report the on-chain transaction in which you sent this order\'s USDC, which releases the local-currency payout. Only for orders whose instructions asked for it (the Pretium-routed currencies: KES, GHS, UGX). NGN orders are watched automatically and must not be submitted here. Submit only a hash that is already confirmed on Base — a wrong or unconfirmed hash is rejected, and each hash can only be used once, by one order.',
      inputSchema: z.object({
        order_id: z.string().describe('The id returned by offramp_create_order.'),
        transaction_hash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 0x transaction hash')
          .describe('The Base transaction that sent the USDC to deposit_address.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ order_id, transaction_hash }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({
          path: `/api/offramp/orders/${encodeURIComponent(order_id)}/deposit`,
          method: 'POST',
          key,
          body: { transaction_hash },
        })
      )
    }
  )

  server.registerTool(
    'offramp_get_order',
    {
      title: 'Get an off-ramp order',
      description:
        'Current status of one payout order. Statuses run pending → processing → completed, or failed / expired. Prefer webhooks over polling for anything long-running.',
      inputSchema: z.object({ order_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ order_id }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({ path: `/api/offramp/orders/${encodeURIComponent(order_id)}`, key })
      )
    }
  )

  server.registerTool(
    'offramp_list_orders',
    {
      title: 'List off-ramp orders',
      description: 'Paginated payout orders for this account, newest first.',
      inputSchema: z.object({
        status: z
          .enum(['pending', 'processing', 'completed', 'failed', 'expired'])
          .optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Default 20, max 100.'),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, limit, offset }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({ path: '/api/offramp/orders', key, query: { status, limit, offset } })
      )
    }
  )

  server.registerTool(
    'offramp_list_institutions',
    {
      title: 'List the banks an NGN recipient can hold',
      description:
        'The banks and mobile money providers an NGN recipient can hold, each with the code that goes in recipient.institution. Those codes are opaque and cannot be guessed from a bank name, and a wrong one fails the order — look the code up here rather than hardcoding it. NGN only: KES, GHS and UGX recipients are identified by method plus a phone number, so no list exists for them. The list is near-static, so cache it rather than calling before every order.',
      inputSchema: z.object({
        currency: z
          .enum(['NGN'])
          .optional()
          .describe('Defaults to NGN, currently the only currency with institution codes.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ currency }) => {
      if (!key) return missingKey('merchant')
      return render(await call({ path: '/api/offramp/institutions', key, query: { currency } }))
    }
  )
}

/** Re-exported so the knowledge tools and these schemas cannot disagree. */
export { methodsFor }
