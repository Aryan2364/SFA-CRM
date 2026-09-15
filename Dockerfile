# Builds the SFA CRM Next.js app into a runnable image.
# GitHub Actions builds this and pushes it to GHCR as ghcr.io/aryan2364/sfacrm.
#
# No secrets are needed to BUILD this image. All real config (DATABASE_URL,
# session secret, SMTP, R2) is supplied at RUNTIME from .env.production on the
# server. The build runs with no database and no object storage reachable.
#
# NO PRISMA ENGINE BINARY IS INVOLVED, so there is nothing for musl to mismatch.
# This app uses the Prisma 7 driver adapter (@prisma/adapter-pg), which talks to
# PostgreSQL through the pure-JS `pg` driver — the same configuration v2e runs in
# production on this base image. Do NOT add `binaryTargets` to schema.prisma
# "just in case": there is no engine to target, and adding one only invites the
# alpine/musl confusion this setup avoids entirely.
FROM node:20-alpine
WORKDIR /app

# The Prisma schema and config are copied BEFORE `npm ci` so that `prisma
# generate` can run in the same cached layer as the install — editing app code
# then does not force a re-install or a re-generate.
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# The AWS RDS CA bundle, baked into the image at /app/certs/rds-global-bundle.pem,
# which is the default DATABASE_CA_CERT_PATH in src/lib/db.ts. The app now REFUSES
# TO START in production without it rather than falling back to an unverified
# connection, so this COPY is load-bearing -- if it is removed the container will
# fail fast at first query with a message naming the variable.
#
# Copied explicitly rather than left to the `COPY . .` below so that it is visible
# here, and so reordering the build cannot quietly drop it.
#
# The bundle is a PUBLIC certificate from
# https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -- nothing
# secret, no build-time network fetch, reproducible. AWS DOES ROTATE IT: it will
# need refreshing, and the failure mode when it expires is a refused connection,
# not a silent downgrade.
COPY certs ./certs
RUN npm ci && npx prisma generate

COPY . .

# Placeholder only — just enough for `next build` to complete. Overridden at
# runtime by .env.production and NOT a real credential.
ENV SESSION_SECRET=build-time-placeholder-at-least-32-characters-long

# 4 GB heap: TypeScript checking the generated Prisma client OOMs at the default
# on this codebase. v2e's Dockerfile raises it for the same reason.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

EXPOSE 3000

CMD ["npm", "start"]
