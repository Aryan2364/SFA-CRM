'use client'

import Link from 'next/link'
import { ShieldCheckIcon, SlidersHorizontalIcon, TrophyIcon } from 'lucide-react'

import { canReachAccessControl } from '@/components/shell/nav'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe, type Me } from '@/hooks/useMe'

/**
 * The Settings index.
 *
 * This page exists because the shell's navigation carries one Settings
 * entry rather than one entry per settings screen (AGENTS.md section
 * 12.1's seven-item ceiling). Access Control and Points Config had the
 * sidebar as their only route in; without this they would be reachable
 * only by typing the URL.
 *
 * It is deliberately the smallest thing that keeps both reachable.
 * Section 11.5's settings template - a vertical section menu on the left
 * with cards on the right - is `components/templates` work and is not
 * built yet; when it is, this page is one of the screens that adopts it.
 *
 * Each card is gated the way its own server routes are (section 26:
 * never show a control that fails after being clicked).
 */

const SETTINGS = [
  {
    href: '/settings/access-control',
    icon: ShieldCheckIcon,
    title: 'Access Control',
    description:
      'Who reports to whom, and which records each role may see.',
    visible: (me: Me | null) => (me ? canReachAccessControl(me) : false),
  },
  {
    href: '/settings/points',
    icon: TrophyIcon,
    title: 'Points Config',
    description: 'What each activity is worth on the leaderboard.',
    visible: (me: Me | null) => me?.permissions?.points_config?.view ?? false,
  },
  {
    href: '/settings/system',
    icon: SlidersHorizontalIcon,
    title: 'System Settings',
    description:
      'Auto check-out, the meeting location flag, and deal stage ageing.',
    visible: (me: Me | null) => me?.permissions?.system_settings?.view ?? false,
  },
]

export default function SettingsPage() {
  const me = useMe()
  const cards = SETTINGS.filter(card => card.visible(me))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page-title font-medium text-text-primary">
          Settings
        </h1>
        <p className="mt-1 text-label text-text-secondary">
          Configuration for the whole organisation.
        </p>
      </div>

      {/* Section 14: the shape of what is coming, not a blank area and
          not a spinner. Which cards this user gets is not known until
          /api/auth/me answers. */}
      {me === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group/card flex items-start gap-3 rounded-xl border border-border-light bg-surface p-4 transition-colors outline-none hover:border-border hover:bg-surface-control active:bg-surface-control-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
            >
              <span
                aria-hidden
                className="flex size-control shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary"
              >
                <Icon className="size-icon-nav" />
              </span>
              <span className="min-w-0">
                <span className="block text-card-heading font-medium text-text-primary">
                  {card.title}
                </span>
                <span className="mt-1 block text-label text-text-secondary">
                  {card.description}
                </span>
              </span>
            </Link>
          )
        })}
      </div>
      )}
    </div>
  )
}
