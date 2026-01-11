'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/useAuth'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import LogoutButton from '@/components/LogoutButton'

export default function OperatorDashboard() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [myAmbulances, setMyAmbulances] = useState<any[]>([])
  const [closestAmbulances, setClosestAmbulances] = useState<any[]>([])
  const [selectedAmbulance, setSelectedAmbulance] = useState<any | null>(null)
  const [selectedHospital, setSelectedHospital] = useState<any | null>(null)
  const [hospitals, setHospitals] = useState<any[]>([])
  const [patientLocation, setPatientLocation] = useState({ lat: '', lng: '' })
  const [details, setDetails] = useState('')
  const [loadingTop, setLoadingTop] = useState(false)

  // 1️⃣ Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  // 2️⃣ Redirect if wrong role
  useEffect(() => {
    if (!user) return

    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.role !== 'operator') {
          router.push('/dashboard') // keeps central role-routing
        }
      })
  }, [user, router])

  // 3️⃣ Load operator's ambulances on mount
  useEffect(() => {
    if (!user) return

    supabase
      .from('ambulances')
      .select('*')
      .eq('operator_id', user.id)
      .then(({ data }) => setMyAmbulances(data || []))
  }, [user])

  // --- FUNCTION: Fetch top ambulances & hospitals ---
  const fetchTopHospitals = async () => {
    console.log('fetchTopHospitals called')
    if (!user) return
    setLoadingTop(true)

    const { lat, lng } = patientLocation
    console.log('Patient location:', lat, lng)
    if (!lat || !lng) {
      alert('Enter patient latitude and longitude')
      setLoadingTop(false)
      return
    }

    // 1️⃣ Closest 3 idle ambulances (RPC)
    const { data: closestAmbulances, error: ambErr } = await supabase.rpc('get_closest_ambulances', {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      limit_count: 3,
    })

    console.log('Ambulances:', closestAmbulances, ambErr)

    // 2️⃣ Top 3 hospitals (readiness + proximity) (RPC)
    const { data: topHospitals, error: hospErr } = await supabase.rpc('get_top_hospitals', {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      limit_count: 3,
    })

    console.log('Hospitals:', topHospitals, hospErr)

    setClosestAmbulances(closestAmbulances || [])
    setHospitals(topHospitals || [])
    setSelectedAmbulance(null)
    setSelectedHospital(null)
    setLoadingTop(false)
  }

  // --- FUNCTION: Assign ambulance to emergency ---
  const assignAmbulance = async (ambulanceId: string, hospital: any) => {
    if (!user) return

    const { lat, lng } = patientLocation
    if (!lat || !lng) {
      alert('Enter patient location')
      return
    }

    // --- 1️⃣ Fetch hospital location from Supabase ---
    type HospitalGeoJSON = {
      id: string
      name: string
      location: string // ST_AsGeoJSON(location) returns a string
    }

    const { data, error } = await supabase
      .rpc('get_hospital_geojson', { hospital_id: hospital.id })
      .single()

    if (error || !data) {
      alert('Hospital location not found')
      return
    }

    const hospitalData = data as HospitalGeoJSON

    if (!hospitalData.location) {
      alert('Hospital location is empty')
      return
    }

    // --- 2️⃣ Parse GeoJSON string ---
    const geo = JSON.parse(hospitalData.location) as {
      type: string
      coordinates: [number, number] // [lng, lat]
    }

    const hospitalLng = geo.coordinates[0]
    const hospitalLat = geo.coordinates[1]

    // --- 3️⃣ Get ETA from Geoapify ---
    const routingRes = await fetch(
      `https://api.geoapify.com/v1/routing?waypoints=${lat},${lng}|${hospitalLat},${hospitalLng}&mode=drive&apiKey=${process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY}`
    )
    const routingData = await routingRes.json()

    const etaSeconds = routingData.features?.[0]?.properties?.time ?? 0
    const etaMinutes = Math.ceil(etaSeconds / 60)

    // --- 4️⃣ Create emergency ---
    await supabase.from('emergencies').insert({
      patient_location: `SRID=4326;POINT(${lng} ${lat})`,
      details,
      ambulance_id: ambulanceId,
      hospital_id: hospital.id,
      eta_minutes: etaMinutes,
      status: 'en_route',
    })

    // --- 5️⃣ Update ambulance status ---
    await supabase
      .from('ambulances')
      .update({ status: 'on_call' })
      .eq('id', ambulanceId)

    alert(`Emergency created. ETA: ${etaMinutes} minutes`)
  }

  if (loading || !user) return <p>Loading...</p>

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1>🚑 Ambulance Operator Dashboard</h1>
      <LogoutButton />

      {/* =====================
          NEW EMERGENCY FORM
        ===================== */}
      <section style={{ marginTop: 24 }}>
        <h2>New Emergency</h2>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <input
            placeholder="Patient Latitude"
            value={patientLocation.lat}
            onChange={e =>
              setPatientLocation(p => ({ ...p, lat: e.target.value }))
            }
          />

          <input
            placeholder="Patient Longitude"
            value={patientLocation.lng}
            onChange={e =>
              setPatientLocation(p => ({ ...p, lng: e.target.value }))
            }
          />
        </div>

        <textarea
          placeholder="Emergency details (optional)"
          value={details}
          onChange={e => setDetails(e.target.value)}
          rows={3}
          style={{ width: '100%' }}
        />

        <button
          //onClick={fetchTopHospitals}
          onClick={() => {
            console.log('FIND CLICKED')
            fetchTopHospitals()
          }}
          disabled={loadingTop}
          style={{ marginTop: 12 }}
        >
          {loadingTop ? 'Finding…' : 'Find Closest Ambulances & Hospitals'}
        </button>
      </section>

      {/* =====================
          AMBULANCES LIST
        ===================== */}
      {closestAmbulances.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2>Closest Ambulances</h2>

          {closestAmbulances.map(a => (
            <div
              key={a.id}
              style={{
                border: selectedAmbulance?.id === a.id ? '2px solid green' : '1px solid #ccc',
                padding: 12,
                marginBottom: 8,
                cursor: 'pointer',
              }}
              onClick={() => setSelectedAmbulance(a)}
            >
              <p><strong>ID:</strong> {a.id}</p>
              <p><strong>Status:</strong> {a.status}</p>
              <p><strong>Distance:</strong> {a.distance_km?.toFixed(2)} km</p>
            </div>
          ))}
        </section>
      )}

      {/* =====================
          HOSPITALS LIST
        ===================== */}
      {hospitals.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2>Top Hospitals (Readiness + Proximity)</h2>

          {hospitals.map(h => (
            <div
              key={h.id}
              style={{
                border: selectedHospital?.id === h.id ? '2px solid blue' : '1px solid #ccc',
                padding: 12,
                marginBottom: 12,
                cursor: 'pointer',
              }}
              onClick={() => setSelectedHospital(h)}
            >
              <p><strong>Name:</strong> {h.name}</p>
              <p><strong>Readiness:</strong> {h.readiness_score}</p>
              <p><strong>Distance:</strong> {h.distance_km?.toFixed(2)} km</p>
            </div>
          ))}
        </section>
      )}

      {selectedAmbulance && selectedHospital && (
        <button
          style={{ marginTop: 24, padding: 12, fontSize: 16 }}
          onClick={() => assignAmbulance(selectedAmbulance.id, selectedHospital)}
        >
          🚨 Dispatch Ambulance
        </button>
      )}
    </div>
  )
}
