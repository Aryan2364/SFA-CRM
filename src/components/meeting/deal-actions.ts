/**
 * The write behind "Discussed in this meeting", shared by the desktop
 * `DealsSection` and the phone meeting screen so both call the same route the
 * same way. Returns null on success, or the sentence to toast.
 */
export async function setDealDiscussed(
  visitId: string,
  dealId: string,
  discussed: boolean
): Promise<string | null> {
  try {
    const r = discussed
      ? await fetch('/api/deal-meetings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visit_id: visitId, deal_id: dealId }),
        })
      : await fetch(`/api/deal-meetings?visit_id=${visitId}&deal_id=${dealId}`, { method: 'DELETE' })
    if (r.ok) return null
    const err = await r.json().catch(() => ({}))
    return err.error ?? 'Could not save that'
  } catch {
    return 'The connection dropped. That was not saved.'
  }
}
