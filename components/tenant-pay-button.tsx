'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

interface TenantPayButtonProps {
  leaseId: string
  outstandingSen: string
  isAllowed?: boolean
  assignedTenantName?: string
}

export function TenantPayButton({
  leaseId,
  outstandingSen,
  isAllowed = true,
  assignedTenantName,
}: TenantPayButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const outstandingNumber = Number(outstandingSen)
  const hasBalance = outstandingNumber > 0

  const handlePay = async () => {
    if (!isAllowed || !hasBalance) return
    setLoading(true)
    setErrorMsg(null)

    try {
      const supabase = createSupabaseBrowserClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch(`/api/leases/${leaseId}/gateway-bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 404) {
          setErrorMsg(
            'Tenant isolation: This lease is assigned to a different tenant or organization. Please switch to the assigned tenant persona in the top bar to pay.',
          )
        } else if (res.status === 403) {
          setErrorMsg(
            'Only the tenant assigned to this lease can initiate online gateway payments. Please switch to the tenant persona in the top bar.',
          )
        } else if (res.status === 401) {
          setErrorMsg('You must be logged in to pay online. Please select the tenant persona above.')
        } else {
          setErrorMsg(data.error || 'Failed to initiate gateway payment.')
        }
        setLoading(false)
        return
      }

      // Successful bill creation — redirect to simulated gateway return
      const billId = data.billId
      router.push(`/payments/return?bill_id=${billId}&paid=true`)
    } catch (err: unknown) {
      console.error('Payment initiation error:', err)
      const message = err instanceof Error ? err.message : 'Network error initiating payment'
      setErrorMsg(message)
      setLoading(false)
    }
  }

  const ringgitFormatted = `RM ${(outstandingNumber / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  if (!isAllowed) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          disabled
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-xs bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700"
          title={`Only the assigned tenant (${assignedTenantName || 'tenant'}) can pay online`}
        >
          <span>🔒</span>
          <span>Pay Online ({ringgitFormatted})</span>
        </button>
        <span className="text-[11px] text-amber-600 dark:text-amber-400">
          Only assigned tenant ({assignedTenantName || 'tenant'}) can pay online. Switch persona above.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={handlePay}
        disabled={loading || !hasBalance}
        className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-sm ${
          hasBalance
            ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer hover:shadow-md'
            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
        }`}
      >
        {loading ? (
          <>
            <span className="animate-spin text-base">⏳</span>
            <span>Connecting to Payment Gateway...</span>
          </>
        ) : hasBalance ? (
          <>
            <span>💳</span>
            <span>Pay Online via Gateway ({ringgitFormatted})</span>
          </>
        ) : (
          <span>✓ All Invoices Settled</span>
        )}
      </button>

      {errorMsg && (
        <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 rounded-md p-2 mt-1 max-w-md">
          {errorMsg}
        </div>
      )}
    </div>
  )
}
