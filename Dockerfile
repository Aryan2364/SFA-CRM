# Builds the SFA CRM Next.js app into a runnable image.
# GitHub Actions builds this and pushes it to GHCR as ghcr.io/aryan2364/sfacrm.
#
# MULTI-STAGE. Stage 1 installs every dependency and compiles the app; stage 2
# starts from a clean base and copies over only what `next start` actually
# needs. Stage 1 is discarded on the build runner and never reaches GHCR, so
# the compilers, type checker, Prisma CLI and build cache -- ~2.5 GB of tooling
# that the running container cannot use -- stop being shipped to the server.
# The single-stage version this replaced produced a 2.9 GB image to serve a
# ~20 MB site, and the 19 GB server volume could not absorb that five apps over.
#
# No secrets are needed to BUILD this image. All real config (DATABASE_URL,
# session secret, SMTP, R2) is supplied at RUNTIME from .env.production on the
# server. The build runs with no database and no object storage reachable.
#
# NO PRISMA QUERY ENGINE BINARY IS INVOLVED, so there is nothing for musl to
# mismatch. This app uses the Prisma 7 driver adapter (@prisma/adapter-pg),
# which talks to PostgreSQL through the pure-JS `pg` driver -- the same
# configuration v2e runs in production on this base image. Do NOT add
# `binaryTargets` to schema.prisma "just in case": there is no engine to
# target, and adding one only invites the alpine/musl confusion this setup
# avoids entirely. (The `prisma` CLI does pull a schema-engine binary in as a
# dependency, but it is used only by `prisma migrate` -- which nothing here
# runs -- and it stays behind in stage 1.)


# ---------------------------------------------------------------------------
# Stage 1: builder -- install everything, generate the client, compile the app.
# Nothing from this stage ships unless stage 2 explicitly copies it.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# The Prisma schema and config are copied BEFORE `npm ci` so that `prisma
# generate` can run in the same cached layer as the install -- editing app code
# then does not force a re-install or a re-generate.
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci && npx prisma generate

COPY . .

# Placeholder only -- just enough for `next build` to complete. Overridden at
# runtime by .env.production and NOT a real credential.
ENV SESSION_SECRET=build-time-placeholder-at-least-32-characters-long

# 4 GB heap: TypeScript checking the generated Prisma client OOMs at the default
# on this codebase. v2e's Dockerfile raises it for the same reason.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build


# ---------------------------------------------------------------------------
# Stage 2: runner -- a clean base holding only the compiled app.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# The standalone server reads these rather than taking CLI flags. HOSTNAME must
# be 0.0.0.0, not localhost: the process has to accept connections arriving from
# outside its own network namespace or Docker's published port reaches nothing.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Next writes its fetch/ISR cache under .next/cache at runtime. Left to itself
# it would warn on every miss once the app runs unprivileged; the directory is
# created and owned here instead.
RUN mkdir -p .next/cache && chown -R node:node /app

# The AWS RDS CA bundle, baked into the image at /app/certs/rds-global-bundle.pem,
# which is the default DATABASE_CA_CERT_PATH in src/lib/db.ts. The app now REFUSES
# TO START in production without it rather than falling back to an unverified
# connection, so this COPY is load-bearing -- if it is removed the container will
# fail fast at first query with a message naming the variable. It is copied from
# the build context rather than from stage 1 so that it stays visible here and a
# reordering of the build cannot quietly drop it.
#
# The bundle is a PUBLIC certificate from
# https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -- nothing
# secret, no build-time network fetch, reproducible. AWS DOES ROTATE IT: it will
# need refreshing, and the failure mode when it expires is a refused connection,
# not a silent downgrade.
COPY --chown=node:node certs ./certs

# `output: 'standalone'` in next.config.mjs makes next build emit a self-contained
# server: .next/standalone holds server.js plus ONLY the node_modules files the
# app was traced to actually reach -- tens of MB in place of the full 1.1 GB tree.
# Static assets are deliberately excluded from that trace and must be copied
# alongside it, hence the next two lines; without them the app serves HTML with
# no CSS or JS and 404s every icon.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# The generated Prisma client lives in node_modules/.prisma/client, which Next's
# file tracing reaches only through a dynamic require it cannot always follow.
# Copying it explicitly costs a few MB and removes the failure mode entirely --
# an app that builds clean and then cannot open a database connection at boot.
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

# Runs unprivileged. `node` (uid 1000) ships with the base image; every path
# above is chowned to it. Drop this line if something needs to write outside /app.
USER node

EXPOSE 3000

# NOT `npm start` (= `next start`), which needs the full next package and the
# dependency tree stage 2 no longer carries. The standalone bundle is started by
# running the server.js it generated.
CMD ["node", "server.js"]
