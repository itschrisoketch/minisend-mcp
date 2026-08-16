/**
 * On-ramp: collect KES from a customer's phone, receive USDC.
 *
 * The one tool here with a real-world side effect the caller cannot undo:
 * creating an order rings a real phone. Descriptions say so plainly, because
 * an agent that treats create as retryable will charge one customer twice.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { call } from '../client'
import { render, missingKey, idempotencyKey } from './shared'

export function registerOnrampTools(server: McpServer, key: string | undefined) {
  server.registerTool(
    'onramp_quote',
    {
      title: 'Quote an M-Pesa collection',
      description:
        'Price a KES collection without creating anything and without ringing anyone. Give either amount_usdc (the net USDC you want to receive, and the customer is charged the grossed-up KES) or amount_kes (the exact KES the customer pays, with the fee carved out of it) — one or the other, not both. A quote is not a lock: the order is priced fresh at creation.',
      inputSchema: z.object({
        amount_usdc: z
          .number()
          .positive()
          .optional()
          .describe('Net USDC you want to receive. The customer pays more than this.'),
        amount_kes: z
          .number()
          .positive()
          .optional()
          .describe('Exact KES charged to the customer. You receive less than this in USDC.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ amount_usdc, amount_kes }) => {
      if (!key) return missingKey('merchant')
      if ((amount_usdc === undefined) === (amount_kes === undefined)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Give exactly one of amount_usdc or amount_kes. Passing both is ambiguous; passing neither has nothing to price.',
            },
          ],
          isError: true,
        }
      }
      return render(
        await call({
          path: '/api/onramp/quote',
          method: 'POST',
          key,
          body: { currency: 'KES', amount_usdc, amount_kes },
        })
      )
    }
  )

  server.registerTool(
    'onramp_create_order',
    {
      title: 'Collect KES from a phone (fires a real payment prompt)',
      description:
        "Create a collection order. This IMMEDIATELY sends an M-Pesa or Airtel Money payment prompt to the customer's real phone, asking them to approve a charge. Only call it when a person is expecting that prompt right now. It is one-shot: if the customer cancels or the prompt expires, the order fails — create a NEW order to retry rather than calling this again on the same one, which is what stops a customer being charged twice. USDC is released to the `address` you give, which must be a Base address you control. Kenya only.",
      inputSchema: z.object({
        phone: z
          .string()
          .describe(
            "Customer's Kenyan mobile number. Most formats accepted and normalised to 0XXXXXXXXX."
          ),
        address: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x EVM address')
          .describe('Your own Base address where the USDC is released.'),
        amount_usdc: z.number().positive().optional().describe('Net USDC to receive.'),
        amount_kes: z.number().positive().optional().describe('Exact KES to charge.'),
        network: z
          .enum(['Safaricom', 'Airtel'])
          .optional()
          .describe('Auto-detected from the number; override only if detection is wrong.'),
        reference: z.string().optional().describe('Your own reference, echoed on webhooks.'),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            'Strongly recommended. A replay returns the original order WITHOUT firing a second prompt at the customer. Generated automatically if omitted.'
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ phone, address, amount_usdc, amount_kes, network, reference, idempotency_key }) => {
      if (!key) return missingKey('merchant')
      if ((amount_usdc === undefined) === (amount_kes === undefined)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Give exactly one of amount_usdc or amount_kes.',
            },
          ],
          isError: true,
        }
      }
      const result = await call({
        path: '/api/onramp/orders',
        method: 'POST',
        key,
        idempotencyKey: idempotencyKey(idempotency_key),
        body: { currency: 'KES', phone, address, amount_usdc, amount_kes, network, reference },
      })
      return render(
        result,
        result.ok
          ? "The payment prompt has been sent to the customer's phone. Do not call this again for the same payment — poll onramp_get_order or wait for the webhook."
          : undefined
      )
    }
  )

  server.registerTool(
    'onramp_get_order',
    {
      title: 'Get an on-ramp order',
      description:
        'Current status of one collection order. A customer who ignores the prompt leaves the order pending until it expires — that is normal, not an error.',
      inputSchema: z.object({ order_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ order_id }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({ path: `/api/onramp/orders/${encodeURIComponent(order_id)}`, key })
      )
    }
  )

  server.registerTool(
    'onramp_list_orders',
    {
      title: 'List on-ramp orders',
      description: 'Paginated collection orders for this account, newest first.',
      inputSchema: z.object({
        status: z.enum(['pending', 'processing', 'completed', 'failed', 'expired']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, limit, offset }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({ path: '/api/onramp/orders', key, query: { status, limit, offset } })
      )
    }
  )
}
