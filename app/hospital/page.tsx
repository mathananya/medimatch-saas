'use client'

import { useAuth } from '@/lib/useAuth'
import { supabase } from '@/lib/supabase'
import { calculateReadiness } from '@/lib/readiness'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LogoutButton from '@/components/LogoutButton'
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
} from 'recharts'

export default function HospitalDashboard() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [hospital, setHospital] = useState<any>(null)
  const [emergencies, setEmergencies] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [hospitalId, setHospitalId] = useState<string | null>(null)

  console.log('auth:', { user, loading })

  // Auth + role guard
  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  // Load hospital data
  useEffect(() => {
    if (!user) return

    const loadHospital = async () => {
      // 1. Get profile → organization_id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .single()

      if (profileError || !profile?.organization_id) {
        console.error('Profile error:', profileError)
        return
      }

      if (profile.role !== 'hospital') {
        router.push('/dashboard')
        return
      }

      const hid = profile.organization_id
      setHospitalId(hid)

      // 2. Load hospital
      const { data: hospitalData, error: hospitalError } = await supabase
        .from('hospitals')
        .select('*')
        .eq('id', hid)
        .single()

      if (hospitalError) {
        console.error('Hospital error:', hospitalError)
        return
      }

      setHospital(hospitalData)

      // 3. Load emergencies
      const { data: emergencyData } = await supabase
        .from('emergencies')
        .select('*')
        .eq('hospital_id', hid)
        .order('created_at', { ascending: false })

      setEmergencies(emergencyData || [])
    }

    loadHospital()
  }, [user, router])

  // Realtime emergencies subscription
  useEffect(() => {
    if (!hospitalId) return

    const channel = supabase.channel(`emergencies:${hospitalId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emergencies',
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload: RealtimePostgresInsertPayload<any>) => {
          setEmergencies(prev => [payload.new, ...prev])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [hospitalId])

  if (loading || !hospital || !hospitalId) return <p>Loading...</p>

  const updateHospital = async () => {
    setSaving(true)

    const readiness_score = calculateReadiness({
      free_ers: hospital.free_ers,
      icu_beds: hospital.icu_beds,
      physicians: hospital.physicians,
      specialists: hospital.specialists,
    })

    const { data, error } = await supabase
      .from('hospitals')
      .update({
        free_ers: hospital.free_ers,
        icu_beds: hospital.icu_beds,
        physicians: hospital.physicians,
        specialists: hospital.specialists,
        readiness_score,
        updated_at: new Date().toISOString(),
      })
      .eq('id', hospitalId)
      .select()
      .single()

    if (error) {
      console.error(error)
      alert('Failed to update readiness score')
    } else {
      // IMPORTANT: refresh local state
      setHospital(data)
    }

    setSaving(false)
  }

  const radarData = [
    { metric: 'ERs', value: hospital.free_ers },
    { metric: 'ICU', value: hospital.icu_beds },
    { metric: 'Physicians', value: hospital.physicians },
    { metric: 'Specialists', value: hospital.specialists },
  ]
  
  return (
    <div style={{ padding: 24 }}>
      <h1>Hospital Dashboard</h1>
      <LogoutButton />

      {/* Resource Update */}
      <h2>Resources</h2>
      {['free_ers', 'icu_beds', 'physicians', 'specialists'].map(field => (
        <div key={field}>
          <label>{field}</label>
          <input
            type="number"
            value={hospital[field]}
            onChange={e =>
              setHospital({ ...hospital, [field]: Number(e.target.value) })
            }
          />
        </div>
      ))}

      <button onClick={updateHospital} disabled={saving}>
        {saving ? 'Saving...' : 'Update Readiness'}
      </button>

      <p>
        Readiness Score:{' '}
        {hospital.readiness_score !== null
          ? hospital.readiness_score.toFixed(2)
          : '—'}
      </p>

      {/* Radar Chart */}
      <RadarChart width={300} height={300} data={radarData}>
        <PolarGrid />
        <PolarAngleAxis dataKey="metric" />
        <Radar dataKey="value" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.6} />
      </RadarChart>

      {/* Incoming Emergencies */}
      <h2>Incoming Emergencies</h2>

      {emergencies.length === 0 && <p>No active emergencies</p>}

      {emergencies.map(e => (
        <div key={e.id} style={{ border: '1px solid #ccc', padding: 8 }}>
          <p>{e.details}</p>
          <p>ETA: {e.eta_minutes} min</p>
          <p>Status: {e.status}</p>

          {e.status === 'arrived' && (
            <>
              <button
                onClick={() =>
                  supabase
                    .from('emergencies')
                    .update({ status: 'accepted' })
                    .eq('id', e.id)
                }
              >
                Accept
              </button>

              <button
                onClick={() =>
                  supabase
                    .from('emergencies')
                    .update({ status: 'rejected' })
                    .eq('id', e.id)
                }
              >
                Reject
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}