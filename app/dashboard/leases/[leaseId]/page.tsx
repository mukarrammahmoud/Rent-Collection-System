import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPrisma } from '@/lib/auth'
import { invoiceStatus } from '@/lib/billing'
import { TenantPayButton } from '@/components/tenant-pay-button'

interface PageProps {
  params: Promise<{ leaseId: string }>
}

function formatSenToRinggit(sen: bigint | number): string {
  const num = typeof sen === 'bigint' ? Number(sen) : sen
  return `RM ${(num / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toISOString().split('T')[0]
}

export default async function TenantLeaseDashboardPage({ params }: PageProps) {
  const { leaseId } = await params
  const prisma = getPrisma()

  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: {
      tenant: true,
      unit: true,
      organization: true,
      invoices: {
        include: {
          allocations: { select: { amountSen: true } },
        },
        orderBy: [
          { dueDate: 'asc' },
          { kind: 'asc' },
          { periodIndex: { sort: 'asc', nulls: 'first' } },
        ],
      },
      payments: {
        orderBy: { receivedAt: 'desc' },
      },
    },
  })

  if (!lease) {
    notFound()
  }

  const now = new Date()

  // Compute invoice statuses and total outstanding balance
  let totalInvoicedSen = BigInt(0)
  let totalPaidSen = BigInt(0)
  let outstandingSen = BigInt(0)

  const invoicesWithStatus = lease.invoices.map((inv) => {
    const paidSen = inv.allocations.reduce((sum, a) => sum + a.amountSen, BigInt(0))
    totalInvoicedSen += inv.amountSen
    totalPaidSen += paidSen

    const status = invoiceStatus(
      {
        dueDate: inv.dueDate.toISOString().split('T')[0],
        amountSen: Number(inv.amountSen),
        paidSen: Number(paidSen),
      },
      now,
    )

    if (status === 'overdue' || status === 'unpaid' || status === 'partially_paid') {
      const remaining = inv.amountSen - paidSen
      if (remaining > BigInt(0)) {
        outstandingSen += remaining
      }
    }

    return {
      ...inv,
      paidSen,
      status,
    }
  })

  return (
    <main className="max-w-6xl w-full mx-auto p-6 md:p-8 space-y-8">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors inline-flex items-center gap-1.5"
        >
          <span>←</span> Back to Portfolio Dashboard
        </Link>
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
          Org: {lease.organization.name}
        </span>
      </div>

      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {lease.unit.name}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              Active Lease
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Tenant: <strong className="text-slate-800 dark:text-slate-200">{lease.tenant.fullName}</strong> ({lease.tenant.email})
          </p>
        </div>

        {/* Outstanding Balance & Pay CTA */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 w-full md:w-auto">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">
            Total Outstanding Balance
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mb-3">
            {formatSenToRinggit(outstandingSen)}
          </div>
          <TenantPayButton leaseId={lease.id} outstandingSen={outstandingSen.toString()} />
        </div>
      </div>

      {/* Lease Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Lease Term</span>
          <div className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
            {formatDate(lease.startDate)}
          </div>
          <div className="text-xs text-slate-500">to {formatDate(lease.endDate)}</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Monthly Rent</span>
          <div className="mt-2 text-base font-bold text-slate-900 dark:text-white">
            {formatSenToRinggit(lease.monthlyRentSen)}
          </div>
          <div className="text-xs text-slate-500">Scheduled monthly</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Security Deposit</span>
          <div className="mt-2 text-base font-bold text-slate-900 dark:text-white">
            {formatSenToRinggit(lease.depositSen)}
          </div>
          <div className="text-xs text-slate-500">Refundable at termination</div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Settled to Date</span>
          <div className="mt-2 text-base font-bold text-emerald-600 dark:text-emerald-400">
            {formatSenToRinggit(totalPaidSen)}
          </div>
          <div className="text-xs text-slate-500">of {formatSenToRinggit(totalInvoicedSen)} billed</div>
        </div>
      </div>

      {/* Invoices Section */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Invoices & Billing Schedule</h2>
            <p className="text-xs text-slate-500">Deterministic schedule generated per Howard Hinnant calendar algorithm</p>
          </div>
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {invoicesWithStatus.length} Invoices
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold">
              <tr>
                <th className="py-3 px-4">Kind</th>
                <th className="py-3 px-4">Period</th>
                <th className="py-3 px-4">Coverage Dates</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4 text-right">Amount Billed</th>
                <th className="py-3 px-4 text-right">Amount Paid</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {invoicesWithStatus.map((inv) => {
                let badgeClass = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                if (inv.status === 'paid') badgeClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                if (inv.status === 'partially_paid') badgeClass = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                if (inv.status === 'overdue') badgeClass = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                if (inv.status === 'unpaid') badgeClass = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'

                return (
                  <tr key={inv.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-4 font-semibold capitalize text-slate-800 dark:text-slate-200">
                      {inv.kind === 'deposit' ? '🛡️ Deposit' : '📅 Rent'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                      {inv.periodIndex !== null ? `Period #${inv.periodIndex}` : '—'}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {inv.periodStart ? `${formatDate(inv.periodStart)} → ${formatDate(inv.periodEnd)}` : 'One-time security'}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-700 dark:text-slate-300">
                      {formatDate(inv.dueDate)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-slate-900 dark:text-white">
                      {formatSenToRinggit(inv.amountSen)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                      {formatSenToRinggit(inv.paidSen)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${badgeClass}`}>
                        {inv.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment History Section */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Payment Ledger & Receipts</h2>
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {lease.payments.length} Payments Recorded
          </span>
        </div>

        {lease.payments.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No payments recorded yet for this lease.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold">
                <tr>
                  <th className="py-3 px-4">Receipt Date</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-right">Unapplied</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4">Reference / Gateway</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {lease.payments.map((p) => {
                  let statusBadge = 'bg-slate-100 text-slate-700'
                  if (p.status === 'approved') statusBadge = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  if (p.status === 'pending_verification') statusBadge = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  if (p.status === 'rejected' || p.status === 'voided') statusBadge = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                        {p.receivedAt.toLocaleString('en-MY')}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200 uppercase text-[11px]">
                        {p.method.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white">
                        {formatSenToRinggit(p.amountSen)}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-500 font-mono text-[11px]">
                        {formatSenToRinggit(p.unappliedSen)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusBadge}`}>
                          {p.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                        {p.gatewayBillId || p.slipPath || 'Manual Record'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
