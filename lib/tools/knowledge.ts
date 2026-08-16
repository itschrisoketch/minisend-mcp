/**
 * Knowledge tools. No key, no network call — everything answers from data
 * compiled into the server.
 *
 * These deliberately do NOT duplicate docs search. docs.minisend.xyz already
 * serves an MCP endpoint that returns prose. What an agent about to build a
 * request body needs is a field list it can check itself against, and the four
 * questions below are the ones where a wrong answer produces a failed payment
 * rather than a confused reader.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { ok, fail } from './shared'
import {
  CURRENCIES,
  CURRENCY_RULES,
  NETWORK_ALIASES,
  phoneGuidance,
  requiredFields,
  type Currency,
  type PayoutMethod,
} from '../knowledge/recipients'
import { ENDPOINTS, findEndpoint } from '../knowledge/endpoints'
import { ERRORS, lookupError } from '../knowledge/errors'
import {
  WEBHOOK_EVENTS,
  SIGNATURE,
  RAW_BODY_RULE,
  DEDUP_KEYS,
  DELIVERY,
  REVENUE_HAZARD,
} from '../knowledge/webhooks'

export function registerKnowledgeTools(server: McpServer) {
  server.registerTool(
    'minisend_api_schema',
    {
      title: 'Get the exact schema for a Minisend endpoint',
      description:
        'Field-level request and response schema for one endpoint, including which headers change behaviour and the specific mistake that endpoint invites. Call this before constructing a request body rather than guessing field names. Omit the argument to list every endpoint.',
      inputSchema: z.object({
        endpoint: z
          .string()
          .optional()
          .describe(
            'Endpoint id or path, e.g. "offramp_create_order" or "/api/offramp/orders". Omit to list all.'
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ endpoint }) => {
      if (!endpoint) {
        return ok(
          ENDPOINTS.map((e) => ({
            id: e.id,
            method: e.method,
            path: e.path,
            product: e.product,
            summary: e.summary,
          })),
          'All documented endpoints. Call again with an id for full field detail.'
        )
      }
      const found = findEndpoint(endpoint)
      if (!found) {
        return fail(
          `No endpoint matches "${endpoint}". Known ids: ${ENDPOINTS.map((e) => e.id).join(', ')}.`
        )
      }
      return ok(found)
    }
  )

  server.registerTool(
    'minisend_recipient_rules',
    {
      title: 'Recipient rules for a currency and payout method',
      description:
        'Exactly which recipient fields are required for a currency and payout method, the accepted phone formats and what they normalise to, the case-sensitive mobile network names, and the per-transaction limits in local currency. Call this before building an off-ramp recipient object — the required fields differ by both currency AND method, and the network names are exact strings.',
      inputSchema: z.object({
        currency: z.enum(CURRENCIES).describe('KES, NGN, GHS or UGX.'),
        method: z
          .enum(['MOBILE', 'BUY_GOODS', 'PAYBILL', 'BANK_TRANSFER'])
          .optional()
          .describe('Omit to see every method available for the currency.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ currency, method }) => {
      const rules = CURRENCY_RULES[currency as Currency]

      if (method && !rules.methods.includes(method as PayoutMethod)) {
        return fail(
          `${method} is not available for ${currency}. ${currency} supports: ${rules.methods.join(', ')}.`
        )
      }

      const methods = method ? [method as PayoutMethod] : [...rules.methods]

      return ok({
        currency,
        country: rules.country,
        available_methods: rules.methods,
        limits: {
          min: `${rules.minLocal} ${currency}`,
          max: `${rules.maxLocal.toLocaleString()} ${currency}`,
          note: 'Per transaction, in local currency. A USDC amount that converts outside this range is rejected at quote time.',
        },
        mobile_networks:
          rules.networks.length > 0
            ? {
                values: rules.networks,
                note: 'Case-sensitive exact strings. "Safaricom", not "safaricom" or "SAFARICOM".',
                aliases: NETWORK_ALIASES,
              }
            : 'Not applicable — this currency has no mobile money payout.',
        phone_format: rules.networks.length > 0 ? phoneGuidance(currency as Currency) : undefined,
        required_fields: Object.fromEntries(
          methods.map((m) => [m, requiredFields(currency as Currency, m)])
        ),
        deposit_flow:
          rules.depositFlow === 'submit-hash'
            ? 'After creating an order you send USDC to deposit_address, then report the transaction hash with offramp_submit_deposit.'
            : 'After creating an order you send USDC to deposit_address and nothing else — the address is watched automatically. Do NOT submit a hash.',
      })
    }
  )

  server.registerTool(
    'minisend_explain_error',
    {
      title: 'Explain a Minisend API error',
      description:
        'Turn a status code and error message into the actual cause and the specific fix, including whether retrying can possibly help. Use this when a call fails rather than guessing — several Minisend errors are deliberately ambiguous about their cause and retrying them is wasted effort.',
      inputSchema: z.object({
        status: z.number().int().describe('HTTP status code returned.'),
        message: z.string().optional().describe('The `error` string from the response body.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, message }) => {
      const entry = lookupError(status, message)
      if (!entry) {
        return ok(
          {
            status,
            message,
            known: false,
            all_documented_statuses: [...new Set(ERRORS.map((e) => e.status))].sort(),
          },
          'No specific entry for that status.'
        )
      }
      const { status: _matchedStatus, match: _match, ...advice } = entry
      return ok({ status, message, known: true, ...advice })
    }
  )

  server.registerTool(
    'minisend_webhook_spec',
    {
      title: 'Webhook events and signature verification',
      description:
        'Event names and meanings, the signature scheme, and the ordering and dedup rules that a naive handler gets wrong. Read this before writing a webhook handler: verification is over the RAW body and several events legitimately arrive out of order or after a terminal state.',
      inputSchema: z.object({
        topic: z
          .enum(['events', 'signature', 'delivery', 'all'])
          .optional()
          .describe('Defaults to all.'),
        product: z
          .enum(['offramp', 'onramp', 'checkout'])
          .optional()
          .describe('Narrow the event list to one product.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ topic = 'all', product }) => {
      const events = product
        ? WEBHOOK_EVENTS.filter((e) => e.product === product)
        : WEBHOOK_EVENTS

      const sections: Record<string, unknown> = {}
      if (topic === 'events' || topic === 'all') {
        sections.events = events
        sections.deduplication = product
          ? { [product]: DEDUP_KEYS[product] }
          : DEDUP_KEYS
        sections.revenue_hazard = REVENUE_HAZARD
      }
      if (topic === 'signature' || topic === 'all') {
        sections.signature = SIGNATURE
        sections.raw_body_rule = RAW_BODY_RULE
      }
      if (topic === 'delivery' || topic === 'all') {
        sections.delivery = DELIVERY
      }
      return ok(sections)
    }
  )
}
