/**
 * GET /api/leases/:leaseId
 * Authorized: Org Staff, Org Manager, or the Tenant whose user_id matches the lease's tenant
 *
 * Returns 200 { lease, tenant, unit, invoices, payments }
 *   - 404 if lease belongs to another org or the tenant is accessing another tenant's lease
 *   - Invoices ordered: due_date ASC → kind ASC ('deposit' < 'rent') → period_index ASC (nulls first)
 *   - Each invoice includes dynamic status from invoiceStatus()
 */
import { NextRequest } from 'next/server'
import { getCallerContext, toErrorResponse, getPrisma, notFound } from '@/lib/auth'
import { invoiceStatus } from '@/lib/billing'

/** Converts a Prisma Date (stored as UTC midnight for a date column) to YYYY-MM-DD */
function toDateString(d: Date): string {
  // PostgreSQL date columns come back as UTC midnight; use UTC getters
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  try {
    const caller = await getCallerContext(req)
    const prisma = getPrisma()
    const { leaseId } = await params

    // Fetch lease with all related data needed for the response
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        tenant: {
          select: {
            id: true,
            userId: true,
            fullName: true,
            email: true,
            phone: true,
            orgId: true,
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
            orgId: true,
          },
        },
        invoices: {
          include: {
            allocations: { select: { amountSen: true } },
          },
          // Prisma sorts: due_date ASC, then kind ASC ('deposit' < 'rent' alphabetically),
          // then period_index ASC with nulls first (deposits always have null period_index)
          orderBy: [
            { dueDate: 'asc' },
            { kind: 'asc' },
            { periodIndex: { sort: 'asc', nulls: 'first' } },
          ],
        },
        payments: {
          orderBy: { receivedAt: 'asc' },
        },
      },
    })

    // 404 if not found — hide existence
    if (!lease) {
      throw notFound()
    }

    // ---------------------------------------------------------------------------
    // Authorization check — return 404 (not 403) to hide existence from outsiders
    // ---------------------------------------------------------------------------
    if (caller.kind === 'staff') {
      // Staff/manager must belong to the same organization
      if (caller.orgId !== lease.orgId) {
        throw notFound()
      }
    } else {
      // Tenant: must be in the same org AND this must be their own lease
      if (caller.orgId !== lease.orgId) {
        throw notFound()
      }
      if (caller.tenantId !== lease.tenantId) {
        throw notFound()
      }
    }

    const now = new Date()

    // Build invoices with computed dynamic status
    const invoices = lease.invoices.map((inv) => {
      const paidSen = inv.allocations.reduce((acc, a) => acc + a.amountSen, BigInt(0))

      const status = invoiceStatus(
        {
          dueDate: toDateString(inv.dueDate),
          amountSen: Number(inv.amountSen),
          paidSen: Number(paidSen),
        },
        now,
      )

      return {
        id: inv.id,
        leaseId: inv.leaseId,
        kind: inv.kind,
        periodIndex: inv.periodIndex,
        periodStart: inv.periodStart ? toDateString(inv.periodStart) : null,
        periodEnd: inv.periodEnd ? toDateString(inv.periodEnd) : null,
        dueDate: toDateString(inv.dueDate),
        amountSen: inv.amountSen.toString(),
        paidSen: paidSen.toString(),
        status,
      }
    })

    // Build payments
    const payments = lease.payments.map((p) => ({
      id: p.id,
      leaseId: p.leaseId,
      amountSen: p.amountSen.toString(),
      unappliedSen: p.unappliedSen.toString(),
      method: p.method,
      status: p.status,
      receivedAt: p.receivedAt.toISOString(),
      slipPath: p.slipPath,
      gatewayBillId: p.gatewayBillId,
    }))

    return Response.json({
      lease: {
        id: lease.id,
        orgId: lease.orgId,
        unitId: lease.unitId,
        tenantId: lease.tenantId,
        startDate: toDateString(lease.startDate),
        endDate: toDateString(lease.endDate),
        monthlyRentSen: lease.monthlyRentSen.toString(),
        depositSen: lease.depositSen.toString(),
        createdAt: lease.createdAt.toISOString(),
      },
      tenant: lease.tenant,
      unit: lease.unit,
      invoices,
      payments,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
