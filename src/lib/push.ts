"use client"

import * as React from "react"

import { detectPlatform, isInstalledApp, onInstalledAppChange, type InstallPlatform } from "@/lib/install"
import { useLayout } from "@/lib/layout"

/**
 * Section 41.12 rules 2 to 5 - phone notifications, the phone's side.
 *
 *   const push = usePushPermission(me.id)
 *   push.configured     // the product has set its public key; false: never offered
 *   push.supported      // this phone can show them (iPhone: only once installed)
 *   push.needsInstall   // an iPhone that has not installed the app yet
 *   push.permission     // "default" | "granted" | "denied" | "unsupported"
 *   push.appDeclined    // said "Skip for now" on the app's own sheet
 *   await push.ask()    // the phone's own question
 *   await push.subscribe()  // the subscription to send to the backend
 *
 *   // After the first thing the person would want to hear back about:
 *   const offerNotifications = useNotificationOffer(me.id)
 *   if (offerNotifications()) setSheetOpen(true)
 *
 * WHEN TO ASK (41.12 rule 4, 41.16 rules 1 and 2). Never on first open.
 * The first time the person does something they would want to hear back
 * about (submitting for approval, raising a request), the screen calls
 * the offer from useNotificationOffer. It answers true ONCE per person,
 * and only on phone, only where the product has configured its public
 * key, only where the phone can show notifications, only while the phone
 * has not been asked, and only if the person has not already said no on
 * the app's own sheet. The screen then opens
 * NotificationPermissionSheet, which says why in one line and, on "Turn
 * on", asks the phone's own question.
 *
 *   - A no on the app's own sheet (appDeclined) is remembered for that
 *     person in this browser: the app never offers it again by itself,
 *     only from personal settings (NotificationPermissionSheet's
 *     PhoneNotificationsSetting).
 *   - A no to the phone's own question ("denied") cannot be asked again
 *     by any web page. Personal settings then explains how to allow
 *     notifications in the phone's settings.
 *
 * IPHONE (41.12 rule 5). A web app on iPhone can show notifications only
 * once it is installed on the home screen (display-mode standalone).
 * Before that, `supported` is false and `needsInstall` true, so personal
 * settings says the app must be installed first, from More.
 *
 * NOT CONFIGURED (stage 6 decision 10). Where the product has not set its
 * public VAPID key (NEXT_PUBLIC_VAPID_PUBLIC_KEY is empty), nothing can be
 * subscribed, so the offer is never made and personal settings says phone
 * notifications are not set up for this app yet (`configured` false).
 *
 * WHAT THIS FILE DOES NOT DO: send. Sending needs the product's private
 * VAPID key and a sending library on its backend (web-push, a new
 * package; not part of this kit). The backend stores the subscription
 * that subscribe() returns, per person, and sends { title, body, url,
 * tag } to it; public/sw-push.js shows it and opens `url` on a tap.
 *
 * STORAGE. The person's "Skip for now" and whether they were offered it live
 * in localStorage, one entry per person (`push|<person>`), read and
 * written in try/catch: storage that fails reads as "not declined, not
 * offered", and a write that fails is skipped. Never shared between
 * people on one phone.
 *
 * DEVICE DETECTION. The installed check and the platform are
 * lib/install.ts's (isInstalledApp, detectPlatform: section 4 rule 2), so
 * the install option and notifications always agree, in one vocabulary:
 * "ios", "android" or "other".
 */

/** The phone's answer, or "unsupported" where it cannot show notifications at all. */
type PushPermission = "default" | "granted" | "denied" | "unsupported"

type PushDevice = {
  /** False on the server and while hydrating: nothing is known yet (26.1's reasoning). */
  ready: boolean
  /** The product has configured its public VAPID key. False: phone notifications are not set up, and never offered. */
  configured: boolean
  /** The phone can show notifications here: Notification, a service worker and PushManager, and on iPhone only once installed. */
  supported: boolean
  /** An iPhone or iPad with the app not installed: notifications need it on the home screen first (41.12 rule 5). */
  needsInstall: boolean
  /** Opened from the home screen (lib/install.ts's isInstalledApp). */
  installed: boolean
  /** Which phone's settings to describe after a no (personal settings). */
  platform: InstallPlatform
  permission: PushPermission
}

type PushChoice = {
  /** The person said no on the app's own sheet; offered again only in personal settings. */
  appDeclined: boolean
  /** The app has offered it once already at a moment of use (useNotificationOffer). */
  offered: boolean
}

type PushPermissionState = PushDevice &
  PushChoice & {
    /** Asks the phone's own question (Notification.requestPermission). Call it straight from a tap. */
    ask: () => Promise<PushPermission>
    /**
     * Subscribes this phone with the product's public VAPID key
     * (NEXT_PUBLIC_VAPID_PUBLIC_KEY, the one key the offer and personal
     * settings also read), and returns the subscription the product sends
     * to its backend. Returns the existing subscription when there is one,
     * so it can be called at every sign-in where permission is granted.
     * null where no key is configured (with a console warning in
     * development) or the phone cannot show notifications. Throws when the
     * subscription failed or took longer than 10 seconds (14 rule 4).
     */
    subscribe: () => Promise<PushSubscriptionJSON | null>
    /** Records the person's no on the app's own sheet. */
    decline: () => void
  }

