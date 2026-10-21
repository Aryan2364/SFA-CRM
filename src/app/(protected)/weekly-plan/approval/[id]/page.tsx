'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { PhonePlanReview } from '../phone-plan-review'

/**
 * One plan under review, on a screen of its own: the phone's form of the
 * desktop approval panel (FRONTEND_RULES_PHONE 41.6). The desktop keeps the
 * panel inside the queue, so a desktop visit to this address lands on the
 * queue, where every plan opens in that panel.
 */
export default function PlanReviewPage() {
  const { layout } = useLayout()
  const router = useRouter()
  const params = useParams()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/weekly-plan/approval')
  }, [layout, router])

  if (layout !== 'phone') return null
  return <PhonePlanReview planId={String(params.id)} />
}
