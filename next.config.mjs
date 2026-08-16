/** @type {import('next').NextConfig} */
const nextConfig = {
  // The MCP route is pure request/response over the caller's own credentials —
  // nothing here is prerenderable and nothing is cacheable.
  reactStrictMode: true,
}

export default nextConfig
