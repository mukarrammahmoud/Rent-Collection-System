/**
 * POST /api/payments/:paymentId/void
 * Authorized: Manager only
 * Voids an approved payment: reverses all allocations and restores invoice balances.
 * Returns: 200 { status }
 * Errors: 400 if reason < 5 chars, 409 if not approved
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireManager, toErrorResponse, getPrisma, notFound } from '@/lib/auth'

const VoidSchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    const caller = await requireManager(req)
    const prisma = getPrisma()
    const { paymentId } = await params

    const body = await req.json()
    const parsed = VoidSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, orgId: caller.orgId },
    })

    if (!payment) {
      throw notFound()
    }

    if (payment.status !== 'approved') {
      return Response.json(
        { error: `Cannot void a payment with status "${payment.status}"` },
        { status: 409 },
      )
    }

    await prisma.$transaction(async (tx) => {
      // Delete all allocations for this payment (reverses allocation)
      await tx.paymentAllocation.deleteMany({
        where: { paymentId },
      })

      // Mark payment as voided with unapplied = 0
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'voided', unappliedSen: BigInt(0) },
      })

      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.voided',
          entityId: paymentId,
          details: { reason: parsed.data.reason, voidedBy: caller.role },
        },
      })
    })

    return Response.json({ status: 'voided' })
  } catch (err) {
    return toErrorResponse(err)
  }
}
