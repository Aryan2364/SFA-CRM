'use client'

import * as React from 'react'
import { CheckIcon, InfoIcon, LayoutListIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { MetaPreset, MetaPresetSpec } from '@/components/reports/types'
import { cn } from '@/lib/utils'

/**
 * REBUILD-PLAN.md §7.4, P5-T4 — THE TEN READY-MADE REPORTS.
 *
 * "Pre-configured combinations that open with settings already filled, so a
 * user who does not want to build anything still gets value on day one."
 *
 * ---------------------------------------------------------------------------
 * NOT TEN PAGES. NOT EVEN TEN CODE PATHS.
 *
 * Every entry below is a `ReportSpec` literal from `src/lib/reports/presets.ts`
 * that arrives over `/api/reports/meta`, and picking one does exactly one
 * thing: it writes the builder's measure, dimensions and filters. The builder
 * then runs it the way it runs anything else, and the person is left standing
 * in front of an editable report rather than a dead end — change the date
 * range, swap a dimension, save it, all of it still works.
 *
 * ⚠️ NOTHING IS LISTED HERE. `meta` has already dropped any preset whose
 * measure this person's permissions do not reach, so a Sales Executive with no
 * Expenses grant never sees "Expense versus Order Value" offered and then
 * refused.
 *
 * ⚠️ §7.6's monitoring reports — Attendance, Location Flag, Working Hours
 * Utilisation — are NOT in the registry's list and must not be added to it.
 * They remain buildable in two clicks; what they must not be is featured.
 * "Leading with them makes the sales team see the software as a spying tool,
 * and adoption dies."
 *
 * ---------------------------------------------------------------------------
 * A `gap` IS SHOWN, NOT SWALLOWED.
 *
 * Where §7.4 asked a report for something the registry cannot express — a
 * conversion rate, the age order of the ageing bands — the preset carries a
 * sentence saying so and it is rendered right under the name. The number that
 * is missing is worth less than the person knowing it is missing.
 */

export type PresetPick = {
  spec: MetaPresetSpec
  /** The preset the spec came from — what the header then names. */
  preset: MetaPreset
  /** Set when the spec is one of the preset's companions rather than its main one. */
  companion?: string
}

/** True when two specs are the same report. Used only to mark the open one. */
function sameSpec(a: MetaPresetSpec, b: MetaPresetSpec): boolean {
  return (
    a.measure === b.measure &&
    a.dimensions.length === b.dimensions.length &&
    a.dimensions.every((d, i) => d === b.dimensions[i]) &&
    JSON.stringify(a.filters ?? {}) === JSON.stringify(b.filters ?? {})
  )
}

/**
 * Which preset (and which of its parts) the builder is currently showing, or
 * `null` when the person has built something of their own.
 *
 * Derived by comparing specs rather than remembered in state, so editing a
 * dimension after opening a preset drops the "open" mark by itself — there is
 * no stale flag that can claim a report is "Pipeline Summary" after it has
 * been changed into something else.
 */
export function matchPreset(
  presets: MetaPreset[],
  current: MetaPresetSpec
): PresetPick | null {
  for (const preset of presets) {
    if (sameSpec(preset.spec, current)) return { spec: preset.spec, preset }
    for (const companion of preset.companions ?? []) {
      if (sameSpec(companion.spec, current)) {
        return { spec: companion.spec, preset, companion: companion.name }
      }
    }
  }
  return null
}

export function ReportPresets({
  presets,
  active,
  onPick,
}: {
  presets: MetaPreset[]
  active: PresetPick | null
  onPick: (pick: PresetPick) => void
}) {
  const [open, setOpen] = React.useState(false)

  if (presets.length === 0) return null

  function pick(pick: PresetPick) {
    setOpen(false)
    onPick(pick)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="secondary" size="sm" className="min-h-11 gap-1.5 sm:min-h-0">
            <LayoutListIcon aria-hidden="true" className="size-4" />
            <span className="max-w-40 truncate">
              {active ? active.preset.name : 'Ready-made'}
            </span>
            {!active && (
              <span className="rounded-full bg-surface-sunken px-1.5 text-meta text-text-secondary">
                {presets.length}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        // Wide enough for a name and a sentence, and never wider than a phone.
        className="w-[min(26rem,calc(100vw-2rem))] gap-2 p-2"
      >
        <p className="px-2 pt-1 text-meta text-text-secondary">
          These open with everything filled in. Change anything afterwards —
          they are ordinary reports, not separate screens.
        </p>
        <ul className="flex max-h-[min(28rem,60vh)] flex-col gap-0.5 overflow-y-auto">
          {presets.map(preset => {
            const isActive = active?.preset.key === preset.key
            return (
              <li key={preset.key} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => pick({ spec: preset.spec, preset })}
                  className={cn(
                    'flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-sunken',
                    isActive && !active?.companion && 'bg-primary-subtle'
                  )}
                >
                  <span className="flex items-center gap-1.5 text-label font-medium text-text-primary">
                    {isActive && !active?.companion && (
                      <CheckIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-primary-pressed"
                      />
                    )}
                    <span className="truncate">{preset.name}</span>
                  </span>
                  <span className="text-meta text-text-secondary">{preset.description}</span>
                  {preset.gap && (
                    <span className="mt-0.5 flex items-start gap-1.5 text-meta text-text-secondary">
                      <InfoIcon
                        aria-hidden="true"
                        className="mt-0.5 size-3 shrink-0 text-warning"
                      />
                      <span>{preset.gap}</span>
                    </span>
                  )}
                </button>

                {/* A report §7.4 describes as several numbers is several runs of
                    the engine, because a run reads one measure from one source.
                    They are offered here rather than hidden, so "meetings done"
                    beside "order value" is one click and not a rebuild. */}
                {(preset.companions?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
                    <span className="text-meta text-text-muted">Also:</span>
                    {preset.companions!.map(companion => {
                      const companionActive =
                        isActive && active?.companion === companion.name
                      return (
                        <button
                          key={companion.name}
                          type="button"
                          onClick={() => pick({ spec: companion.spec, preset, companion: companion.name })}
                          className={cn(
                            'min-h-8 rounded-md border border-border-light px-2 text-meta transition-colors hover:bg-surface-sunken',
                            companionActive
                              ? 'bg-primary-subtle text-primary-pressed'
                              : 'text-text-secondary'
                          )}
                        >
                          {companion.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
