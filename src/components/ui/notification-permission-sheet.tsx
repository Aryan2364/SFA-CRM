"use client"

import * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/sonner"
import { TextLink } from "@/components/ui/text-link"
import type { InstallPlatform } from "@/lib/install"
import { APP_NAME } from "@/lib/install-settings"
import { useLayout } from "@/lib/layout"
import { usePushPermission } from "@/lib/push"

/* ------------------------------------------------------------------
   Section 41.12 rule 4 and 41.16 rules 1 to 3 - asking to send phone
   notifications, and what personal settings says about them.

   NotificationPermissionSheet is the short sheet the app shows before the
   phone's own question: one line saying why, "Skip for now" and "Turn
   on". A screen opens it at the moment of use (useNotificationOffer in
   lib/push.ts) or from personal settings.

   PhoneNotificationsSetting is the block at the foot of the product's
   notification choices screen (41.18 rule 3): it says where phone
   notifications stand on this phone and offers the next step - the same
   sheet, how to allow them in the phone's settings after a no, or
   installing the app first on iPhone (41.12 rule 5).

   PHONE ONLY. Both render nothing on desktop: phone notifications are the
   phone's (41.12), and the computer has the bell panel (7.4). A screen
   used in both layouts can render them unconditionally.
   ------------------------------------------------------------------ */

/** The words, for a product whose screens are in another language (37.6). */
type NotificationPermissionText = {
  title: string
  /** The one line saying why (41.16 rule 2). */
  why: string
  /** The secondary, a close: the person's no on the app's sheet. */
  skip: string
  /** The primary: asks the phone's own question. */
  turnOn: string
  /** The primary's words while the phone asks and the phone subscribes (14 rule 2). */
  turningOn: string
  /** Past tense (37.4). */
  turnedOn: string
  /** Cause, then the next action (7.2 rule 2). */
  failed: string
  /** The phone said yes, but the product has no public key, so nothing was subscribed. */
  notSetUp: string
}

const TEXT: NotificationPermissionText = {
  title: "Notifications on this phone",
  why: "Get a notification when something needs you, such as an approval waiting for you.",
  // 37.2: each starts with a verb. Short, so the two share a 360px
  // footer without wrapping (stage 6 decision 9); the title and the line
  // above them say what is turned on.
  skip: "Skip for now",
  turnOn: "Turn on",
  turningOn: "Turning on",
  turnedOn: "Notifications turned on",
  failed: "Notifications could not be turned on. Check your connection and try again.",
  notSetUp: "Phone notifications are not set up for this app yet. You still see every notification in the app.",
}

/**
 * The app's own sheet before the phone's question (41.12 rule 4).
 *
 *   <NotificationPermissionSheet
 *     person={me.id}
 *     open={open}
 *     onOpenChange={setOpen}
 *     onSubscribe={(subscription) => api.savePushSubscription(subscription)}
 *   />
 *
 * A small dialog, so a bottom sheet on phone (41.8 rule 10) and the small
 * Phone only: it renders nothing on desktop. "Skip for now" on the left
 * as secondary (a DialogClose), "Turn on" on the right as the primary
 * (11.3 rule 7).
 *
 *   - "Turn on" asks the phone's own question at once, from the tap
 *     (iPhone refuses it from anywhere else). On a yes it subscribes this
 *     phone with the product's public key and hands the subscription to
 *     `onSubscribe`, which sends it to the backend; then "Notifications
 *     turned on" and the sheet closes. "Notifications turned on" is said
 *     only once there is a subscription: with no public key configured
 *     (the sheet is then never offered, but a product may open it), the
 *     sheet closes with an error toast saying they are not set up. On the phone's no,
 *     or when the person dismisses the phone's question, the sheet just
 *     closes: the phone's own answer is the phone's to keep, and personal
 *     settings explains what to do next.
 *   - When subscribing or `onSubscribe` fails, an error toast says so and
 *     the sheet stays open, so pressing again works (41.14 rule 7).
 *   - While the phone asks and subscribes, the primary shows "Turning on"
 *     and is disabled (14 rule 2), and the sheet does not close.
 *   - Closing it any other way - "Skip for now", a swipe down, the
 *     backdrop, Android back, Escape - without having pressed "Turn on"
 *     is the person's no on the app's sheet. It is
 *     remembered, and the app then offers it again only in personal
 *     settings.
 */
