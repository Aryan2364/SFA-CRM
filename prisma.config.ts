import { defineConfig } from 'prisma/config'

// Prisma 7 no longer auto-loads .env; the datasource URL is resolved here at
// CLI time. The app itself never uses this file — it builds its own connection
// in src/lib/db.ts from DATABASE_URL at RUNTIME (see PLAN.md §2.4).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
})
