'use client'

import { useState } from 'react'

interface PaymentActionsProps {
  paymentId: string
  status: string
}

export function PaymentActions({ paymentId, status }: PaymentActionsProps) {
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleApprove = async () => {
    if (!confirm('Are you sure you want to approve this payment? Funds will be allocated across outstanding invoices.')) {
      return
    }
    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch(`/api/payments/${paymentId}/approve`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to approve payment')
        setLoading(false)
      } else {
        window.location.reload()
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error approving payment')
      setLoading(false)
    }
  }

  const handleReject = async () => {
    const reason = prompt('Please enter the reason for rejection (minimum 5 characters):')
    if (reason === null) return
    if (reason.trim().length < 5) {
      alert('Rejection reason must be at least 5 characters.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch(`/api/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to reject payment')
        setLoading(false)
      } else {
        window.location.reload()
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error rejecting payment')
      setLoading(false)
    }
  }

  const handleVoid = async () => {
    const reason = prompt('Please enter the reason for voiding this payment (minimum 5 characters):')
    if (reason === null) return
    if (reason.trim().length < 5) {
      alert('Void reason must be at least 5 characters.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch(`/api/payments/${paymentId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to void payment')
        setLoading(false)
      } else {
        window.location.reload()
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error voiding payment')
      setLoading(false)
    }
  }

  if (status === 'rejected' || status === 'voided') {
    return <span className="text-[11px] text-slate-400 italic">No actions</span>
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="inline-flex items-center gap-1.5">
        {status === 'pending_verification' && (
          <>
            <button
              onClick={handleApprove}
              disabled={loading}
              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={handleReject}
              disabled={loading}
              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}

        {status === 'approved' && (
          <button
            onClick={handleVoid}
            disabled={loading}
            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-700 hover:bg-slate-800 text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Void
          </button>
        )}
      </div>

      {errorMsg && (
        <span className="text-[10px] text-rose-500 max-w-[150px] leading-tight block">
          {errorMsg}
        </span>
      )}
    </div>
  )
}
