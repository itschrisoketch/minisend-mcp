# Minisend MCP

An MCP server for the Minisend payment APIs. Stablecoins to local currency across
Kenya, Nigeria, Ghana and Uganda — as tools a coding agent can call directly.

```bash
claude mcp add --transport http minisend https://mcp.minisend.xyz/mcp \
  --header "Authorization: Bearer ms_live_..."
```

That's the whole install. No package, no clone, no build.

Add the Wallet API tools with a second header:

```bash
--header "X-Minisend-Wallet-Key: wsk_live_..."
```

## What it does

Two things at once.

**Operates your account** — quote and create payouts, collect from M-Pesa, create
checkout sessions, provision wallets, read order status.

**Explains the API** — the structured lookups that prose search answers badly:
exact field lists per endpoint, recipient rules per currency and payout method,
error causes with the actual fix, and webhook verification rules.

The knowledge tools need no key, so an agent can learn the API before anyone has
provisioned anything.

## Tools

| Product | Tools |
| --- | --- |
| Off-ramp | `offramp_quote`, `offramp_validate_account`, `offramp_create_order`, `offramp_submit_deposit`, `offramp_get_order`, `offramp_list_orders` |
| On-ramp | `onramp_quote`, `onramp_create_order`, `onramp_get_order`, `onramp_list_orders` |
| Checkout | `checkout_create_session`, `checkout_get_session` |
| Wallets | `wallet_create`, `wallet_get`, `wallet_get_by_ref`, `wallet_balance`, `wallet_deposits`, `wallet_list_deposits` |
| Account | `minisend_whoami` |
| Knowledge | `minisend_api_schema`, `minisend_recipient_rules`, `minisend_explain_error`, `minisend_webhook_spec` |

**You only see the tools your key can use.** The server asks
`GET /api/merchant/me` what the key is authorised for and lists accordingly, so
an account without off-ramp access never sees off-ramp tools. Wallet tools appear
only when the wallet header is present.

If introspection is unavailable the server fails **open** — all product tools are
listed and the API's own 403 is the authority. A tool that errors clearly beats a
tool that mysteriously isn't there.

## Credentials

Keys are read from the request headers, forwarded to Minisend, and discarded.
Nothing is stored, cached, or written to logs. The server holds no Minisend
credentials of its own.

The two key namespaces are not interchangeable: `ms_live_` covers off-ramp,
on-ramp and checkout; `wsk_live_` covers the Wallet API only.

## These tools move real money

There is no sandbox. Every call goes to production:
`offramp_create_order` creates a real payout order, and `onramp_create_order`
sends a real payment prompt to a real phone. MCP clients prompt before each tool
call — leave that on.

## Development

```bash
pnpm install
pnpm dev         # http://localhost:3100/mcp
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs two suites: the knowledge data assertions, and an integration
suite that drives the real handler over JSON-RPC against a stub API — covering
protocol handshake, tool visibility per key, credential forwarding and tool
execution.

Point at a different backend with `MINISEND_API_BASE`.

### The currency matrix can drift

`lib/knowledge/recipients.ts` mirrors `CURRENCY_CONFIG` from the
minisend-merchant repo. Different repos, so it can fall out of step — and an
agent builds payout bodies from it. `scripts/test-knowledge-data.ts` pins every
value; if the matrix changes upstream, update both and the test tells you the
numbers match.

## Related

- Docs: [docs.minisend.xyz](https://docs.minisend.xyz)
- Agent skill: [`itschrisoketch/minisend-skills`](https://github.com/itschrisoketch/minisend-skills)
