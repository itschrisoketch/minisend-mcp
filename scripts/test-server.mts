/**
 * Drives the real MCP handler over real JSON-RPC requests, against a stub
 * standing in for merchant.minisend.xyz.
 *
 * This is the test that would have caught the two things unit-testing the tool
 * modules cannot: that the handler speaks the protocol at all, and that tool
 * VISIBILITY resolves correctly per caller — which is the whole reason
 * /api/merchant/me was added upstream.
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

let checks = 0
function check(name: string, fn: () => void) {
  fn()
  checks++
  console.log(`  ok  ${name}`)
}

/** What the stub should claim the calling key can do. */
type StubMode =
  | { kind: 'all' }
  | { kind: 'checkout-only' }
  | { kind: 'rejected' }
  | { kind: 'introspection-down' }

let mode: StubMode = { kind: 'all' }
const seenAuth: string[] = []

async function startStub(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    seenAuth.push(req.headers.authorization ?? '')

    if (req.url?.startsWith('/api/merchant/me')) {
      if (mode.kind === 'rejected') {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'Invalid API key' }))
      }
      if (mode.kind === 'introspection-down') {
        res.writeHead(500, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'boom' }))
      }
      const products =
        mode.kind === 'all'
          ? { checkout: true, offramp: true, onramp: true }
          : { checkout: true, offramp: false, onramp: false }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ scopes: Object.keys(products), products }))
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ stub: true, path: req.url }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}` }
}

const { server: stub, base } = await startStub()
process.env.MINISEND_API_BASE = base

// Imported AFTER the env var is set: lib/client reads it at module load.
const { createMcpHandler } = await import('mcp-handler')
const { extractCredentials } = await import('../lib/credentials')
const { registerTools } = await import('../lib/tools')

const RPC_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

/** One JSON-RPC round trip through the handler, with the given headers. */
async function rpc(
  headers: Record<string, string>,
  method: string,
  params: unknown = {}
): Promise<any> {
  const request = new Request('https://mcp.minisend.xyz/mcp', {
    method: 'POST',
    headers: { ...RPC_HEADERS, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

  const credentials = extractCredentials(request)
  const handler = createMcpHandler(
    async (server: any) => {
      await registerTools(server, credentials)
    },
    { serverInfo: { name: 'minisend', version: 'test' } }
  )

  const response = await handler(request)
  const text = await response.text()

  // Streamable HTTP may answer as SSE; unwrap the single data frame.
  if (text.startsWith('event:') || text.includes('\ndata: ')) {
    const line = text.split('\n').find((l) => l.startsWith('data: '))
    return JSON.parse(line!.slice(6))
  }
  return JSON.parse(text)
}

async function toolNames(headers: Record<string, string>): Promise<string[]> {
  const body = await rpc(headers, 'tools/list')
  assert.ok(body.result, `tools/list returned no result: ${JSON.stringify(body)}`)
  return body.result.tools.map((t: { name: string }) => t.name).sort()
}

const MERCHANT = { authorization: 'Bearer ms_live_abcdef0123456789' }
const WALLET = { 'x-minisend-wallet-key': 'Bearer wsk_live_abcdef0123456789' }

console.log('\nprotocol')

{
  const body = await rpc(MERCHANT, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  })
  check('initialize returns a server implementation', () => {
    assert.ok(body.result, JSON.stringify(body))
    assert.equal(body.result.serverInfo.name, 'minisend')
  })
}

console.log('\ntool visibility')

{
  mode = { kind: 'all' }
  const names = await toolNames(MERCHANT)

  check('a fully-enabled key sees every product', () => {
    for (const t of [
      'offramp_create_order',
      'offramp_quote',
      'onramp_create_order',
      'checkout_create_session',
      'minisend_whoami',
    ]) {
      assert.ok(names.includes(t), `missing ${t} in ${names.join(', ')}`)
    }
  })

  check('wallet tools stay hidden without the wallet header', () => {
    assert.equal(names.filter((n) => n.startsWith('wallet_')).length, 0)
  })

  check('knowledge tools are present', () => {
    for (const t of [
      'minisend_api_schema',
      'minisend_recipient_rules',
      'minisend_explain_error',
      'minisend_webhook_spec',
    ]) {
      assert.ok(names.includes(t), `missing ${t}`)
    }
  })
}

{
  mode = { kind: 'checkout-only' }
  const names = await toolNames(MERCHANT)

  check('a checkout-only key sees no off-ramp or on-ramp tools', () => {
    assert.ok(names.includes('checkout_create_session'))
    assert.equal(names.filter((n) => n.startsWith('offramp_')).length, 0)
    assert.equal(names.filter((n) => n.startsWith('onramp_')).length, 0)
  })
}

{
  mode = { kind: 'all' }
  const names = await toolNames({ ...MERCHANT, ...WALLET })

  check('the wallet header adds exactly the six wallet tools', () => {
    const wallet = names.filter((n) => n.startsWith('wallet_'))
    assert.deepEqual(wallet, [
      'wallet_balance',
      'wallet_create',
      'wallet_deposits',
      'wallet_get',
      'wallet_get_by_ref',
      'wallet_list_deposits',
    ])
  })
}

{
  const names = await toolNames({})

  check('no key at all still yields the knowledge tools', () => {
    assert.ok(names.includes('minisend_api_schema'))
    assert.ok(names.includes('minisend_recipient_rules'))
  })

  check('no key yields no product tools and no whoami', () => {
    assert.equal(names.filter((n) => n.startsWith('offramp_')).length, 0)
    assert.ok(!names.includes('minisend_whoami'))
  })
}

{
  const names = await toolNames({ authorization: 'Bearer YOUR_API_KEY_HERE' })

  check('a placeholder key surfaces a diagnostic tool, not silence', () => {
    assert.ok(names.includes('minisend_diagnose_credentials'), names.join(', '))
  })
}

{
  mode = { kind: 'rejected' }
  const names = await toolNames(MERCHANT)

  check('a rejected key surfaces a diagnostic instead of product tools', () => {
    assert.ok(names.includes('minisend_diagnose_key'), names.join(', '))
    assert.equal(names.filter((n) => n.startsWith('offramp_')).length, 0)
  })
}

{
  mode = { kind: 'introspection-down' }
  const names = await toolNames(MERCHANT)

  check('introspection failure fails OPEN — tools stay available', () => {
    assert.ok(names.includes('offramp_create_order'))
    assert.ok(names.includes('onramp_create_order'))
    assert.ok(names.includes('checkout_create_session'))
  })
}

console.log('\ncredential handling')

{
  mode = { kind: 'all' }
  seenAuth.length = 0
  await toolNames(MERCHANT)

  check('the caller key is forwarded verbatim to the API', () => {
    assert.ok(
      seenAuth.some((a) => a === 'Bearer ms_live_abcdef0123456789'),
      `saw: ${seenAuth.join(' | ')}`
    )
  })
}

{
  // A wallet key pasted into Authorization is a common mistake; it should still
  // produce wallet tools rather than an empty server.
  const names = await toolNames({ authorization: 'Bearer wsk_live_abcdef0123456789' })

  check('a wallet key in the Authorization header still yields wallet tools', () => {
    assert.ok(names.includes('wallet_create'), names.join(', '))
  })
}

console.log('\ntool execution')

{
  mode = { kind: 'all' }
  const body = await rpc(MERCHANT, 'tools/call', {
    name: 'minisend_recipient_rules',
    arguments: { currency: 'GHS', method: 'PAYBILL' },
  })

  check('an impossible currency/method pair is refused with the valid list', () => {
    const text = body.result.content[0].text as string
    assert.equal(body.result.isError, true)
    assert.match(text, /not available for GHS/)
    assert.match(text, /MOBILE/)
  })
}

{
  const body = await rpc(MERCHANT, 'tools/call', {
    name: 'minisend_recipient_rules',
    arguments: { currency: 'KES', method: 'PAYBILL' },
  })

  check('KES PAYBILL returns the required fields and the submit-hash flow', () => {
    const parsed = JSON.parse(body.result.content[0].text)
    assert.deepEqual(parsed.required_fields.PAYBILL, [
      'account_name',
      'paybill',
      'paybill_account',
    ])
    assert.match(parsed.deposit_flow, /report the transaction hash/)
  })
}

{
  const body = await rpc(MERCHANT, 'tools/call', {
    name: 'minisend_explain_error',
    arguments: { status: 403, message: "Your account doesn't have off-ramp access yet." },
  })

  check('explain_error returns the dual-gate advice and marks it unretryable', () => {
    const parsed = JSON.parse(body.result.content[0].text)
    assert.equal(parsed.retryable, false)
    assert.match(parsed.fix, /info@minisend\.xyz/)
  })
}

{
  const body = await rpc(MERCHANT, 'tools/call', {
    name: 'onramp_quote',
    arguments: { amount_usdc: 10, amount_kes: 1500 },
  })

  check('on-ramp quote refuses both amounts at once', () => {
    assert.equal(body.result.isError, true)
    assert.match(body.result.content[0].text, /exactly one/)
  })
}

{
  const body = await rpc(MERCHANT, 'tools/call', {
    name: 'offramp_create_order',
    arguments: {
      amount: 10,
      currency: 'KES',
      refund_address: 'not-an-address',
      recipient: { account_name: 'A', method: 'MOBILE', phone: '0712345678', mobile_network: 'Safaricom' },
    },
  })

  check('a bad refund_address is rejected by the schema before any API call', () => {
    assert.ok(body.error || body.result?.isError, JSON.stringify(body))
  })
}

stub.close()
console.log(`\n${checks} checks passed\n`)
