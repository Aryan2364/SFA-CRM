'use client'

import Link from 'next/link'
import { useMe } from '@/hooks/useMe'
import { mastersInGroup, type MasterGroup } from '@/lib/masters-registry'

/**
 * MEMBERSHIP COMES FROM THE REGISTRY; PRESENTATION STAYS HERE.
 *
 * Which masters exist, what they are called and where they live is
 * src/lib/masters-registry.ts. The card palette, the card icons and the
 * per-link glyphs are presentation and stay in this file — the registry's
 * `icon` field is a lucide name and this page draws heroicon paths, so lifting
 * the icons into it would have redrawn every icon on the page.
 *
 * The registry also fixes what this page used to get wrong: the literal that
 * stood here omitted dealers, distributors and institutions entirely.
 *
 * ⚠️ Only masters with a screen get a link. `distributors` and `institutions`
 * have live APIs and real permission keys but no page yet (P1-T18), so the
 * registry gives them `href: null` and they are filtered out here rather than
 * rendered as links to a 404. Their permission toggles do appear in Access
 * Control, because their APIs do check them.
 */

const LINK_ICONS: Record<string, React.ReactNode> = {
  states: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0zM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>,
  districts: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m4.5-18v18m4.5-18v18m4.5-18v18M6 6.75h.008v.008H6V6.75zm0 3.75h.008v.008H6v-.008zm0 3.75h.008v.008H6v-.008zm4.5-7.5h.008v.008H10.5V6.75zm0 3.75h.008v.008H10.5v-.008zm0 3.75h.008v.008H10.5v-.008zm4.5-7.5h.008v.008H15V6.75zm0 3.75h.008v.008H15v-.008zm0 3.75h.008v.008H15v-.008z" /></svg>,
  talukas: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" /></svg>,
  villages: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>,
  dealers: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72l1.189-1.19A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72M6.75 18h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .414.336.75.75.75z" /></svg>,
  product_categories: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>,
  product_subcategories: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>,
  products: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>,
  departments: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>,
  designations: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" /></svg>,
  expense_categories: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>,
  lead_types: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>,
  lead_stages: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" /></svg>,
  lead_temperatures: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" /></svg>,
}

type CardLink = { permKey: string; label: string; href: string; icon: React.ReactNode }

const USERS_LINK: CardLink = {
  // Users had the sidebar as its only route in until the shell's navigation
  // collapsed to nine entries (AGENTS.md 12.1). It is a child of Masters and is
  // reached from here. It is deliberately NOT in the registry: `users` is an
  // operation section with a data scope, not a master.
  permKey: 'users', label: 'Users', href: '/masters/users',
  icon: <svg className="size-icon-nav" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>,
}

type CardDef = {
  group: MasterGroup
  title: string
  subtitle: string
  color: string
  headerBg: string
  iconColor: string
  icon: React.ReactNode
  /** Links that are not masters. Rendered before the group's masters. */
  extraLinks?: CardLink[]
}

const CARDS: CardDef[] = [
  {
    group: 'locations',
    title: 'Locations',
    subtitle: 'Manage geographical hierarchy',
    color: 'border-blue-200 bg-blue-50/40',
    headerBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    ),
  },
  {
    group: 'lead_config',
    title: 'Lead Management',
    subtitle: 'Lead types, stages & temperatures',
    color: 'border-violet-200 bg-violet-50/40',
    headerBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    group: 'products',
    title: 'Products',
    subtitle: 'Product catalog management',
    color: 'border-purple-200 bg-purple-50/40',
    headerBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
      </svg>
    ),
  },
  {
    group: 'organisation',
    title: 'Organization',
    subtitle: 'Company structure setup',
    color: 'border-orange-200 bg-orange-50/40',
    headerBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
    extraLinks: [USERS_LINK],
  },
  {
    // New card. Dealers, distributors and institutions have had working APIs
    // and permission keys all along; the literal that used to stand in this
    // file simply never listed them, so there was no way to reach them (G10).
    // Appended last so the four existing cards keep their grid positions.
    group: 'business_partners',
    title: 'Business Partners',
    subtitle: 'Dealers, distributors & institutions',
    color: 'border-teal-200 bg-teal-50/40',
    headerBg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72l1.189-1.19A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72" />
      </svg>
    ),
  },
]

const SECTIONS = CARDS.map(card => ({
  ...card,
  links: [
    ...(card.extraLinks ?? []),
    ...mastersInGroup(card.group)
      .filter(m => m.href !== null)
      .map((m): CardLink => ({
        permKey: m.key,
        label: m.shortLabel ?? m.label,
        href: m.href as string,
        icon: LINK_ICONS[m.key],
      })),
  ],
}))

export default function MastersPage() {
  const me = useMe()
  const isAdmin = me?.role === 'Administrator'

  const visibleSections = SECTIONS.filter(s =>
    isAdmin || s.links.some(l => me?.permissions?.[l.permKey]?.view ?? false)
  )

  if (me && !isAdmin && visibleSections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <svg className="w-12 h-12 text-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <p className="text-text-muted font-medium">You don&apos;t have access to Master Data</p>
        <p className="text-sm text-text-muted mt-1">Contact your Administrator to request access.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-medium text-text-primary">Masters</h2>
        {(isAdmin || visibleSections.some(s => s.links.some(l => me?.permissions?.[l.permKey]?.edit))) && (
          <Link
            href="/masters/import"
            className="flex items-center gap-2 text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Import Data
          </Link>
        )}
      </div>
      <p className="text-text-muted mt-1 mb-8">Manage all master data from one place</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {visibleSections.map(section => (
          <div key={section.title} className={`rounded-2xl border overflow-hidden ${section.color}`}>
            <div className={`px-6 py-5 ${section.headerBg} flex items-center gap-4`}>
              <div className={`w-10 h-10 rounded-xl bg-surface/80 flex items-center justify-center ${section.iconColor}`}>
                {section.icon}
              </div>
              <div>
                <h3 className="font-medium text-text-primary">{section.title}</h3>
                <p className="text-sm text-text-muted">{section.subtitle}</p>
              </div>
            </div>
            <div className="px-3 py-2">
              {section.links
                .filter(link => isAdmin || (me?.permissions?.[link.permKey]?.view ?? false))
                .map(link => (
                <Link key={link.href} href={link.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface/80 hover:text-text-primary transition group"
                >
                  <span className="text-text-muted group-hover:text-text-secondary transition">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
