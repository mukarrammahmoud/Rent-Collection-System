'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

interface Persona {
  id: string
  email: string
  name: string
  role: 'manager' | 'staff' | 'tenant'
  org: 'Northwind Properties' | 'Beta Realty'
  leaseId?: string
}

const PERSONAS: Persona[] = [
  // Northwind Properties
  {
    id: '10000000-0000-0000-0000-000000000001',
    email: 'manager@northwind.test',
    name: 'NW Manager',
    role: 'manager',
    org: 'Northwind Properties',
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    email: 'staff@northwind.test',
    name: 'NW Staff',
    role: 'staff',
    org: 'Northwind Properties',
  },
  {
    id: '10000000-0000-0000-0000-000000000003',
    email: 'aisyah@northwind.test',
    name: 'Aisyah (A-12-3)',
    role: 'tenant',
    org: 'Northwind Properties',
    leaseId: '50000000-0000-0000-0000-000000000001',
  },
  {
    id: '10000000-0000-0000-0000-000000000004',
    email: 'ben@northwind.test',
    name: 'Ben (B-05-1)',
    role: 'tenant',
    org: 'Northwind Properties',
    leaseId: '50000000-0000-0000-0000-000000000002',
  },
  {
    id: '10000000-0000-0000-0000-000000000005',
    email: 'probe@northwind.test',
    name: 'Probe (C-01-7)',
    role: 'tenant',
    org: 'Northwind Properties',
    leaseId: '50000000-0000-0000-0000-000000000003',
  },
  // Beta Realty
  {
    id: '20000000-0000-0000-0000-000000000001',
    email: 'manager@beta.test',
    name: 'Beta Manager',
    role: 'manager',
    org: 'Beta Realty',
  },
  {
    id: '20000000-0000-0000-0000-000000000002',
    email: 'chen@beta.test',
    name: 'Chen (KL-1)',
    role: 'tenant',
    org: 'Beta Realty',
    leaseId: '50000000-0000-0000-0000-000000000004',
  },
]

export function PersonaSwitcher() {
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      setCurrentEmail(data?.user?.email ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentEmail(session?.user?.email ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const handleSwitchPersona = async (email: string) => {
    setLoadingEmail(email)
    const supabase = createSupabaseBrowserClient()
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: 'Password123!',
      })
      if (error) {
        alert(`Failed to sign in as ${email}: ${error.message}`)
        setLoadingEmail(null)
      } else {
        // Full page reload so server components and cookies refresh synchronously
        window.location.reload()
      }
    } catch (err) {
      console.error('Sign-in error:', err)
      setLoadingEmail(null)
    }
  }

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    window.location.reload()
  }

  const currentPersona = PERSONAS.find((p) => p.email === currentEmail)

  return (
    <aside
      aria-label="Fast Persona Switcher"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: '#090d16',
        color: '#f1f5f9',
        borderBottom: '1px solid #1e293b',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        fontSize: '0.8125rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0.5rem 1rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        {/* Left: Persona Switcher Badge & Active User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontSize: '0.7rem',
              color: '#38bdf8',
              background: 'rgba(56, 189, 248, 0.1)',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}
          >
            <span>⚡ Persona Switcher</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#94a3b8' }}>Active:</span>
            {currentEmail ? (
              <span
                style={{
                  color: '#4ade80',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#4ade80',
                    display: 'inline-block',
                  }}
                />
                {currentPersona?.name || currentEmail} ({currentPersona?.role || 'user'})
              </span>
            ) : (
              <span style={{ color: '#f87171' }}>Not logged in</span>
            )}
          </div>
        </div>

        {/* Right: Quick Switch Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: 'transparent',
              border: '1px solid #334155',
              color: '#94a3b8',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.75rem',
            }}
          >
            {isExpanded ? 'Hide Personas' : 'Show Personas (7)'}
          </button>

          {currentEmail && (
            <button
              onClick={handleSignOut}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#f87171',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.75rem',
              }}
            >
              Sign Out
            </button>
          )}
        </div>
      </div>

      {/* Persona Pill Buttons Drawer */}
      {isExpanded && (
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            padding: '0.25rem 1rem 0.6rem',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.375rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          {PERSONAS.map((persona) => {
            const isActive = currentEmail === persona.email
            const isLoading = loadingEmail === persona.email

            let roleColor = '#38bdf8' // tenant
            if (persona.role === 'manager') roleColor = '#f59e0b'
            if (persona.role === 'staff') roleColor = '#a855f7'

            return (
              <button
                key={persona.email}
                disabled={isLoading}
                onClick={() => handleSwitchPersona(persona.email)}
                title={`Switch to ${persona.email} (${persona.role} @ ${persona.org})`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.25rem 0.625rem',
                  borderRadius: '6px',
                  border: isActive
                    ? '1px solid #4ade80'
                    : '1px solid #334155',
                  background: isActive
                    ? 'rgba(74, 222, 128, 0.15)'
                    : isLoading
                      ? '#1e293b'
                      : '#131b2e',
                  color: isActive ? '#f0fdf4' : '#cbd5e1',
                  cursor: isLoading ? 'wait' : 'pointer',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.75rem',
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: roleColor,
                    display: 'inline-block',
                  }}
                />
                <span>{persona.name}</span>
                {isActive && (
                  <span
                    style={{
                      fontSize: '0.65rem',
                      background: '#16a34a',
                      color: '#fff',
                      padding: '1px 4px',
                      borderRadius: '3px',
                    }}
                  >
                    Active
                  </span>
                )}
                {isLoading && <span>⏳</span>}
              </button>
            )
          })}
        </div>
      )}
    </aside>
  )
}