/**
 * The product's public VAPID key, set at build time. Its private half
 * stays on the backend and never reaches the browser.
 */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

/** Phone notifications are set up for this app: the product configured its public key. */
const PUSH_CONFIGURED = VAPID_PUBLIC_KEY !== ""

/** 14 rule 4: the deadline for waiting on the service worker and the push service. */
const PUSH_DEADLINE_MS = 10_000

/* ------------------------------------------------------------------
   The device: what this phone can do, and what it has answered.
   ------------------------------------------------------------------ */

const SERVER_DEVICE: PushDevice = Object.freeze({
  ready: false,
  configured: PUSH_CONFIGURED,
  supported: false,
  needsInstall: false,
  installed: false,
  platform: "other",
  permission: "unsupported",
})

function hasPushApis(): boolean {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
}

function measureDevice(): Omit<PushDevice, "ready" | "configured"> {
  const platform = detectPlatform()
  const installed = isInstalledApp()
  const needsInstall = platform === "ios" && !installed
  const supported = hasPushApis() && !needsInstall
  const permission: PushPermission = supported ? Notification.permission : "unsupported"
  return { supported, needsInstall, installed, platform, permission }
}

let device: PushDevice | null = null

/** One snapshot object per answer, kept until the answer changes (useSyncExternalStore compares by reference). */
function deviceSnapshot(): PushDevice {
  const next = measureDevice()
  if (
    device &&
    device.supported === next.supported &&
    device.needsInstall === next.needsInstall &&
    device.installed === next.installed &&
    device.platform === next.platform &&
    device.permission === next.permission
  ) {
    return device
  }
  device = { ready: true, configured: PUSH_CONFIGURED, ...next }
  return device
}

const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

/*
 * The phone's answer changes outside the page: in the phone's settings,
 * or in the browser's site settings. The page learns of it when it is
 * shown again (visibilitychange), where the browser reports permission
 * changes (navigator.permissions), and when it is installed or opened
 * from the home screen (display-mode).
 */
let detach: (() => void) | null = null

function attach() {
  const onVisible = () => {
    if (document.visibilityState === "visible") notify()
  }
  document.addEventListener("visibilitychange", onVisible)
  const stopWatchingInstall = onInstalledAppChange(notify)

  let status: PermissionStatus | null = null
  let gone = false
  try {
    navigator.permissions
      ?.query({ name: "notifications" as PermissionName })
      .then((s) => {
        if (gone) return
        status = s
        s.addEventListener("change", notify)
      })
      .catch(() => undefined)
  } catch {
    // A browser that cannot query this permission: the other signals stand.
  }

  return () => {
    gone = true
    document.removeEventListener("visibilitychange", onVisible)
    stopWatchingInstall()
    status?.removeEventListener("change", notify)
  }
}

/* ------------------------------------------------------------------
   The person's choice on the app's own sheet, per person.
   ------------------------------------------------------------------ */

const PREFIX = "push|"

type Stored = { v: 1; declined: boolean; offered: boolean }

const NO_CHOICE: PushChoice = Object.freeze({ appDeclined: false, offered: false })

// Encoded, as drafts and recent records are, so no person's key can be another's prefix.
function keyFor(person: string): string {
  return `${PREFIX}${encodeURIComponent(person)}`
}

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readRaw(person: string): string | null {
  try {
    return store()?.getItem(keyFor(person)) ?? null
  } catch {
    return null
  }
}

function parse(raw: string | null): PushChoice {
  if (!raw) return NO_CHOICE
  try {
    const value = JSON.parse(raw) as Partial<Stored>
    if (value?.v !== 1) return NO_CHOICE
    return { appDeclined: value.declined === true, offered: value.offered === true }
  } catch {
    return NO_CHOICE
  }
}

function write(person: string, change: Partial<PushChoice>) {
  const s = store()
  if (!s) return
  const before = parse(readRaw(person))
  const next: Stored = {
    v: 1,
    declined: change.appDeclined ?? before.appDeclined,
    offered: change.offered ?? before.offered,
  }
  try {
    s.setItem(keyFor(person), JSON.stringify(next))
  } catch {
    // Private browsing or a full quota: the choice simply is not kept.
    return
  }
  notify()
}

const choices = new Map<string, { raw: string | null; choice: PushChoice }>()

function choiceSnapshot(person: string): PushChoice {
  const raw = readRaw(person)
  const last = choices.get(person)
  if (last && last.raw === raw) return last.choice
  const choice = parse(raw)
  choices.set(person, { raw, choice })
  return choice
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!detach) detach = attach()
  const onStorage = (event: StorageEvent) => {
    // null: the whole storage was cleared.
    if (event.key === null || event.key.startsWith(PREFIX)) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
    if (listeners.size === 0 && detach) {
      detach()
      detach = null
    }
  }
}

