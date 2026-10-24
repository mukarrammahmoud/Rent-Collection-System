/**
 * POST /api/payments/:paymentId/approve
 * Authorized: Manager only
 * Approves a pending_verification payment, runs FIFO waterfall allocation.
 * Returns: 200 { status }
 * Errors: 409 if not pending_verification, 422 if it would create over-balance
 */
import { NextRequest } from 'next/server'
import { requireManager, toErrorResponse, getPrisma, notFound, HttpError } from '@/lib/auth'
import { allocatePayment } from '@/lib/allocation'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    const caller = await requireManager(req)
    const prisma = getPrisma()
    const { paymentId } = await params

    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, orgId: caller.orgId },
    })

    if (!payment) {
      throw notFound()
    }

    if (payment.status !== 'pending_verification') {
      return Response.json(
        { error: `Cannot approve a payment with status "${payment.status}"` },
        { status: 409 },
      )
    }

    // Approve + allocate in transaction
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'approved' },
      })

      await allocatePayment(tx, paymentId)

      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.approved',
          entityId: paymentId,
          details: { approvedBy: caller.role, amountSen: payment.amountSen.toString() },
        },
      })
    })

    return Response.json({ status: 'approved' })
  } catch (err) {
    return toErrorResponse(err)
  }
}
