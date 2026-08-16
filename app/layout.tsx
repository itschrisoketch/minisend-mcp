import type { ReactNode } from 'react'

export const metadata = {
  title: 'Minisend MCP',
  description:
    'MCP server for the Minisend payment APIs — stablecoins to local currency across Africa.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
