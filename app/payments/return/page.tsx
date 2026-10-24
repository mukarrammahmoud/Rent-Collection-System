/**
 * /payments/return
 * Gateway return page – shown after tenant completes (or cancels) online payment.
 * Reads bill_id and status from URL search params.
 */
'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function GatewayReturnContent() {
  const searchParams = useSearchParams()
  const billId = searchParams.get('bill_id')
  const status = searchParams.get('status')

  const isSuccess = status === 'paid' || status === 'success'
  const isCancelled = status === 'cancelled' || status === 'cancel'
  const isFailed = status === 'failed' || status === 'failure' || (!isSuccess && !isCancelled)

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem',
        background: '#f8fafc',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          width: '100%',
          background: '#fff',
          borderRadius: '12px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          padding: '2.5rem',
          textAlign: 'center',
        }}
      >
        {/* Icon */}
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
          {isSuccess ? '✅' : isCancelled ? '⚠️' : '❌'}
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            margin: '0 0 0.75rem',
            color: isSuccess ? '#16a34a' : isCancelled ? '#d97706' : '#dc2626',
          }}
        >
          {isSuccess
            ? 'Payment Successful'
            : isCancelled
              ? 'Payment Cancelled'
              : 'Payment Failed'}
        </h1>

        {/* Message */}
        <p style={{ color: '#64748b', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          {isSuccess
            ? 'Your payment has been received and will be reflected in your account shortly.'
            : isCancelled
              ? 'Your payment was cancelled. No charges have been made.'
              : 'Your payment could not be processed. Please try again or contact support.'}
        </p>

        {/* Bill ID */}
        {billId && (
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.5rem' }}>
            Reference:{' '}
            <code
              style={{
                background: '#f1f5f9',
                padding: '2px 6px',
                borderRadius: '4px',
                fontFamily: 'monospace',
              }}
            >
              {billId}
            </code>
          </p>
        )}

        {/* Close button */}
        <button
          onClick={() => window.close()}
          style={{
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '0.75rem 2rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </main>
  )
}

export default function GatewayReturnPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: '4rem' }}>Loading…</div>}>
      <GatewayReturnContent />
    </Suspense>
  )
}
