/**
 * Guarded reads for client screens.
 *
 * Section 14 rule 3: a failed load is its own state, not a skeleton
 * that never resolves. Section 14 rule 4: a promise that cannot reject
 * cannot be rendered as an error, so every request carries a deadline
 * at the point it is made - `fetch` has none of its own.
 *
 * Four things happen here once instead of once per screen:
 *
 *   1. the status is checked before the body is trusted. A 403 resolves,
 *      so a bare `.catch` never sees it and the `{ error }` body lands in
 *      state typed as an array. The next render maps over it and throws.
 *   2. a list is proved to be a list before a component maps over it.
 *   3. 403 is separated from every other failure. Retrying a 403 only
 *      fails again, so that state offers no Retry.
 *   4. an aborted request is reported as such, so a caller that raced
 *      two requests can drop the older answer instead of rendering it.
 *
 * 401 is deliberately NOT special-cased here: it is reported like any
 * other failure and the session handling lives elsewhere.
 */
export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; forbidden: boolean; aborted: boolean }

const DEFAULT_TIMEOUT_MS = 20000

export async function loadJson<T>(
  url: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<LoadResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const relay = () => controller.abort()
  signal?.addEventListener('abort', relay)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return { ok: false, forbidden: res.status === 403, aborted: false }
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, forbidden: false, aborted: signal?.aborted ?? false }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', relay)
  }
}

export async function loadList<T>(
  url: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<LoadResult<T[]>> {
  const res = await loadJson<unknown>(url, signal, timeoutMs)
  if (!res.ok) return res
  if (!Array.isArray(res.data)) return { ok: false, forbidden: false, aborted: false }
  return { ok: true, data: res.data as T[] }
}
