'use client'

import { useState, useEffect } from 'react'

export type SectionPerm = { view: boolean; edit: boolean; delete: boolean }
export type MePermissions = Record<string, SectionPerm>

export type Me = {
  /** Already on the wire from /api/auth/me; typed here so screens that
   *  separate "my rows" from "my team's rows" do not re-fetch it. */
  userId: string
  name: string
  phone: string
  role: string
  tenantName: string
  hasSubordinates: boolean
  permissions: MePermissions
}

let _cache: Me | null = null

export function invalidateMeCache() {
  _cache = null
}

export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(_cache)
  useEffect(() => {
    if (_cache) return
    fetch('/api/auth/me')
      .then(async r => {
        if (r.status === 401) {
          await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
          window.location.href = '/login'
          return
        }
        const d: Me = await r.json()
        _cache = d
        setMe(d)
      })
      .catch(() => {})
  }, [])
  return me
}
