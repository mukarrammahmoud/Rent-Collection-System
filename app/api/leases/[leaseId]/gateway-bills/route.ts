/**
 * POST /api/leases/:leaseId/gateway-bills
 * Authorized: Lease Tenant only
 * Creates a gateway payment bill for the tenant's current outstanding balance.
 * Returns 422 if there is nothing currently due.
 */
import { NextRequest } from 'next/server'
import { getCallerContext, toErrorResponse, getPrisma, forbidden, notFound, HttpError } from '@/lib/auth'
import { invoiceStatus } from '@/lib/billing'
import { createSupabaseAdminClient } from '@/lib/supabase'

function generateBillId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = 'bill_'
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  try {
    const caller = await getCallerContext(req)
    const prisma = getPrisma()
    const { leaseId } = await params

    // Only lease tenants can create gateway bills
    if (caller.kind !== 'tenant') {
      throw forbidden('Only tenants can create gateway bills')
    }

    // Verify the lease exists and belongs to this tenant's org
    const lease = await prisma.lease.findFirst({
      where: {
        id: leaseId,
        orgId: caller.orgId,
        tenantId: caller.tenantId,
      },
    })
    if (!lease) {
      throw notFound()
    }

    // Compute outstanding balance
    const now = new Date()

    const invoices = await prisma.invoice.findMany({
      where: { leaseId, orgId: caller.orgId },
      include: {
        allocations: { select: { amountSen: true } },
      },
    })

    // Sum all unpaid/overdue/partially-paid invoice amounts minus paid amounts
    let outstandingSen = BigInt(0)
    for (const inv of invoices) {
      const paidSen = inv.allocations.reduce((acc, a) => acc + a.amountSen, BigInt(0))
      const status = invoiceStatus(
        {
          dueDate: inv.dueDate.toISOString().split('T')[0],
          amountSen: Number(inv.amountSen),
          paidSen: Number(paidSen),
        },
        now,
      )
      if (status === 'overdue' || status === 'unpaid' || status === 'partially_paid') {
        const unpaid = inv.amountSen - paidSen
        if (unpaid > BigInt(0)) {
          outstandingSen += unpaid
        }
      }
    }

    if (outstandingSen <= BigInt(0)) {
      return Response.json({ error: 'Nothing due now' }, { status: 422 })
    }

    // Create the gateway bill record
    const billId = generateBillId()

    await prisma.gatewayBill.create({
      data: {
        id: billId,
        orgId: caller.orgId,
        leaseId,
        amountSen: outstandingSen,
        status: 'pending',
      },
    })

    return Response.json({ billId, amountSen: outstandingSen.toString() }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
