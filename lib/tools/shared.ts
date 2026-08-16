import type { CallToolResult } from '@modelcontextprotocol/server'
import type { ApiResult } from '../client'

/**
 * What a tool hands back to the agent.
 *
 * Results are JSON text rather than `structuredContent`, deliberately: the
 * latter is only valid alongside a declared `outputSchema`, and pinning output
 * schemas to twenty-odd live endpoints would mean a schema mismatch surfacing
 * as a protocol error the moment the API adds a field. JSON in a text block
 * degrades gracefully instead.
 *
 * Typed as the SDK's own result rather than a local shape, so a protocol
 * change shows up here as a compile error instead of at runtime.
 */
export type ToolResponse = CallToolResult

export function ok(data: unknown, note?: string): ToolResponse {
  const body = JSON.stringify(data, null, 2)
  return { content: [{ type: 'text', text: note ? `${note}\n\n${body}` : body }] }
}

export function fail(message: string): ToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Renders an API result. Errors carry the fix inline, because an agent reading
 * only the first line of an error still needs to know whether to retry.
 */
export function render(result: ApiResult, note?: string): ToolResponse {
  if (result.ok) return ok(result.data, note)

  const { status, message, retryable, fix } = result.error
  return fail(
    [
      `Minisend API error (${status || 'network'}): ${message}`,
      `Retryable: ${retryable ? 'yes' : 'no'}`,
      `What to do: ${fix}`,
    ].join('\n')
  )
}

/** Shown when a tool is called without the credential it needs. */
export function missingKey(which: 'merchant' | 'wallet'): ToolResponse {
  return fail(
    which === 'merchant'
      ? 'No Minisend API key was supplied. Add the server with a header: Authorization: Bearer ms_live_... — then this tool will work.'
      : 'No Wallet API key was supplied. The Wallet API uses a separate key namespace: add the header X-Minisend-Wallet-Key: wsk_live_... — a ms_live_ key will not work here.'
  )
}

/**
 * Idempotency keys for create calls. An agent that retries after a timeout must
 * not create a second order — on the on-ramp that means a second M-Pesa prompt
 * at a real customer's phone.
 *
 * The caller may pass their own so a retry across separate tool calls collapses
 * onto one order; otherwise one is generated per call, which still protects the
 * transport-level retries inside a single call.
 */
export function idempotencyKey(supplied?: string): string {
  return supplied?.trim() || `mcp-${crypto.randomUUID()}`
}
