'use client'

import { useState } from 'react'

interface RecordPaymentModalProps {
  leaseId: string
  unitName: string
}

export function RecordPaymentModal({ leaseId, unitName }: RecordPaymentModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('bank_transfer')
  const [amountRinggit, setAmountRinggit] = useState('')
  const [slipFile, setSlipFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    const num = parseFloat(amountRinggit)
    if (isNaN(num) || num <= 0) {
      setErrorMsg('Please enter a valid positive payment amount.')
      return
    }

    const amountSen = Math.round(num * 100)

    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('amountSen', amountSen.toString())
      formData.append('method', method)
      if (slipFile) {
        formData.append('slip', slipFile)
      }

      const res = await fetch(`/api/leases/${leaseId}/payments`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 422) {
          setErrorMsg(data.error || 'Payment exceeds the 110% overpayment cap allowed for this lease.')
        } else if (res.status === 403 || res.status === 401) {
          setErrorMsg('Only Staff or Managers can record payments. Please switch persona above.')
        } else {
          setErrorMsg(data.error || 'Failed to record payment.')
        }
        setLoading(false)
      } else {
        setIsOpen(false)
        window.location.reload()
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error submitting payment')
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
      >
        <span>📝</span>
        <span>Record Offline Payment</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 shadow-2xl relative text-left">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Record Payment</h3>
                <p className="text-xs text-slate-500">Unit {unitName} • Offline Collection</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {/* Payment Method */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMethod('bank_transfer')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      method === 'bank_transfer'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:border-blue-500 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span>🏦</span> Bank Transfer
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod('cash')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      method === 'cash'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:border-blue-500 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span>💵</span> Cash
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Amount in Ringgit (MYR)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 font-bold text-slate-400">RM</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={amountRinggit}
                    onChange={(e) => setAmountRinggit(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Subject to the 110% overpayment cap against total invoices.
                </span>
              </div>

              {/* File Slip Upload */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Bank Transfer Slip (Optional)
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={(e) => setSlipFile(e.target.files?.[0] || null)}
                  className="w-full text-[11px] text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 dark:file:bg-slate-800 dark:file:text-slate-300 cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Uploaded to private <code>payment-slips</code> bucket (PNG, JPEG, PDF up to 5MB).
                </span>
              </div>

              {errorMsg && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs leading-relaxed">
                  {errorMsg}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'Recording...' : 'Submit Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
