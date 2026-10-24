/**
 * POST /api/payments/:paymentId/reject
 * Authorized: Manager only
 * Rejects a pending_verification payment.
 * Returns: 200 { status }
 * Errors: 400 if reason < 5 chars, 409 if not pending_verification
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireManager, toErrorResponse, getPrisma, notFound } from '@/lib/auth'

const RejectSchema = z.object({
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
    const parsed = RejectSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, orgId: caller.orgId },
    })

    if (!payment) {
      throw notFound()
    }

    if (payment.status !== 'pending_verification') {
      return Response.json(
        { error: `Cannot reject a payment with status "${payment.status}"` },
        { status: 409 },
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'rejected' },
      })

      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.rejected',
          entityId: paymentId,
          details: { reason: parsed.data.reason, rejectedBy: caller.role },
        },
      })
    })

    return Response.json({ status: 'rejected' })
  } catch (err) {
    return toErrorResponse(err)
  }
}