function NotificationPermissionSheet({
  person,
  open,
  onOpenChange,
  onOpenChangeComplete,
  onSubscribe,
  text,
}: {
  /** The signed-in person: their "Skip for now" is kept for them alone. */
  person: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs once it has finished opening or closing (Base UI's onOpenChangeComplete). */
  onOpenChangeComplete?: (open: boolean) => void
  /**
   * Sends the subscription to the product's backend, stored for this
   * person. Reject when it was not saved: the error toast shows and the
   * sheet stays open. Not called where no public key is configured.
   */
  onSubscribe?: (subscription: PushSubscriptionJSON) => Promise<void> | void
  text?: Partial<NotificationPermissionText>
}) {
  const t = { ...TEXT, ...text }
  const phone = useLayout().layout === "phone"
  const push = usePushPermission(person)
  const [busy, setBusy] = React.useState(false)
  // A second press in the same frame, before `busy` has rendered.
  const busyRef = React.useRef(false)
  // Pressed "Turn on" since this opening: closing is then not a no.
  const [pressed, setPressed] = React.useState(false)

  // Fresh every opening. Reset while rendering the open, not when closing.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setPressed(false)
  }

  const close = (next: boolean) => {
    if (next) {
      onOpenChange(true)
      return
    }
    if (busyRef.current) return
    if (!pressed) push.decline()
    onOpenChange(false)
  }

  const turnOn = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPressed(true)
    setBusy(true)
    let done = false
    try {
      // First, before any other await: the phone's question must come
      // straight from the tap.
      const answer = await push.ask()
      if (answer !== "granted") {
        // The phone's no, or its question dismissed: nothing to say here.
        done = true
        return
      }
      const subscription = await push.subscribe()
      if (!subscription) {
        // No public key: nothing was subscribed, so never "turned on".
        // Pressing again would not help, so the sheet closes.
        toast.error(t.notSetUp)
        done = true
        return
      }
      await onSubscribe?.(subscription)
      toast.success(t.turnedOn)
      done = true
    } catch {
      toast.error(t.failed)
    } finally {
      busyRef.current = false
      setBusy(false)
      if (done) onOpenChange(false)
    }
  }

  if (!phone) return null

  return (
    <Dialog open={open} onOpenChange={close} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.why}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />} disabled={busy}>
            {t.skip}
          </DialogClose>
          <Button loading={busy} loadingLabel={t.turningOn} onClick={() => void turnOn()}>
            {t.turnOn}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------
   Personal settings: where phone notifications stand on this phone.
   ------------------------------------------------------------------ */

type PhoneNotificationsText = {
  heading: string
  /** The product has not configured its public key (stage 6 decision 10). */
  notSetUp: string
  /** The button that opens the sheet again. */
  turnOn: string
  on: string
  off: string
  /** PORT NOTE: the kit has no way to turn them off again; see onTurnOff. */
  turnOff: string
  turningOff: string
  turnOffFailed: string
  /** An iPhone that has not installed the app (41.12 rule 5). */
  needsInstall: string
  installLink: string
  /** A phone or browser that cannot show notifications at all. */
  unsupported: string
  /** After the phone's no: how to allow them in the phone's settings (41.12 rule 4, 41.16 rule 3). */
  denied: (platform: InstallPlatform, installed: boolean, appName: string) => string
}

const SETTING_TEXT: PhoneNotificationsText = {
  heading: "Phone notifications",
  notSetUp: "Phone notifications are not set up for this app yet. You still see every notification in the app.",
  // Full width here, so the full action fits; it opens the sheet whose
  // primary reads "Turn on".
  turnOn: "Turn on notifications",
  on: "Phone notifications are on for this phone.",
  off: "Phone notifications are off. You still see every notification in the app.",
  turnOff: "Turn off on this phone",
  turningOff: "Turning off",
  turnOffFailed: "Notifications could not be turned off. Check your connection and try again.",
  needsInstall:
    "On iPhone, phone notifications work only once the app is on your home screen. Install it from More, then turn them on here.",
  installLink: "Install the app",
  unsupported: "This browser cannot show phone notifications. You still see every notification in the app.",
  denied: (platform, installed, appName) => {
    const start = "Notifications are blocked on this phone, and the app cannot ask again. To allow them, "
    // 41.16 rule 3: the other way, where there is one.
    const meanwhile = " Until then, you still see every notification in the app."
    if (platform === "ios") {
      return `${start}open your iPhone's Settings, then Notifications, then ${appName}, and turn on Allow Notifications.${meanwhile}`
    }
    if (platform === "android" && installed) {
      return `${start}open your phone's Settings, then Apps, then ${appName}, then Notifications, and turn them on.${meanwhile}`
    }
    return `${start}tap the icon at the left of the browser's address bar, open this site's settings, and allow Notifications.${meanwhile}`
  },
}

