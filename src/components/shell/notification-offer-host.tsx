'use client'

import * as React from 'react'

import { useMe } from '@/hooks/useMe'
import { useNotificationOffer } from '@/lib/push'
import { saveSubscription } from '@/lib/push-device'
import { NotificationPermissionSheet } from '@/components/ui/notification-permission-sheet'
import { whenLayersSettled } from '@/components/ui/sheet'

/**
 * Phone foundation - FRONTEND_RULES_PHONE.md 41.12 rule 4: ask for
 * notifications at a useful moment, never on first open.
 *
 * A screen that has just done something the person will want to hear back
 * about calls requestNotificationOffer() (a plain function, nothing to
 * mount, safe on desktop where it does nothing):
 *
 *   - after the weekly plan is submitted (the manager's decision comes back),
 *   - after a remark is sent (the reply comes back),
 *   - after a next meeting or follow-up is saved (the reminder comes back).
 *
 * The phone shell mounts this host once. It asks the kit's
 * useNotificationOffer, which says yes ONCE per person and only where the
 * server has a key, the phone can show notifications and has not been
 * asked or declined; a yes opens the kit's short sheet, once whatever
 * dialog the person just saved from has finished closing. A "Skip for now"
 * is remembered, and the offer is then only in /notifications.
 */

const EVENT = 'rgb-notification-offer'

export function requestNotificationOffer() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function NotificationOfferHost() {
  const me = useMe()
  const person = me?.userId ?? ''
  const shouldOffer = useNotificationOffer(person)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    if (!person) return
    let alive = true
    const onRequest = () => {
      // Decided now (the answer is spent when it is asked), shown when the
      // dialog that was just saved has gone.
      if (!shouldOffer()) return
      void whenLayersSettled().then(() => {
        if (alive) window.setTimeout(() => alive && setOpen(true), 300)
      })
    }
    window.addEventListener(EVENT, onRequest)
    return () => {
      alive = false
      window.removeEventListener(EVENT, onRequest)
    }
  }, [person, shouldOffer])

  if (!person) return null
  return (
    <NotificationPermissionSheet
      person={person}
      open={open}
      onOpenChange={setOpen}
      onSubscribe={subscription => saveSubscription(person, subscription)}
    />
  )
}
