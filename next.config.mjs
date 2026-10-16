const isDev = process.env.NODE_ENV !== 'production'

// Content-Security-Policy, shipped REPORT-ONLY: the browser logs each violation
// to the console and blocks nothing. It is written from an inventory of what the
// app loads, but two sources cannot be proven from the code alone -- the host of
// the R2 signed URL /api/expenses/photo/[id] redirects to (R2_ENDPOINT may be a
// custom domain) and whatever the Google Maps embed pulls in -- so enforcing it
// unobserved could blank receipt photos or maps in production. Watch the console
// on a deployed build, then rename the header to Content-Security-Policy.
//
// 'unsafe-inline' on script-src is required: Next 14 App Router emits inline
// bootstrap scripts and this app sets no nonce. style-src needs it for the inline
// styles recharts, Radix and sonner write. Dev additionally needs 'unsafe-eval'
// (React Refresh) and a websocket (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Geist is self-hosted by next/font, so fonts are same-origin.
  "font-src 'self' data:",
  // blob: is the receipt preview before upload; R2 is the signed-URL redirect
  // target of /api/expenses/photo/[id].
  "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
  // Reverse geocoding goes through /api/daily-activity/reverse-geocode, so the
  // browser only ever talks to its own origin.
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  // The "Show map" meeting-location embed.
  'frame-src https://www.google.com https://maps.google.com',
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
].join('; ')

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Browsers honour this only over HTTPS, so it is inert on localhost.
  // No includeSubDomains: the production domain is unconfirmed and this server
  // hosts other apps; on an apex domain it would force HTTPS on their subdomains.
  // Add it once the domain layout is confirmed.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // Geolocation is the check-in and meeting GPS fix (src/components/daily-activity/types.ts).
  // The receipt photo is a plain file input with no `capture`, so the OS picker
  // provides any camera -- the page itself never needs camera or microphone.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()' },
  { key: 'Content-Security-Policy-Report-Only', value: csp },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone: a server.js plus only the node_modules files tracing
  // proves the app reaches, instead of the whole 1.1 GB tree. The Dockerfile's
  // runner stage ships that and nothing else. Local `next dev` and `next start`
  // are unaffected -- this only adds an extra output directory at build time.
  output: 'standalone',
  // Several agents share this working tree, and `next build` CLEARS its output
  // directory on start — so a build wipes a running `next dev`'s output and two
  // concurrent builds corrupt each other, surfacing as MODULE_NOT_FOUND or a
  // missing pages-manifest.json that looks like a code fault and is not. Each
  // build sets NEXT_DIST_DIR to its own directory instead. The default is
  // unchanged, so production builds and `next start` are unaffected.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
