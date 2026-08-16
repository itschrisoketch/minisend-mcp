/**
 * A landing page exists for one reason: someone will paste the MCP URL into a
 * browser to check it's alive, and a JSON-RPC error is a poor answer to that.
 */
export default function Page() {
  return (
    <main
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        maxWidth: '46rem',
        margin: '0 auto',
        padding: '4rem 1.5rem',
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Minisend MCP</h1>
      <p style={{ marginTop: 0, color: '#555' }}>
        Stablecoins to local currency across Kenya, Nigeria, Ghana and Uganda — as tools your
        coding agent can call.
      </p>

      <h2 style={{ fontSize: '0.95rem', marginTop: '2.5rem' }}>Add it</h2>
      <pre
        style={{
          background: '#f5f5f5',
          padding: '1rem',
          overflowX: 'auto',
          fontSize: '0.8rem',
        }}
      >
        {`claude mcp add --transport http minisend \\
  https://mcp.minisend.xyz/mcp \\
  --header "Authorization: Bearer ms_live_..."`}
      </pre>

      <p style={{ fontSize: '0.85rem', color: '#555' }}>
        Add <code>--header &quot;X-Minisend-Wallet-Key: wsk_live_...&quot;</code> as well to get
        the Wallet API tools.
      </p>

      <p style={{ fontSize: '0.85rem', marginTop: '2rem' }}>
        Full documentation:{' '}
        <a href="https://docs.minisend.xyz/mcp">docs.minisend.xyz/mcp</a>
      </p>
    </main>
  )
}
