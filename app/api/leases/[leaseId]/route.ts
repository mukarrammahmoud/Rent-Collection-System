/**
 * GET /api/leases/:leaseId
 * Authorized: Staff, Manager, or the Lease's Tenant
 * Returns: { lease, invoices, payments }
 */
import { NextRequest } from 'next/server'
import { getCallerContext, toErrorResponse, getPrisma, notFound } from '@/lib/auth'
import { invoiceStatus } from '@/lib/billing'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  try {
    const caller = await getCallerContext(req)
    const prisma = getPrisma()
    const { leaseId } = await params

    // Fetch lease with related data
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        invoices: {
          include: {
            allocations: { select: { amountSen: true } },
          },
          orderBy: [{ dueDate: 'asc' }, { kind: 'asc' }, { periodIndex: 'asc' }],
        },
        payments: {
          orderBy: { receivedAt: 'asc' },
        },
      },
    })

    if (!lease) {
      throw notFound()
    }

    // Authorization check: must be same org member OR the lease's tenant
    if (caller.kind === 'staff') {
      if (caller.orgId !== lease.orgId) {
        throw notFound()
      }
    } else {
      // tenant
      if (caller.orgId !== lease.orgId) {
        throw notFound()
      }
      // Verify it's their lease
      if (caller.tenantId !== lease.tenantId) {
        throw notFound()
      }
    }

    const now = new Date()

    // Build invoices with computed status
    const invoices = lease.invoices.map((inv) => {
      const paidSen = inv.allocations.reduce((acc, a) => acc + a.amountSen, BigInt(0))
      const status = invoiceStatus(
        {
          dueDate: inv.dueDate.toISOString().split('T')[0],
          amountSen: Number(inv.amountSen),
          paidSen: Number(paidSen),
        },
        now,
      )
      return {
        id: inv.id,
        kind: inv.kind,
        periodIndex: inv.periodIndex,
        periodStart: inv.periodStart ? inv.periodStart.toISOString().split('T')[0] : null,
        periodEnd: inv.periodEnd ? inv.periodEnd.toISOString().split('T')[0] : null,
        dueDate: inv.dueDate.toISOString().split('T')[0],
        amountSen: inv.amountSen.toString(),
        paidSen: paidSen.toString(),
        status,
      }
    })

    // Build payments
    const payments = lease.payments.map((p) => ({
      id: p.id,
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
        startDate: lease.startDate.toISOString().split('T')[0],
        endDate: lease.endDate.toISOString().split('T')[0],
        monthlyRentSen: lease.monthlyRentSen.toString(),
        depositSen: lease.depositSen.toString(),
        createdAt: lease.createdAt.toISOString(),
      },
      invoices,
      payments,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
