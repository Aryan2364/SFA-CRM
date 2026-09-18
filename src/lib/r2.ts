import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Thin wrapper over Cloudflare R2 (S3-compatible object storage), adapted from
 * v2e's `backend/src/storage/r2.service.ts` — the same account, the same
 * credentials, the same posture — with the NestJS `@Injectable` dropped for a
 * plain module.
 *
 * The bucket is PRIVATE. Objects are never public: uploads go through the API
 * (so the request can be validated and authorised first) and reads are served
 * as short-lived signed URLs. This is a security improvement over what it
 * replaces — the Supabase `expense-photos` bucket was PUBLIC, so any receipt was
 * viewable by anyone holding the link, with no session at all.
 *
 * Credentials come from the environment at RUNTIME (PLAN.md §2.4) — nothing is
 * baked into the image:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT
 *
 * These credentials also grant write access to v2e's and LBD's buckets, so every
 * operation here is pinned to `R2_BUCKET` explicitly. Never derive a bucket from
 * user input and never list buckets.
 */

let client: S3Client | null = null

function bucket(): string {
  return process.env.R2_BUCKET ?? ''
}

/**
 * Whether R2 is configured. Lets callers fail with a clear message rather than a
 * cryptic SDK error several frames deep.
 */
export function isConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      bucket() &&
      (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID)
  )
}

/**
 * Built on FIRST USE, not at import. `next build` runs with no R2 variables, and
 * constructing the client at module scope would make merely importing this file
 * from a route break the build — the same reasoning as the Prisma client in
 * src/lib/db.ts (PLAN.md §5.7).
 */
function getClient(): S3Client {
  if (!isConfigured()) {
    throw new Error('File storage is not configured. Set the R2_* environment variables.')
  }
  if (!client) {
    // R2_ENDPOINT is ACCOUNT-level and must NOT contain the bucket name — the
    // S3 client sends `Bucket` separately, so including it doubles the path and
    // 404s. No `forcePathStyle`: v2e omits it and it works.
    const endpoint =
      process.env.R2_ENDPOINT ||
      `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    })
  }
  return client
}

/** Store bytes at `key`. Throws on transport failure; callers answer with a 500. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

/**
 * A time-limited GET url that renders the object INLINE (in-browser) rather than
 * forcing a download — receipts are opened in a new tab, not saved. The bucket
 * stays private; only a holder of this short-lived url can fetch the object.
 *
 * Mirrors v2e's `getSignedInlineUrl`.
 */
export async function getSignedInlineUrl(
  key: string,
  displayName: string,
  expiresInSeconds = 300
): Promise<string> {
  const safe = displayName.replace(/"/g, '')
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: `inline; filename="${safe}"`,
  })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

/**
 * The object key for an expense receipt: `receipts/{tenantId}/{photoId}.{ext}`.
 * No `sfacrm/` prefix — the bucket is already the namespace.
 *
 * Kept here so the upload route and the read route cannot drift apart on the
 * layout, and so the key is always derived server-side from a tenant id the
 * caller never supplies.
 */
export function receiptKey(tenantId: string, photoFile: string): string {
  return `receipts/${tenantId}/${photoFile}`
}

/**
 * The object key for a Deal attachment: `deals/{tenantId}/{file}`.
 *
 * The same shape as `receiptKey` and for the same reasons: the layout lives in
 * one place so the upload route and the read route cannot drift, and the tenant
 * half comes from the session rather than the request, so one tenant can never
 * write into — or read out of — another's prefix.
 *
 * `file` is the stored object's own name (`<uuid>.<ext>`), generated server-side.
 * It is NOT the name the user uploaded: that is kept in `deal_attachments.file_name`
 * and only ever used as a display label, never as part of a key.
 */
export function dealKey(tenantId: string, file: string): string {
  return `deals/${tenantId}/${file}`
}
