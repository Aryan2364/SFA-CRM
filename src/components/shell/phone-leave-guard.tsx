'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

/**
 * Shell-level registry for unsaved-changes guards on phone.
 *
 * A form below the tab root calls usePhoneFormGuard(changed) (ui/phone-form.tsx),
 * which registers a handler here while it is mounted. The shell's back arrow
 * and the tab bar then ask this registry before they navigate: a registered
 * handler that has unsaved changes opens its own "Leave without saving?"
 * dialog and reports that it took over, and the shell does not navigate.
 *
 * NO STATE ON PURPOSE. The registry is a ref-held Set behind a context whose
 * value never changes, so registering a guard re-renders nothing. (A previous
 * version of the phone shell froze because an effect set context state that
 * it also depended on.) Handlers read their own latest `changed` through refs,
 * so they are registered once per mount and never re-registered.
 */
export type LeaveHandler = (href: string) => boolean

type Registry = {
  register: (handler: LeaveHandler) => () => void
  /** True when a guard opened its dialog; the caller must then not navigate. */
  intercept: (href: string) => boolean
}

function createRegistry(): Registry {
  const handlers = new Set<LeaveHandler>()
  return {
    register(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    intercept(href) {
      // ONE ASKS: the first guard with unsaved changes asks; the rest stay quiet.
      for (const handler of Array.from(handlers)) {
        if (handler(href)) return true
      }
      return false
    },
  }
}

const PhoneLeaveGuardContext = React.createContext<Registry | null>(null)

export function PhoneLeaveGuardProvider({ children }: { children: React.ReactNode }) {
  const registry = React.useRef<Registry | null>(null)
  if (!registry.current) registry.current = createRegistry()
  return React.createElement(PhoneLeaveGuardContext.Provider, { value: registry.current }, children)
}

/** Registers `handler` (which may change identity every render) for this mount. */
export function useRegisterLeaveGuard(handler: LeaveHandler) {
  const registry = React.useContext(PhoneLeaveGuardContext)
  const latest = React.useRef(handler)
  React.useEffect(() => {
    latest.current = handler
  })
  React.useEffect(() => {
    if (!registry) return
    return registry.register(href => latest.current(href))
  }, [registry])
}

/** For the shell: navigate to `href`, unless a form guard asks first. */
export function useGuardedNavigate() {
  const registry = React.useContext(PhoneLeaveGuardContext)
  const router = useRouter()
  return React.useCallback(
    (href: string) => {
      if (registry?.intercept(href)) return
      router.push(href)
    },
    [registry, router]
  )
}

/** For a Link's onClick: returns true when the click was taken over by a guard. */
export function useInterceptLeave() {
  const registry = React.useContext(PhoneLeaveGuardContext)
  return React.useCallback((href: string) => registry?.intercept(href) ?? false, [registry])
}
