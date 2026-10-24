/**
 * /payments/return
 * Gateway settlement return page.
 * Handles redirection after gateway payment (simulated or real).
 *
 * Adheres to CONTRACT.md Section 5 & 7:
 *   - Idempotent: Primary payment creator is the webhook (/api/webhooks/gateway).
 *   - If the bill is already marked paid or payment exists, do NOT duplicate.
 */
import Link from 'next/link'
import { getPrisma } from '@/lib/auth'
import { allocatePayment } from '@/lib/allocation'

export const instant = false

interface PageProps {
  searchParams: Promise<{
    bill_id?: string
    paid?: string
    status?: string
  }>
}

export default async function GatewayReturnPage({ searchParams }: PageProps) {
  const params = await searchParams
  const billId = params.bill_id
  const paidParam = params.paid
  const statusParam = params.status

  const isSuccess = paidParam === 'true' || statusParam === 'paid' || statusParam === 'success'

  const prisma = getPrisma()
  let bill = null
  let leaseId = ''

  if (billId) {
    try {
      bill = await prisma.gatewayBill.findUnique({
        where: { id: billId },
        include: {
          lease: {
            include: {
              unit: true,
              tenant: true,
            },
          },
        },
      })

      if (bill) {
        leaseId = bill.leaseId

        // Check if an approved payment already exists for this gateway bill
        const existingPayment = await prisma.payment.findUnique({
          where: { gatewayBillId: bill.id },
        })

        // Idempotency: If webhook already marked it paid or created the payment, do NOT duplicate
        if (bill.status === 'paid' || existingPayment) {
          // Already settled by webhook — render confirmation safely
        } else if (isSuccess && bill.status === 'pending') {
          // Fallback settlement for direct simulated return flows if webhook was bypassed
          try {
            await prisma.$transaction(async (tx) => {
              // Concurrency safety check inside transaction
              const freshBill = await tx.gatewayBill.findUnique({
                where: { id: bill!.id },
              })
              const freshPayment = await tx.payment.findUnique({
                where: { gatewayBillId: bill!.id },
              })

              if (freshBill?.status === 'paid' || freshPayment) {
                return // Webhook processed concurrently
              }

              await tx.gatewayBill.update({
                where: { id: bill!.id },
                data: { status: 'paid' },
              })

              const payment = await tx.payment.create({
                data: {
                  orgId: bill!.orgId,
                  leaseId: bill!.leaseId,
                  amountSen: bill!.amountSen,
                  unappliedSen: bill!.amountSen,
                  method: 'online',
                  status: 'approved',
                  gatewayBillId: bill!.id,
                  receivedAt: new Date(),
                },
              })

              await allocatePayment(tx, payment.id)

              await tx.auditLog.create({
                data: {
                  orgId: bill!.orgId,
                  actorId: bill!.lease.tenant.userId,
                  action: 'payment.online_completed',
                  entityId: payment.id,
                  details: {
                    billId: bill!.id,
                    amountSen: bill!.amountSen.toString(),
                    method: 'online',
                  },
                },
              })
            })

            // Refresh bill state
            bill = await prisma.gatewayBill.findUnique({
              where: { id: billId },
              include: {
                lease: {
                  include: {
                    unit: true,
                    tenant: true,
                  },
                },
              },
            })
          } catch (e) {
            console.error('Error settling bill in return handler:', e)
          }
        } else if (!isSuccess && bill.status === 'pending') {
          // Update bill status to failed if gateway returned cancellation/failure
          await prisma.gatewayBill.update({
            where: { id: bill.id },
            data: { status: 'failed' },
          })
          bill.status = 'failed'
        }
      }
    } catch (err) {
      console.error('Error in GatewayReturnPage:', err)
    }
  }

  const amountFormatted = bill
    ? `RM ${(Number(bill.amountSen) / 100).toLocaleString('en-MY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : 'RM 0.00'

  const returnUrl = leaseId ? `/dashboard/leases/${leaseId}` : '/dashboard'

  return (
    <main className="min-h-[85vh] flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8 text-center">
        {/* Status Icon */}
        <div className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center text-3xl shadow-sm">
          {isSuccess ? (
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              ✓
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 flex items-center justify-center text-rose-600 dark:text-rose-400">
              ✕
            </div>
          )}
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold tracking-tight mb-2 text-slate-900 dark:text-white">
          {isSuccess ? 'Payment Successful' : 'Payment Not Completed'}
        </h1>

        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
          {isSuccess
            ? 'Your online payment was approved by the gateway and has been applied directly to your outstanding rent invoice.'
            : 'The gateway transaction was cancelled or could not be authorized. No funds were deducted.'}
        </p>

        {/* Transaction Summary Card */}
        {bill && (
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 mb-6 text-left text-xs space-y-2.5">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-500 dark:text-slate-400">Amount Paid</span>
              <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">
                {amountFormatted}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Unit</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {bill.lease.unit.name}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Tenant</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {bill.lease.tenant.fullName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Bill Reference</span>
              <code className="bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded font-mono text-[11px] text-slate-700 dark:text-slate-300">
                {bill.id}
              </code>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">Status</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                {bill.status.toUpperCase()}
              </span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2.5">
          {isSuccess ? (
            <Link
              href={returnUrl}
              className="w-full inline-flex justify-center items-center py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition-colors shadow-sm"
            >
              ← Back to Lease Dashboard
            </Link>
          ) : (
            <>
              <Link
                href={returnUrl}
                className="w-full inline-flex justify-center items-center py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-colors shadow-sm"
              >
                Retry Payment
              </Link>
              <Link
                href="/dashboard"
                className="w-full inline-flex justify-center items-center py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Go to Dashboard
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
