import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage, dbErrorResult, dateOnlyString } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds } from '@/lib/scope'
import { recomputeCompanyCompleteness } from '@/lib/completeness'
import { writeAccountKind } from '@/lib/account-kind'
import { checkEmail, checkGstin, checkMobile, checkPincode, normaliseGstin, trimmed } from '@/lib/validation'
import {
  NO_USABLE_ROWS, cell, checkFile, countVerdicts, importMode, rowNumber,
  type ImportResponse, type RawRow, type RowVerdict,
} from '@/lib/bulk-import'
import { COMPANY_COLUMNS } from './_columns'

const TEMPERATURES = ['Cold', 'Warm', 'Hot']
const KINDS = ['Company', 'Individual']
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

type Ready = {
  verdict: RowVerdict
  data: {
    name: string
    type: string
    // §10: parsed and validated, but not yet written anywhere — see the
    // header note by `KINDS` above and the import-result message below.
    kind: string | null
    stage: string
    contact_person_name: string | null
    mobile_1: string | null
    mobile_2: string | null
    email: string | null
    gst_number: string | null
    pincode: string | null
    address: string | null
    description: string | null
    state_id: string | null
    district_id: string | null
    taluka_id: string | null
    temperature: string | null
    next_follow_up_date: Date | null
  }
}

/** A real calendar date written `YYYY-MM-DD`, or null. `Date.parse` accepts
 *  junk ("2026-02-31", "1 2 3"), so the round trip is the check. */
function isoDate(v: string): Date | null {
  const m = ISO_DATE.exec(v)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return dateOnlyString(d) === v ? d : null
}

