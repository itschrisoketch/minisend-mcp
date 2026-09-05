/**
 * Checkout: a hosted page a customer pays with USDC or USDT, settling either
 * to the merchant's bank/mobile money account or as USDC on a chain they pick.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { call } from '../client'
import { render, missingKey } from './shared'

const SETTLEMENT_CHAINS = ['BASE', 'ETH', 'MATIC', 'ARB', 'OP', 'AVAX'] as const

export function registerCheckoutTools(server: McpServer, key: string | undefined) {
  server.registerTool(
    'checkout_create_session',
    {
      title: 'Create a checkout session',
      description:
        'Create a hosted payment page and get its URL. Send the customer to checkout_url; they can pay in USDC or USDT from any supported chain. Sessions expire 30 minutes after creation, so create one when the customer is ready to pay rather than in advance. Settlement follows the account default unless you override it per session. Set redirect_url to bring the customer back to your own site once they have paid.',
      inputSchema: z.object({
        amount: z.number().positive().describe('Amount in USDC the customer must pay.'),
        description: z
          .string()
          .optional()
          .describe('Shown to the customer on the payment page.'),
        external_id: z
          .string()
          .optional()
          .describe('Your own order id, echoed back on webhooks.'),
        customer_email: z.string().optional(),
        settlement_mode: z
          .enum(['fiat', 'usdc'])
          .optional()
          .describe(
            "Override the account default. 'fiat' converts to local currency and pays out to the configured account; 'usdc' keeps it in USDC."
          ),
        settlement_chain: z
          .enum(SETTLEMENT_CHAINS)
          .optional()
          .describe(
            "Only meaningful with settlement_mode 'usdc'. The response echoes what was actually pinned — read it back rather than assuming your value won."
          ),
        redirect_url: z
          .string()
          .optional()
          .describe(
            'Where the customer is sent once the payment is done, so your own order confirmation closes the loop. Absolute https URL (http allowed only for localhost), max 2048 characters, no embedded credentials. We append session_id and status to it, keeping any query string you already put there. status carries completed, failed, or expired — it is a query parameter a customer can type, so confirm with the webhook before releasing anything.'
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({ path: '/api/merchant/checkout', method: 'POST', key, body: args })
      )
    }
  )

  server.registerTool(
    'checkout_get_session',
    {
      title: 'Get a checkout session',
      description:
        'Current status of a checkout session: pending, deposit_received, settling, then completed, failed, or expired. Also returns redirect_url, the fully built return URL with session_id and status already appended, or null when none was set.',
      inputSchema: z.object({ session_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ session_id }) => {
      if (!key) return missingKey('merchant')
      return render(
        await call({ path: `/api/merchant/checkout/${encodeURIComponent(session_id)}`, key })
      )
    }
  )
}
