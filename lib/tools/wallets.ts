/**
 * Wallet API: provision stablecoin wallets for your own end users.
 *
 * A separate product with a separate key namespace (wsk_live_), so these tools
 * are registered only when X-Minisend-Wallet-Key is present. A developer who
 * doesn't use the Wallet API never sees six tools they can't call.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { call } from '../client'
import { render, missingKey } from './shared'

const WALLET_CHAINS = ['BASE', 'MATIC', 'ARB', 'OP', 'ETH', 'AVAX'] as const

export function registerWalletTools(server: McpServer, key: string | undefined) {
  server.registerTool(
    'wallet_create',
    {
      title: 'Create a wallet for an end user',
      description:
        "Create a wallet for one of your users, or return the existing one. Idempotent on walletRef: calling it twice with the same ref never mints a second address, so pass your own stable user id as the ref and you never need to store ours. The chain must already be activated on your account — activate it in the dashboard first, or this fails.",
      inputSchema: z.object({
        walletRef: z
          .string()
          .describe(
            'Your own identifier for this user. 1-128 chars, letters/numbers/_/:/./- only. Reuse it to fetch the same wallet later via wallet_get_by_ref.'
          ),
        chain: z.enum(WALLET_CHAINS).optional().describe('Defaults to BASE.'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary JSON object.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      if (!key) return missingKey('wallet')
      return render(await call({ path: '/api/v1/wallets', method: 'POST', key, body: args }))
    }
  )

  server.registerTool(
    'wallet_get',
    {
      title: 'Get a wallet by id',
      description: "Fetch one wallet by Minisend's wallet id.",
      inputSchema: z.object({ wallet_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ wallet_id }) => {
      if (!key) return missingKey('wallet')
      return render(await call({ path: `/api/v1/wallets/${encodeURIComponent(wallet_id)}`, key }))
    }
  )

  server.registerTool(
    'wallet_get_by_ref',
    {
      title: 'Get a wallet by your own reference',
      description:
        'Fetch a wallet using the walletRef you supplied at creation — your own user id — so you never have to store a Minisend identifier alongside it. Refs are scoped to your account, so they cannot collide with another integrator using the same value.',
      inputSchema: z.object({ wallet_ref: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ wallet_ref }) => {
      if (!key) return missingKey('wallet')
      return render(
        await call({ path: `/api/v1/wallets/by-ref/${encodeURIComponent(wallet_ref)}`, key })
      )
    }
  )

  server.registerTool(
    'wallet_balance',
    {
      title: 'Get a wallet balance',
      description:
        "Live USDC balance for a wallet, read from the chain. IMPORTANT: this covers only the chain the wallet was ISSUED on, and the response says which in its `chain` field. A deposit that landed on a different EVM chain will show in deposits while this still reads zero. Do not present this figure as a total across chains — multi-chain balances are not implemented.",
      inputSchema: z.object({ wallet_id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ wallet_id }) => {
      if (!key) return missingKey('wallet')
      return render(
        await call({ path: `/api/v1/wallets/${encodeURIComponent(wallet_id)}/balance`, key })
      )
    }
  )

  server.registerTool(
    'wallet_deposits',
    {
      title: 'List one wallet\'s deposits',
      description:
        'Deposit history for a single wallet, newest first. The polling counterpart to the wallet.deposit.received webhook.',
      inputSchema: z.object({
        wallet_id: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ wallet_id, limit, offset }) => {
      if (!key) return missingKey('wallet')
      return render(
        await call({
          path: `/api/v1/wallets/${encodeURIComponent(wallet_id)}/deposits`,
          key,
          query: { limit, offset },
        })
      )
    }
  )

  server.registerTool(
    'wallet_list_deposits',
    {
      title: 'List deposits across all wallets',
      description:
        'Every deposit across all your wallets, newest first. This is the reconciliation endpoint — use it to catch up after your webhook endpoint was down. Note that the limit and offset in the response are the values ACTUALLY applied after clamping, not the ones you asked for; page off those or you will skip records.',
      inputSchema: z.object({
        wallet_id: z.string().optional().describe('Narrow to a single wallet.'),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ wallet_id, limit, offset }) => {
      if (!key) return missingKey('wallet')
      return render(
        await call({ path: '/api/v1/deposits', key, query: { wallet_id, limit, offset } })
      )
    }
  )
}
