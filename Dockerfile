# Builds the SFA CRM Next.js app into a runnable image.
# GitHub Actions builds this and pushes it to GHCR as ghcr.io/aryan2364/sfacrm.
#
# No secrets are needed to BUILD this image. All real config (DB, session
# secret, SMTP) is supplied at RUNTIME from .env.production on the server.
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Placeholders only — just enough for `next build` to complete. They are
# overridden at runtime by .env.production and are NOT real credentials.
ENV NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key
ENV SESSION_SECRET=build-time-placeholder-at-least-32-characters-long

# Modest heap so the build also fits a small box if ever built outside CI.
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build

EXPOSE 3000

CMD ["npm", "start"]
