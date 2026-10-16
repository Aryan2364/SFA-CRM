'use client'

import * as React from 'react'
import { MapPinIcon, MessageCircleIcon, PhoneIcon, CopyIcon } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '@/components/ui/sheet'
import { useToast } from '@/contexts/ToastContext'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.16 rule 17: tapping a
 * phone number or address opens a bottom sheet of what the phone can do
 * with it, rather than guessing one action (dialling is not always what
 * the person wants).
 *
 * Usage:
 *
 *   const [open, setOpen] = React.useState(false)
 *   <button onClick={() => setOpen(true)}>{contact.phone}</button>
 *   <PhoneContactActionsSheet
 *     open={open}
 *     onOpenChange={setOpen}
 *     phone={contact.phone}
 *   />
 *
 *   <PhoneContactActionsSheet
 *     open={open}
 *     onOpenChange={setOpen}
 *     address="12 MG Road, Pune"
 *   />
 *
 * Exactly one of `phone` / `address` is expected per sheet — pass two
 * separate triggers (and two sheets) for a row that shows both.
 */
export function PhoneContactActionsSheet({
  open,
  onOpenChange,
  phone,
  address,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  phone?: string
  address?: string
}) {
  const { toast } = useToast()

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast('Copied', 'success')
    } catch {
      toast('Could not copy', 'error')
    }
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{phone ?? address}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1 p-2 pb-[calc(var(--safe-bottom)+8px)]">
          {phone ? (
            <>
              <ContactActionRow
                icon={<PhoneIcon aria-hidden className="size-5" />}
                label="Call"
                render={<a href={`tel:${phone}`} />}
                onClick={() => onOpenChange(false)}
              />
              <ContactActionRow
                icon={<MessageCircleIcon aria-hidden className="size-5" />}
                label="WhatsApp"
                render={<a href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" />}
                onClick={() => onOpenChange(false)}
              />
              <ContactActionRow
                icon={<CopyIcon aria-hidden className="size-5" />}
                label="Copy number"
                onClick={() => copy(phone)}
              />
            </>
          ) : null}
          {address ? (
            <>
              <ContactActionRow
                icon={<MapPinIcon aria-hidden className="size-5" />}
                label="Directions"
                render={
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
                onClick={() => onOpenChange(false)}
              />
              <ContactActionRow
                icon={<CopyIcon aria-hidden className="size-5" />}
                label="Copy address"
                onClick={() => copy(address)}
              />
            </>
          ) : null}
        </div>
        <SheetClose className="sr-only">Close</SheetClose>
      </SheetContent>
    </Sheet>
  )
}

function ContactActionRow({
  icon,
  label,
  onClick,
  render,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  render?: React.ReactElement
}) {
  const className =
    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-body font-medium text-text-primary active:bg-surface-control'

  if (render) {
    return React.cloneElement(render, { className, onClick }, icon, label)
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}