/**
 * The block at the foot of the notification choices screen (41.18 rule 3,
 * 41.12 rule 4). Phone only, like the screen it sits on: it renders
 * nothing on desktop.
 *
 *   <PhoneNotificationsSetting
 *     person={me.id}
 *     installHref="/more"
 *     onSubscribe={(subscription) => api.savePushSubscription(subscription)}
 *   />
 *
 * What it shows, from what the phone and the person have answered:
 *
 *   - Not known yet (server, hydrating): nothing, so it never shows one
 *     answer and then another.
 *   - The product has not configured its public key: phone notifications
 *     are not set up for this app yet, and nothing is offered.
 *   - An iPhone without the app installed: notifications need the app on
 *     the home screen (41.12 rule 5), with a link to More, where the
 *     install option lives (41.12 rule 8).
 *   - A browser that cannot show them: says so; the in-app list still has
 *     every notification.
 *   - The phone said no: the app cannot ask again, so the steps to allow
 *     them in the phone's settings, for this phone (41.12 rule 4).
 *   - Not asked yet, or "Skip for now" on the app's sheet: "Turn on
 *     notifications", which opens the same sheet - the one place the app
 *     offers it again after a "Skip for now".
 *   - The phone said yes: they are on.
 *
 * The button is secondary and full width: the screen's switches are its
 * content, and this is an offer the person has already been given once.
 */
function PhoneNotificationsSetting({
  person,
  appName = APP_NAME,
  installHref,
  onSubscribe,
  subscribed,
  onTurnOff,
  text,
  sheetText,
}: {
  person: string
  /**
   * PORT NOTE: the kit's block ends at "they are on" and reads the phone's
   * permission alone. A product with a plain on/off per phone needs two
   * more things, both optional here: `subscribed` (does THIS phone hold a
   * subscription; false with permission "granted" is "off" - permission
   * cannot be taken back by the app - and null is "not read yet", which
   * shows nothing), and `onTurnOff`, which renders "Turn off on this phone"
   * in the on state. Logged in docs/kit-audit/kit-gaps.md.
   */
  subscribed?: boolean | null
  onTurnOff?: () => Promise<void>
  /** The installed app's name, as the phone's settings list it. The install settings' name (41.12 rule 9) unless given. */
  appName?: string
  /** Where the install option is: More (41.12 rule 8). */
  installHref: string
  onSubscribe?: (subscription: PushSubscriptionJSON) => Promise<void> | void
  text?: Partial<PhoneNotificationsText>
  /** The sheet's words, as NotificationPermissionSheet takes them. */
  sheetText?: Partial<NotificationPermissionText>
}) {
  const t = { ...SETTING_TEXT, ...text }
  const phone = useLayout().layout === "phone"
  const push = usePushPermission(person)
  const [open, setOpen] = React.useState(false)
  const [turningOff, setTurningOff] = React.useState(false)
  const headingId = React.useId()

  if (!phone || !push.ready) return null
  if (push.configured && push.supported && push.permission === "granted" && subscribed === null) return null

  const turnOff = async () => {
    if (!onTurnOff || turningOff) return
    setTurningOff(true)
    try {
      await onTurnOff()
    } catch {
      toast.error(t.turnOffFailed)
    } finally {
      setTurningOff(false)
    }
  }

  let line: string
  let next: React.ReactNode = null
  if (!push.configured) {
    line = t.notSetUp
  } else if (push.needsInstall) {
    line = t.needsInstall
    next = (
      <TextLink href={installHref} render={<Link href={installHref} />}>
        {t.installLink}
      </TextLink>
    )
  } else if (!push.supported) {
    line = t.unsupported
  } else if (push.permission === "denied") {
    line = t.denied(push.platform, push.installed, appName)
  } else if (push.permission === "granted" && subscribed !== false) {
    line = t.on
    if (onTurnOff) {
      next = (
        <Button variant="secondary" className="w-full" loading={turningOff} loadingLabel={t.turningOff} onClick={() => void turnOff()}>
          {t.turnOff}
        </Button>
      )
    }
  } else {
    line = t.off
    next = (
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        {t.turnOn}
      </Button>
    )
  }

  return (
    <section data-slot="phone-notifications-setting" aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-card-heading font-medium text-text-primary">
        {t.heading}
      </h2>
      {/* An instruction, so body text, never text-muted (2.3). */}
      <p className="text-body text-text-primary">{line}</p>
      {next ? <div className="pt-2">{next}</div> : null}
      <NotificationPermissionSheet
        person={person}
        open={open}
        onOpenChange={setOpen}
        onSubscribe={onSubscribe}
        text={sheetText}
      />
    </section>
  )
}

export { NotificationPermissionSheet, PhoneNotificationsSetting }
export type { NotificationPermissionText, PhoneNotificationsText }
