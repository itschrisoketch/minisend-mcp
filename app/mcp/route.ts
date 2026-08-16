/**
 * POST /mcp — the whole server.
 *
 * Stateless: every request carries its own credentials and is answered on its
 * own. There is no session store, which is what makes this safe to run on
 * serverless and what makes a redeploy invisible to connected clients.
 *
 * The handler is built PER REQUEST rather than once at module scope, because
 * which tools exist depends on who is asking — the caller's key decides the
 * tool list, so registration cannot happen before the request is in hand.
 */
import { createMcpHandler } from 'mcp-handler'
import type { McpServer } from '@modelcontextprotocol/server'
import { extractCredentials } from '@/lib/credentials'
import { registerTools } from '@/lib/tools'

export const runtime = 'nodejs'
// Order creation calls a payout provider synchronously; the client-side ceiling
// is 30s, so leave headroom above it rather than racing it.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const SERVER_INFO = {
  name: 'minisend',
  version: '0.1.0',
}

async function handle(request: Request): Promise<Response> {
  const credentials = extractCredentials(request)

  const handler = createMcpHandler(
    async (server: McpServer) => {
      await registerTools(server, credentials)
    },
    {
      serverInfo: SERVER_INFO,
      instructions: [
        'Minisend moves money between stablecoins and local currency across Kenya, Nigeria, Ghana and Uganda.',
        '',
        'Before building a request body, call minisend_api_schema for the endpoint and minisend_recipient_rules for the currency and payout method — required fields differ by both, and mobile network names are case-sensitive exact strings.',
        '',
        'Three rules that prevent most failures:',
        '1. No quote is a lock. Quotes reserve nothing and orders are priced fresh at creation. Read the final numbers back from the response you act on.',
        '2. Creating an off-ramp order pays nobody. The flow is non-custodial: you send the USDC yourself, then for KES, GHS and UGX you must also report the transaction hash.',
        '3. Creating an on-ramp order rings a real phone immediately, and is one-shot. If the customer cancels, create a new order rather than retrying the same one.',
        '',
        'If a call fails, call minisend_explain_error rather than guessing — several errors are deliberately ambiguous about their cause and retrying them is wasted effort.',
      ].join('\n'),
    }
  )

  return handler(request)
}

export { handle as GET, handle as POST, handle as DELETE }
