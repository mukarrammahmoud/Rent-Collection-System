/**
 * POST /api/leases/:leaseId/payments
 * Authorized: Staff or Manager
 * Records a new payment (with optional file slip upload to Supabase Storage).
 * Validates against the 110% overpayment cap.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireStaff, toErrorResponse, getPrisma, notFound, HttpError } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase'

const CreatePaymentSchema = z.object({
  amountSen: z.number().int().positive(),
  method: z.enum(['cash', 'bank_transfer', 'online']),
  receivedAt: z.string().datetime({ offset: true }).optional(),
  // slipPath provided if client pre-uploads the file
  slipPath: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leaseId: string }> },
) {
  try {
    const caller = await requireStaff(req)
    const prisma = getPrisma()
    const { leaseId } = await params

    // Verify the lease belongs to caller's org
    const lease = await prisma.lease.findFirst({
      where: { id: leaseId, orgId: caller.orgId },
    })
    if (!lease) {
      throw notFound()
    }

    // Parse body – may be JSON or multipart/form-data
    const contentType = req.headers.get('content-type') ?? ''
    let body: Record<string, unknown>
    let uploadedSlipPath: string | null = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      body = {
        amountSen: Number(formData.get('amountSen')),
        method: formData.get('method'),
        receivedAt: formData.get('receivedAt') || undefined,
      }

      const slipFile = formData.get('slip')
      if (slipFile && slipFile instanceof File) {
        // Upload to Supabase storage under <orgId>/<timestamp>-<name>
        const supabase = await createSupabaseServerClient()
        const fileName = `${caller.orgId}/${Date.now()}-${slipFile.name}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('payment-slips')
          .upload(fileName, slipFile, {
            contentType: slipFile.type,
            upsert: false,
          })

        if (uploadError) {
          return Response.json({ error: `Slip upload failed: ${uploadError.message}` }, { status: 400 })
        }
        uploadedSlipPath = uploadData.path
      }
    } else {
      body = await req.json()
    }

    const parsed = CreatePaymentSchema.safeParse(body)
    if (!parsed.success) {
      // Clean up uploaded file if validation fails
      if (uploadedSlipPath) {
        const supabase = await createSupabaseServerClient()
        await supabase.storage.from('payment-slips').remove([uploadedSlipPath])
      }
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { amountSen, method, receivedAt } = parsed.data

    // 110% overpayment cap check
    // Cap = sum of all invoice amounts for the lease × 110%
    const invoiceAgg = await prisma.invoice.aggregate({
      where: { leaseId, orgId: caller.orgId },
      _sum: { amountSen: true },
    })
    const totalDue = invoiceAgg._sum.amountSen ?? BigInt(0)

    // Total already recorded payments (pending + approved, not rejected/voided)
    const existingPayments = await prisma.payment.aggregate({
      where: {
        leaseId,
        orgId: caller.orgId,
        status: { in: ['pending_verification', 'approved'] },
      },
      _sum: { amountSen: true },
    })
    const alreadyRecorded = existingPayments._sum.amountSen ?? BigInt(0)

    const cap = (totalDue * BigInt(110)) / BigInt(100)
    if (alreadyRecorded + BigInt(amountSen) > cap) {
      // Clean up uploaded file if cap exceeded
      if (uploadedSlipPath) {
        const supabase = await createSupabaseServerClient()
        await supabase.storage.from('payment-slips').remove([uploadedSlipPath])
      }
      return Response.json(
        { error: 'Payment would exceed the 110% overpayment cap' },
        { status: 422 },
      )
    }

    // Create payment record in a transaction
    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.payment.create({
        data: {
          orgId: caller.orgId,
          leaseId,
          amountSen: BigInt(amountSen),
          unappliedSen: BigInt(amountSen),
          method,
          status: 'pending_verification',
          receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          slipPath: uploadedSlipPath ?? parsed.data.slipPath ?? null,
        },
      })

      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'payment.recorded',
          entityId: newPayment.id,
          details: { amountSen, method, slipPath: newPayment.slipPath, recordedBy: caller.role },
        },
      })

      return newPayment
    })

    return Response.json({ id: payment.id, status: payment.status }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
