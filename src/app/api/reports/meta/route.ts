import { NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { checkPermission, type PermSection } from '@/lib/permissions'
import { MEASURES, type MeasureDef } from '@/lib/reports/measures'
import { dimensionsForSource, AGEING_BANDS, PROBABILITY_BANDS } from '@/lib/reports/dimensions'
import { SOURCE_DEFS } from '@/lib/reports/sources'
import { PRESETS, HEADLINE_SPECS } from '@/lib/reports/presets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/meta — what this user can actually build.
 *
 * The report builder (P5-T2) needs the registries to populate its pickers, and
 * the global UI rule is that a control the user cannot use is not shown. So the
 * list is filtered by `checkPermission(section, 'view')` — a Sales Executive
 * with no Expenses grant gets no Expense measures rather than a measure that
 * 403s the moment it is picked.
 *
 * ⚠️ This is a CONVENIENCE, not the enforcement. `/api/reports/run` checks the
 * same permissions itself; a spec posted directly is refused there. Never move
 * the check here and drop it there — that is a client-side permission check
 * wearing a server-side costume.
 */
export async function GET() {
  try {
    const user = await requireUser()

    // One permission read per section, not per measure.
    const allowed = new Map<PermSection, boolean>()
    const may = async (section: PermSection) => {
      const hit = allowed.get(section)
      if (hit !== undefined) return hit
      const ok = await checkPermission(user, section, 'view')
      allowed.set(section, ok)
      return ok
    }

    const measures: unknown[] = []
    for (const m of Object.values(MEASURES) as MeasureDef[]) {
      const source = SOURCE_DEFS[m.source]
      if (!(await may(source.section))) continue

      const dims: { key: string; label: string; sort: string }[] = []
      for (const d of dimensionsForSource(m.source)) {
        if (d.requiresSection && !(await may(d.requiresSection))) continue
        dims.push({ key: d.key, label: d.label, sort: d.sort })
      }

      measures.push({
        key: m.key,
        label: m.label,
        format: m.format,
        source: source.key,
        sourceLabel: source.label,
        section: source.section,
        dimensions: dims,
      })
    }

    const available = new Set(measures.map(m => (m as { key: string }).key))
    const usable = (spec: { measure: string }) => available.has(spec.measure)

    return NextResponse.json({
      measures,
      // A preset whose measure the user cannot see is dropped whole; one whose
      // companions are partly out of reach keeps the companions that are in it.
      presets: PRESETS.filter(p => usable(p.spec)).map(p => ({
        ...p,
        companions: (p.companions ?? []).filter(c => usable(c.spec)),
      })),
      headline: HEADLINE_SPECS.filter(h => usable(h.spec)),
      // §10 defaults, exposed so the UI can label the bands rather than
      // restating them and drifting.
      bands: { probability: PROBABILITY_BANDS, ageing: AGEING_BANDS },
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
