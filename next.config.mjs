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
  eslint: {
    // `next build` runs ESLint itself. Until this repo had an .eslintrc.json
    // there was no config, so builds silently skipped linting; adding one made
    // six PRE-EXISTING errors (two unescaped apostrophes in UI files, four
    // stale eslint-disable comments naming a rule the config does not define)
    // start failing the build. Linting stays a separate, explicit gate --
    // `npm run lint` -- exactly as PLAN.md 8's per-batch loop lists it, rather
    // than blocking every build on pre-existing issues this migration did not
    // introduce and must not fix in UI files (PLAN.md 2.1).
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/site.webmanifest',
        headers: [{ key: 'Content-Type', value: 'application/manifest+json' }],
      },
    ]
  },
}

export default nextConfig
