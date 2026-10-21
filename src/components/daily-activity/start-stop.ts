import type { LocationReading } from './location-check-sheet'

/**
 * The PATCH a meeting's Start or Stop sends, from a reading the person has
 * already seen and confirmed (`LocationCheckSheet`). Shared by the phone
 * meeting page and the phone to-do page, which creates a meeting and then
 * starts it through this same call — the field names differ between the two
 * actions (`latitude` vs `end_latitude`), which is easy to get wrong twice.
 *
 * Resolves to the server's refusal text, or null when it worked. Never throws.
 */
export async function sendStartStop(
  visitId: string,
  action: 'start' | 'stop',
  reading: LocationReading | null
): Promise<string | null> {
  const body =
    action === 'start'
      ? { action, latitude: reading?.latitude ?? null, longitude: reading?.longitude ?? null, address: reading?.address ?? null, accuracy: reading?.accuracy ?? null }
      : {
          action,
          end_latitude: reading?.latitude ?? null,
          end_longitude: reading?.longitude ?? null,
          end_address: reading?.address ?? null,
          end_accuracy: reading?.accuracy ?? null,
        }
  try {
    const r = await fetch(`/api/daily-activity/${visitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (r.ok) return null
    return (await r.json().catch(() => ({}))).error ?? `Could not ${action} the meeting.`
  } catch {
    return 'The connection dropped. Nothing was saved.'
  }
}