/* ------------------------------------------------------------------
   Asking and subscribing.
   ------------------------------------------------------------------ */

function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  let timer = 0
  const deadline = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${what} took longer than ${PUSH_DEADLINE_MS / 1000} seconds.`)), PUSH_DEADLINE_MS)
  })
  return Promise.race([work, deadline]).finally(() => window.clearTimeout(timer))
}

/** The phone's own question. Call it straight from a tap: iPhone refuses it otherwise. */
async function askPermission(): Promise<PushPermission> {
  if (!measureDevice().supported) return "unsupported"
  try {
    const answer = await Notification.requestPermission()
    return answer
  } finally {
    notify()
  }
}

/** The VAPID public key (URL-safe base64) as the bytes PushManager expects. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false
  const left = new Uint8Array(a)
  return left.every((byte, i) => byte === b[i])
}

async function subscribePush(): Promise<PushSubscriptionJSON | null> {
  if (!measureDevice().supported || Notification.permission !== "granted") return null
  if (!PUSH_CONFIGURED) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "lib/push.ts: no public VAPID key is configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY), so this phone was not subscribed and cannot receive phone notifications."
      )
    }
    return null
  }
  // The service worker (public/sw.js, which imports public/sw-push.js)
  // receives the notifications; subscribing waits for it to be running.
  const registration = await withDeadline(navigator.serviceWorker.ready, "Starting the service worker")
  const key = keyBytes(VAPID_PUBLIC_KEY)
  const existing = await withDeadline(registration.pushManager.getSubscription(), "Reading the subscription")
  if (existing) {
    if (sameKey(existing.options.applicationServerKey, key)) return existing.toJSON()
    // The product changed its key: the old subscription can no longer be
    // sent to, and the push service refuses a second key on top of it.
    await withDeadline(existing.unsubscribe(), "Removing the old subscription")
  }
  const created = await withDeadline(
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
    "Subscribing to notifications"
  )
  return created.toJSON()
}

/**
 * Removes this phone's subscription, and returns its endpoint so the
 * product can delete it on its backend too. Call it on sign out, before
 * the session ends: otherwise the next person to sign in on this phone
 * would receive the last person's notifications. Never throws; null when
 * there was nothing to remove, or when the phone did not finish within
 * 10 seconds (14 rule 4: sign out never waits on it for longer).
 */
async function unsubscribePush(): Promise<string | null> {
  try {
    if (!hasPushApis()) return null
    return await withDeadline(
      (async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        const existing = await registration?.pushManager.getSubscription()
        if (!existing) return null
        const endpoint = existing.endpoint
        await existing.unsubscribe()
        return endpoint
      })(),
      "Removing the notification subscription"
    )
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------
   The hooks.
   ------------------------------------------------------------------ */

/**
 * What this phone can do about notifications, what it has answered, and
 * what this person said on the app's own sheet; with ask, subscribe and
 * decline. Nothing is known on the server or while hydrating (`ready`
 * false, `permission` "unsupported"): show nothing that depends on it
 * until `ready`.
 */
function usePushPermission(person: string): PushPermissionState {
  const dev = React.useSyncExternalStore(subscribe, deviceSnapshot, () => SERVER_DEVICE)
  const getChoice = React.useCallback(() => choiceSnapshot(person), [person])
  const choice = React.useSyncExternalStore(subscribe, getChoice, () => NO_CHOICE)
  const decline = React.useCallback(() => write(person, { appDeclined: true, offered: true }), [person])
  return React.useMemo(
    () => ({ ...dev, ...choice, ask: askPermission, subscribe: subscribePush, decline }),
    [dev, choice, decline]
  )
}

/**
 * The moment of use (41.12 rule 4). Returns a function a screen calls
 * after the person has done something they would want to hear back
 * about. It answers true once per person - then the screen opens
 * NotificationPermissionSheet - and false ever after, and always false:
 *
 *   - on desktop (41.12 is the phone's; the bell panel is the computer's);
 *   - where the product has not configured its public key (nothing could
 *     be subscribed, so "turned on" would be untrue);
 *   - where the phone cannot show notifications (an iPhone not installed);
 *   - once the phone has answered ("granted" or "denied");
 *   - once the person said no on the app's own sheet.
 *
 * It reads everything at the moment it is called, so the screen needs no
 * render for it, and never on first open: nothing calls it until the
 * person has acted.
 */
function useNotificationOffer(person: string): () => boolean {
  const phone = useLayout().layout === "phone"
  return React.useCallback(() => {
    if (!phone || !PUSH_CONFIGURED) return false
    const now = measureDevice()
    if (!now.supported || now.permission !== "default") return false
    const choice = parse(readRaw(person))
    if (choice.appDeclined || choice.offered) return false
    write(person, { offered: true })
    return true
  }, [person, phone])
}

export { usePushPermission, useNotificationOffer, unsubscribePush, VAPID_PUBLIC_KEY }
export type { PushPermission, PushPermissionState }
