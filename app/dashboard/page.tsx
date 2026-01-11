'use client'

import { useAuth } from '@/lib/useAuth'
import { supabase } from '@/lib/supabase'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardRouter() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    if (!user) {
      router.push('/login')
      return
    }

    const routeByRole = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (data?.role === 'hospital') {
        router.push('/hospital')
      } else if (data?.role === 'operator') {
        router.push('/operator')
      } else {
        router.push('/login')
      }
    }

    routeByRole()
  }, [user, loading, router])

  return <p>Redirecting...</p>
}