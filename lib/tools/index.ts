/**
 * Tool registration, and the visibility rules that decide what a given caller
 * sees in tools/list.
 *
 * The rule: never advertise a tool the caller cannot use. A developer whose
 * account has no off-ramp access should not see six off-ramp tools and learn
 * about the gate from a 403 on the first call — and an agent handed tools that
 * always fail will burn turns retrying them.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { call } from '../client'
import type { Credentials } from '../credentials'
import { render, missingKey, ok } from './shared'
import { registerOfframpTools } from './offramp'
import { registerOnrampTools } from './onramp'
import { registerCheckoutTools } from './checkout'
import { registerWalletTools } from './wallets'
import { registerKnowledgeTools } from './knowledge'

interface MeResponse {
  scopes?: string[]
  products?: { checkout?: boolean; offramp?: boolean; onramp?: boolean }
}

export interface Access {
  checkout: boolean
  offramp: boolean
  onramp: boolean
  /** True when the key was rejected outright, as opposed to merely limited. */
  keyRejected: boolean
}

/**
 * Ask the API what this key can do.
 *
 * Fails OPEN on anything that isn't an explicit rejection: if introspection is
 * down or slow, showing all the product tools is far better than silently
 * serving a knowledge-only server and leaving the developer to wonder where
 * their tools went. A tool that 403s is a clear message; a tool that is absent
 * is a mystery.
 */
export async function resolveAccess(key: string | undefined): Promise<Access> {
  if (!key) return { checkout: false, offramp: false, onramp: false, keyRejected: false }

  const result = await call<MeResponse>({ path: '/api/merchant/me', key })

  if (!result.ok) {
    if (result.error.status === 401) {
      return { checkout: false, offramp: false, onramp: false, keyRejected: true }
    }
    return { checkout: true, offramp: true, onramp: true, keyRejected: false }
  }

  const products = result.data?.products
  // A 200 with no products block means an older API build that predates
  // introspection — fail open for the same reason as above.
  if (!products) return { checkout: true, offramp: true, onramp: true, keyRejected: false }

  return {
    checkout: !!products.checkout,
    offramp: !!products.offramp,
    onramp: !!products.onramp,
    keyRejected: false,
  }
}

function registerAccountTools(server: McpServer, key: string | undefined) {
  server.registerTool(
    'minisend_whoami',
    {
      title: 'Check which Minisend products this key can use',
      description:
        'Report the calling key\'s scopes and which products it can actually use right now. Useful when a call returned 403 and you want to know what IS available, or to confirm a key is live before starting a flow.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!key) return missingKey('merchant')
      return render(await call({ path: '/api/merchant/me', key }))
    }
  )
}

export async function registerTools(server: McpServer, creds: Credentials): Promise<void> {
  // Always available: they need no credential and are the most useful thing to
  // have when a credential is what's wrong.
  registerKnowledgeTools(server)

  if (creds.malformedMerchantKey || creds.malformedWalletKey) {
    server.registerTool(
      'minisend_diagnose_credentials',
      {
        title: 'Why are the Minisend product tools missing?',
        description:
          'Explains a credential problem detected on this connection. Call this if you expected payment tools and only see knowledge tools.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () =>
        ok({
          problem: creds.malformedMerchantKey
            ? 'The Authorization header did not contain a recognisable Minisend key.'
            : 'The X-Minisend-Wallet-Key header did not contain a wallet key.',
          expected: {
            authorization: 'Bearer ms_live_… — off-ramp, on-ramp and checkout',
            'x-minisend-wallet-key': 'wsk_live_… — the Wallet API only',
          },
          note: 'The two namespaces are not interchangeable. A ms_live_ key in the wallet header, or a placeholder like YOUR_API_KEY left unedited, both land here.',
          fix: 'Re-add the server with the correct header value, then restart the client so it re-reads the tool list.',
        })
    )
  }

  if (creds.merchantKey) {
    registerAccountTools(server, creds.merchantKey)

    const access = await resolveAccess(creds.merchantKey)

    if (access.keyRejected) {
      server.registerTool(
        'minisend_diagnose_key',
        {
          title: 'Why are the Minisend product tools missing?',
          description:
            'Explains why no payment tools are available on this connection.',
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        async () =>
          ok({
            problem: 'The API key was rejected by Minisend.',
            likely_causes: [
              'Mistyped or truncated on the way into the client config',
              'Revoked in the dashboard',
              'A test placeholder that was never replaced',
            ],
            fix: 'Re-copy the key from the Minisend dashboard, re-add the server, and restart the client.',
          })
      )
      return
    }

    if (access.checkout) registerCheckoutTools(server, creds.merchantKey)
    if (access.offramp) registerOfframpTools(server, creds.merchantKey)
    if (access.onramp) registerOnrampTools(server, creds.merchantKey)
  }

  // A separate product on a separate key namespace: present only when the
  // caller actually supplied one.
  if (creds.walletKey) registerWalletTools(server, creds.walletKey)
}
