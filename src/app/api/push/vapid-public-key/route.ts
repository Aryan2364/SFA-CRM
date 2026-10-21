import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** The public half of the VAPID key pair, for the phone's subscribe call. null = push not configured. */
export async function GET() {
  await requireUser()
  return NextResponse.json({ key: process.env.VAPID_PUBLIC_KEY?.trim() || null })
}
