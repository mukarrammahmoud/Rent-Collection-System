import Link from 'next/link'
import { getPrisma } from '@/lib/auth'

export default async function DashboardPage() {
  const prisma = getPrisma()

  const leases = await prisma.lease.findMany({
    include: {
      unit: true,
      tenant: true,
      organization: true,
      invoices: {
        include: {
          allocations: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  const units = await prisma.unit.findMany({
    include: {
      organization: true,
      leases: true,
    },
  })

  return (
    <main className="max-w-6xl w-full mx-auto p-6 md:p-8 space-y-8">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-8 text-white border border-slate-800 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 mb-3">
            Portfolio Management
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            Rent Collection System
          </h1>
          <p className="text-sm text-slate-300 mt-2 max-w-xl leading-relaxed">
            Full-stack multi-tenant property ledger platform. Switch personas using the top navigation bar to test Manager approvals, Staff payment recording, or Tenant online gateway settlements.
          </p>
        </div>
      </div>

      {/* Leases Portfolio */}
      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Active Leases</h2>
            <p className="text-xs text-slate-500">All currently provisioned leases across organizations</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {leases.length} Leases Active
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {leases.map((lease) => {
            const rentFormatted = `RM ${(Number(lease.monthlyRentSen) / 100).toLocaleString('en-MY', {
              minimumFractionDigits: 2,
            })}`
            const depositFormatted = `RM ${(Number(lease.depositSen) / 100).toLocaleString('en-MY', {
              minimumFractionDigits: 2,
            })}`

            return (
              <div
                key={lease.id}
                className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      {lease.organization.name}
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      ID: {lease.id.slice(0, 8)}…
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                    {lease.unit.name}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                    Tenant: <strong className="text-slate-800 dark:text-slate-200">{lease.tenant.fullName}</strong> ({lease.tenant.email})
                  </p>

                  <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl text-xs mb-4">
                    <div>
                      <span className="text-slate-500 block">Monthly Rent</span>
                      <strong className="text-sm text-slate-900 dark:text-white">{rentFormatted}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Security Deposit</span>
                      <strong className="text-sm text-slate-900 dark:text-white">{depositFormatted}</strong>
                    </div>
                    <div className="col-span-2 text-[11px] text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
                      Term: {lease.startDate.toISOString().split('T')[0]} → {lease.endDate.toISOString().split('T')[0]}
                    </div>
                  </div>
                </div>

                <Link
                  href={`/dashboard/leases/${lease.id}`}
                  className="w-full inline-flex justify-center items-center py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold text-xs hover:bg-slate-800 dark:hover:bg-white transition-colors"
                >
                  View Tenant Ledger & Pay Online →
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {/* Property Units Status */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Property Units Overview</h2>
          <p className="text-xs text-slate-500">Unit occupancy across Northwind Properties and Beta Realty</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {units.map((unit) => {
            const isOccupied = unit.leases.length > 0
            return (
              <div
                key={unit.id}
                className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-center"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">{unit.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{unit.organization.name}</div>
                <div className="mt-2.5">
                  {isOccupied ? (
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Occupied
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      Vacant
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