/**
 * Good rows are imported; bad rows are skipped and reported.
 *
 * `mode: 'validate'` returns one verdict per row and writes nothing. `commit`
 * (the default) re-validates from scratch and inserts only the rows that pass.
 * Both answer with the shared `ImportResponse`; a file with bad rows is a 200.
 *
 * Every error on a row is reported, not the first, so one pass fixes it.
 *
 * Duplicates:
 *  - a row whose GST Number or a mobile matches a company already in THIS
 *    tenant is skipped as `existing`, "Already exists (matches …)". The name is
 *    shown only when that company is inside the importer's own `companies`
 *    scope; otherwise the row still skips, without naming a company the
 *    importer could not open.
 *  - a row with neither a GST Number nor a mobile has nothing else to match
 *    on, so it is matched by name (trimmed, any case) the same way. Without
 *    this, every re-upload of the file — the advice after a timed-out import —
 *    would create those companies again.
 *  - a later row repeating an earlier good row's GST Number or mobile is an
 *    error, "Duplicate of row N". The first occurrence is kept. A row with
 *    neither is a duplicate of an earlier good row with the same name.
 *
 * Inserts stay one per row: `recomputeCompanyCompleteness` runs per company,
 * and a database failure on one row costs that row, not the file.
 *
 * Every id written comes from a tenant-scoped lookup below, never from the
 * body, so no body-sourced foreign key reaches an insert.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  // 'create', not 'edit' — this route only ever inserts (P1-T10.3).
  if (!await checkPermission(user, 'companies', 'create')) return forbidden()

  const body = await req.json().catch(() => null) as
    { rows?: unknown; companies?: unknown; leads?: unknown; mode?: unknown } | null
  const mode = importMode(body)
  // `rows` is the shared importer key. `companies` and `leads` are what the
  // Parties and Leads screens posted before it; both are still read.
  const file = checkFile(body?.rows ?? body?.companies ?? body?.leads, COMPANY_COLUMNS)
  if (!file.ok) return NextResponse.json(file.body, { status: 400 })
  const col = file.match.mapping
  const labels = COMPANY_COLUMNS.map(c => c.label)

  const tid = getTenantId()

  // ── 1. READ + VALIDATE EVERY ROW (in memory, after one batch of lookups) ──
  const raw = file.rows
    .map((r, i) => ({ r, row: rowNumber(r, i), v: (label: string) => cell(r, col[label]) }))
    // A line blank in every mapped column is not a row.
    .filter(x => labels.some(l => x.v(l) !== ''))
  if (raw.length === 0) return NextResponse.json({ error: NO_USABLE_ROWS }, { status: 400 })

  const gstins  = [...new Set(raw.map(x => normaliseGstin(x.v('GST Number'))).filter((g): g is string => !!g))]
  const mobiles = [...new Set(raw.flatMap(x => [x.v('Mobile 1'), x.v('Mobile 2')]).filter(Boolean))]
  /** Rows with no GST Number and no mobile: matched by name instead. */
  const unkeyed = (v: (label: string) => string) => !v('GST Number') && !v('Mobile 1') && !v('Mobile 2')
  const names = [...new Set(raw.filter(x => unkeyed(x.v)).map(x => x.v('Name')).filter(Boolean))]

  let lookups
  try {
    lookups = await Promise.all([
      prisma.states.findMany({ where: { tenant_id: tid }, select: { id: true, name: true } }),
      prisma.districts.findMany({ where: { tenant_id: tid }, select: { id: true, name: true, state_id: true } }),
      prisma.talukas.findMany({ where: { tenant_id: tid }, select: { id: true, name: true, district_id: true } }),
      prisma.company_types.findMany({ where: { tenant_id: tid }, select: { name: true } }),
      prisma.deal_stages.findMany({ where: { tenant_id: tid }, select: { name: true } }),
      gstins.length || mobiles.length
        ? prisma.companies.findMany({
            where: {
              tenant_id: tid,
              OR: [
                // Case-insensitive: a GSTIN stored before every write path upper-cased
                // it must still count as a match.
                ...(gstins.length ? [{ gst_number: { in: gstins, mode: 'insensitive' as const } }] : []),
                ...(mobiles.length ? [{ mobile_1: { in: mobiles } }, { mobile_2: { in: mobiles } }] : []),
              ],
            },
            select: { name: true, gst_number: true, mobile_1: true, mobile_2: true, owner_user_id: true },
          })
        : Promise.resolve([]),
      names.length
        ? prisma.companies.findMany({
            where: { tenant_id: tid, name: { in: names, mode: 'insensitive' as const } },
            select: { name: true, owner_user_id: true },
          })
        : Promise.resolve([]),
      scopedUserIds(user, 'companies'),
    ])
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error: `The file could not be checked. ${error}` }, { status })
  }
  const [states, districts, talukas, companyTypes, dealStages, matches, nameMatches, visibleOwners] = lookups

  // Districts and talukas are keyed by (parent id, name), never by name alone:
  // district names repeat across states (Aurangabad, Hamirpur, Bilaspur), and a
  // name-only map silently keeps whichever row came last. The location master
  // importer keys the same way.
  const stateMap  = new Map(states.map(r => [r.name.toLowerCase(), r.id]))
  const distMap   = new Map(districts.map(r => [`${r.state_id}|${r.name.toLowerCase()}`, r.id]))
  const talukaMap = new Map(talukas.map(r => [`${r.district_id}|${r.name.toLowerCase()}`, r.id]))
  // Name-only indexes, used only when the parent column is blank: a name that
  // is unique in the tenant resolves (with its parent derived from it), and a
  // name that repeats is a row error rather than a guess.
  const byName = <T extends { name: string }>(list: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of list) {
      const k = r.name.toLowerCase()
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return m
  }
  const distsByName   = byName(districts)
  const talukasByName = byName(talukas)
  const districtById  = new Map(districts.map(r => [r.id, r]))
  const stateNameById = new Map(states.map(r => [r.id, r.name]))
  // Stored in the master's own spelling, whatever case the sheet used.
  const typeByLower  = new Map(companyTypes.map(r => [r.name.toLowerCase(), r.name]))
  const stageByLower = new Map(dealStages.map(r => [r.name.toLowerCase(), r.name]))

  const described = (m: { name: string; owner_user_id: string | null }) =>
    visibleOwners === null || (m.owner_user_id !== null && visibleOwners.includes(m.owner_user_id))
      ? m.name : 'a company you cannot open'
  const existingByGstin  = new Map<string, string>()
  const existingByMobile = new Map<string, string>()
  for (const m of matches) {
    const g = normaliseGstin(m.gst_number)
    if (g && !existingByGstin.has(g)) existingByGstin.set(g, described(m))
    for (const mob of [trimmed(m.mobile_1), trimmed(m.mobile_2)]) {
      if (mob && !existingByMobile.has(mob)) existingByMobile.set(mob, described(m))
    }
  }
  const nameKey = (n: string) => n.trim().toLowerCase()
  const existingByName = new Map<string, string>()
  for (const m of nameMatches) {
    const k = nameKey(m.name)
    if (!existingByName.has(k)) existingByName.set(k, described(m))
  }
  type Place = { state_id: string | null; district_id: string | null; taluka_id: string | null }
  /**
   * Geo ids, each resolved under the one above it. A location that is filled
   * in but does not resolve is a row error, exactly as an unknown Type is.
   * Only the first location problem is reported: a State that is not found
   * makes every District under it unresolvable too.
   *
   * A blank parent is derived from its child when the child's name is unique
   * (within the filled-in State, if any); a name that repeats is a row error.
   */
  const resolvePlace = (stateName: string, distName: string, talukaName: string): Place | { problem: [string, string] } => {
    let stateId: string | null = null
    let districtId: string | null = null
    let talukaId: string | null = null
    if (stateName) {
      stateId = stateMap.get(stateName.toLowerCase()) ?? null
      if (!stateId) return { problem: ['State', `State "${stateName}" is not in the States master`] }
    }
    if (distName) {
      if (stateId) {
        districtId = distMap.get(`${stateId}|${distName.toLowerCase()}`) ?? null
        if (!districtId) return { problem: ['District', `District "${distName}" is not in ${stateName}`] }
      } else {
        const hits = distsByName.get(distName.toLowerCase()) ?? []
        if (hits.length === 0) return { problem: ['District', `District "${distName}" is not in the Districts master`] }
        if (hits.length > 1) return { problem: ['State', `District "${distName}" exists in more than one state; fill in the State column`] }
        districtId = hits[0].id
        stateId = hits[0].state_id
      }
    }
    if (talukaName) {
      if (districtId) {
        talukaId = talukaMap.get(`${districtId}|${talukaName.toLowerCase()}`) ?? null
        if (!talukaId) {
          const where = stateName || (stateId ? stateNameById.get(stateId) : '')
          return { problem: ['Taluka', `Taluka "${talukaName}" is not in ${distName}${where ? `, ${where}` : ''}`] }
        }
      } else {
        const hits = (talukasByName.get(talukaName.toLowerCase()) ?? [])
          .filter(t => !stateId || districtById.get(t.district_id)?.state_id === stateId)
        if (hits.length === 0) return { problem: ['Taluka', `Taluka "${talukaName}" is not in ${stateName || 'the Talukas master'}`] }
        if (hits.length > 1) return { problem: ['District', `Taluka "${talukaName}" exists in more than one district; fill in the District column`] }
        talukaId = hits[0].id
        districtId = hits[0].district_id
        stateId = districtById.get(districtId)?.state_id ?? stateId
      }
    }
    return { state_id: stateId, district_id: districtId, taluka_id: talukaId }
  }

  /** First good row in the file carrying each GSTIN / mobile. */
  const fileGstin  = new Map<string, number>()
  const fileMobile = new Map<string, number>()
  /** First good row in the file with each name (any row, keyed or not). */
  const fileName   = new Map<string, number>()

  const verdicts: RowVerdict[] = []
  const ready: Ready[] = []

  for (const { row, v } of raw) {
    const verdict: RowVerdict = { row, status: 'skipped', issues: [] }
    verdicts.push(verdict)
    const error = (column: string | undefined, message: string) => verdict.issues.push({ column, severity: 'error', message })
    const check = (column: string, message: string | null) => { if (message) error(column, message) }

    const name = v('Name')
    if (!name) error('Name', 'Name is blank; every company needs one')

    // Company Type is NOT compulsory (REBUILD-PLAN.md:126) — a blank column is
    // accepted. A value that is not in the master is still an error: it is a
    // typo, not a blank.
    const typeText = v('Type')
    const type = typeText ? typeByLower.get(typeText.toLowerCase()) : ''
    if (type === undefined) error('Type', `Company type "${typeText}" is not in the Company Types master`)

    // §10: Company / Individual, blank = Company. Importing an Individual's
    // own contact is a later stage (see the result message below) — this row
    // still imports as an account, just with no Kind stored until the
    // account_kind column exists (see `kind` in `Ready['data']` above).
    const kindText = v('Kind')
    const kind = kindText ? KINDS.find(k => k.toLowerCase() === kindText.toLowerCase()) : 'Company'
    if (kind === undefined) error('Kind', `Kind "${kindText}" must be Company or Individual`)

    check('Mobile 1', checkMobile(v('Mobile 1'), 'Mobile 1'))
    check('Mobile 2', checkMobile(v('Mobile 2'), 'Mobile 2'))
    check('Pin Code', checkPincode(v('Pin Code')))
    check('GST Number', checkGstin(v('GST Number')) && 'GST Number is not a valid 15-character GSTIN')
    check('Email', checkEmail(v('Email')))

    const stageText = v('Stage')
    const stage = stageText ? stageByLower.get(stageText.toLowerCase()) : 'Prospect'
    if (stage === undefined) error('Stage', `Stage "${stageText}" is not in the Opportunity Stages master`)

    const tempText = v('Temperature')
    const temperature = tempText ? TEMPERATURES.find(t => t.toLowerCase() === tempText.toLowerCase()) : null
    if (temperature === undefined) error('Temperature', `Temperature "${tempText}" must be Cold, Warm or Hot`)

    const dateText = v('Next Follow-up Date')
    const followUp = dateText ? isoDate(dateText) : null
    if (dateText && !followUp) error('Next Follow-up Date', `Next Follow-up Date "${dateText}" must be a real date written YYYY-MM-DD, like 2026-05-01`)

    // Resolve geo ids, each under the one above it. A location that is filled
    // in but does not resolve is a row error, exactly as an unknown Type is.
    // Only the first location problem is reported: a State that is not found
    // makes every District under it unresolvable too.
    const place = resolvePlace(v('State'), v('District'), v('Taluka'))
    if ('problem' in place) error(place.problem[0], place.problem[1])

    if (verdict.issues.length > 0) continue

    // ── Duplicates: the tenant first, then earlier rows of this file ───────
    const gstin = normaliseGstin(v('GST Number'))
    const rowMobiles = [...new Set([v('Mobile 1'), v('Mobile 2')].filter(Boolean))]
    const mobileColumn = (m: string) => (m === v('Mobile 1') ? 'Mobile 1' : 'Mobile 2')
    let existingHit: [string, string] | null = gstin && existingByGstin.has(gstin)
      ? ['GST Number', existingByGstin.get(gstin)!] : null
    for (const m of rowMobiles) {
      if (!existingHit && existingByMobile.has(m)) existingHit = [mobileColumn(m), existingByMobile.get(m)!]
    }
    const byNameOnly = unkeyed(v)
    if (!existingHit && byNameOnly && existingByName.has(nameKey(name))) existingHit = ['Name', existingByName.get(nameKey(name))!]
    if (existingHit) {
      verdict.status = 'existing'
      verdict.issues.push({ column: existingHit[0], severity: 'warning', message: `Already exists (matches ${existingHit[1]})` })
      continue
    }
    const dupGstin = gstin ? fileGstin.get(gstin) : undefined
    if (dupGstin !== undefined) error('GST Number', `Duplicate of row ${dupGstin} (same GST Number)`)
    for (const m of rowMobiles) {
      const dup = fileMobile.get(m)
      if (dup !== undefined) error(mobileColumn(m), `Duplicate of row ${dup} (same mobile ${m})`)
    }
    const dupName = byNameOnly ? fileName.get(nameKey(name)) : undefined
    if (dupName !== undefined) error('Name', `Duplicate of row ${dupName} (same name; this row has no GST Number or mobile to tell them apart)`)
    if (verdict.issues.length > 0) continue
    if (gstin) fileGstin.set(gstin, row)
    for (const m of rowMobiles) fileMobile.set(m, row)
    if (!fileName.has(nameKey(name))) fileName.set(nameKey(name), row)

    verdict.status = 'ready'
    ready.push({
      verdict,
      data: {
        name,
        // NOT NULL with no default — blank is the empty string. See
        // POST /api/companies for why.
        type: type ?? '',
        kind: kind ?? 'Company',
        stage: stage ?? 'Prospect',
        contact_person_name: trimmed(v('Contact Person')),
        mobile_1: trimmed(v('Mobile 1')),
        mobile_2: trimmed(v('Mobile 2')),
        email: trimmed(v('Email')),
        gst_number: gstin,
        pincode: trimmed(v('Pin Code')),
        address: trimmed(v('Address')),
        description: trimmed(v('Description')),
        ...(place as Place),
        temperature: temperature ?? null,
        // next_follow_up_date is @db.Date.
        next_follow_up_date: followUp,
      },
    })
  }

  // ── 2. WRITE (commit only) ────────────────────────────────────────────────
  // `account_kind` is not a database column yet (src/lib/account-kind.ts,
  // guarded raw SQL, lands separately) — `kind` is stripped from every row
  // before the insert, and this count is reported once below instead.
  let individualsImported = 0
  if (mode === 'commit') {
    for (const { verdict, data } of ready) {
      const { kind, ...columns } = data
      if (kind === 'Individual') individualsImported++
      try {
        const created = await prisma.companies.create({
          data: {
            tenant_id: tid,
            ...columns,
            // The file has no owner column, so every row is the importer's, as
            // a company created by hand is. Unowned rows sit outside every
            // Self/Team scope, where the importer could not reach them again.
            owner_user_id: user.userId || null,
            created_by_user_id: user.userId || null,
          },
          select: { id: true },
        })
        verdict.status = 'created'
        // account_kind column may not exist yet — writeAccountKind() answers
        // `false` rather than throwing, and the import still succeeds either
        // way (src/lib/account-kind.ts header).
        if (kind === 'Individual') await writeAccountKind(tid, created.id, 'Individual').catch(() => false)
        // Derived, never imported (P1-T10.7). An imported company has no
        // company_addresses row yet, so this always writes the incomplete
        // state — the spreadsheet has no address columns that map to one.
        // The company exists whether or not this lands, so a failure here is
        // a warning on a created row, never a "skipped" that is not true.
        await recomputeCompanyCompleteness(created.id, tid).catch(err => {
          verdict.issues.push({ severity: 'warning', message: `Imported, but its completeness was not worked out (${dbErrorMessage(err)}); it updates on the next edit` })
        })
      } catch (err) {
        verdict.status = 'skipped'
        verdict.issues.push({ severity: 'error', message: `Not imported: ${dbErrorMessage(err)}` })
      }
    }
  }

  const out: ImportResponse & { message?: string } = {
    mode,
    total: verdicts.length,
    counts: countVerdicts(verdicts),
    rows: verdicts,
    unrecognisedColumns: file.match.unrecognised,
  }
  if (mode === 'validate') return NextResponse.json(out)
  // §10: an Individual row imports as an account with no Self contact — that
  // is a later stage. Said once here rather than per row, since every row
  // with Kind=Individual gets exactly the same note.
  if (individualsImported > 0) {
    out.message = `${individualsImported} individual account${individualsImported === 1 ? '' : 's'} imported without a Self contact — add the person from the account page.`
  }
  // `inserted` / `errors` are what the upload dialog read before the shared
  // shape existed; kept until every caller reads `counts` and `rows`.
  return NextResponse.json({
    ...out,
    inserted: out.counts.created,
    errors: verdicts
      .filter(r => r.status === 'skipped')
      .map(r => ({ row: r.row, message: r.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ') })),
  })
}
