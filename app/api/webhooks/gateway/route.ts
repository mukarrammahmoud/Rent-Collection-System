/**
 * POST /api/webhooks/gateway
 * Gateway payment webhook – application/x-www-form-urlencoded
 *
 * Signature Verification:
 *   1. Extract all fields except x_signature
 *   2. Sort keys alphabetically (ASCII order)
 *   3. Concatenate each: key + value (no separator within pair)
 *   4. Join pairs with |
 *   5. HMAC-SHA256 with GATEWAY_X_SIGNATURE_KEY → lowercase hex
 *
 * Handling Matrix:
 *   - Invalid signature → 401
 *   - Unknown bill_id   → 404
 *   - paid=true AND paid_amount != bill.amount_sen → 422
 *   - paid=true AND bill is pending or failed → 200 (Mark paid, create approved payment, allocate)
 *   - Duplicate delivery → 200 (idempotent)
 *   - paid=false AND bill is paid → 200 (immutable)
 */
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { getPrisma, toErrorResponse } from '@/lib/auth'
import { allocatePayment } from '@/lib/allocation'

const SIGNATURE_KEY = process.env.GATEWAY_X_SIGNATURE_KEY ?? ''

/**
 * Computes the expected HMAC-SHA256 signature for the webhook payload.
 * All fields except x_signature, sorted alphabetically, concatenated as keyvalue, joined with |.
 */
function computeSignature(fields: Record<string, string>): string {
  const sortedKeys = Object.keys(fields)
    .filter((k) => k !== 'x_signature')
    .sort()

  const message = sortedKeys.map((k) => `${k}${fields[k]}`).join('|')

  return createHmac('sha256', SIGNATURE_KEY).update(message).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    // Parse application/x-www-form-urlencoded body
    const text = await req.text()
    const params = new URLSearchParams(text)
    const fields: Record<string, string> = {}
    for (const [key, value] of params.entries()) {
      fields[key] = value
    }

    // 1. Verify signature
    const receivedSignature = fields['x_signature'] ?? ''
    const expectedSignature = computeSignature(fields)

    if (
      !receivedSignature ||
      receivedSignature.toLowerCase() !== expectedSignature.toLowerCase()
    ) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const billId = fields['bill_id']
    const paidStr = fields['paid'] // 'true' or 'false'
    const paidAmountStr = fields['paid_amount'] // integer string (sen)

    const isPaid = paidStr === 'true'
    const paidAmount = paidAmountStr !== undefined ? BigInt(paidAmountStr) : null

    const prisma = getPrisma()

    // 2. Lookup the gateway bill
    const bill = await prisma.gatewayBill.findUnique({
      where: { id: billId },
      include: { lease: { select: { orgId: true } } },
    })

    if (!bill) {
      return Response.json({ error: 'Unknown bill_id' }, { status: 404 })
    }

    // 3. Idempotency: if bill is already paid and paid=true → no-op
    if (bill.status === 'paid' && isPaid) {
      return Response.json({ ok: true })
    }

    // 4. paid=false AND bill is paid → immutable, return 200
    if (!isPaid && bill.status === 'paid') {
      return Response.json({ ok: true })
    }

    // 5. paid=false → mark failed (if not already paid)
    if (!isPaid) {
      if (bill.status !== 'paid') {
        await prisma.gatewayBill.update({
          where: { id: billId },
          data: { status: 'failed' },
        })
      }
      return Response.json({ ok: true })
    }

    // 6. paid=true – validate amount
    if (paidAmount === null || paidAmount !== bill.amountSen) {
      return Response.json(
        { error: `Amount mismatch: expected ${bill.amountSen}, got ${paidAmount}` },
        { status: 422 },
      )
    }

    // 7. paid=true AND bill is pending or failed → process payment
    if (bill.status === 'pending' || bill.status === 'failed') {
      await prisma.$transaction(async (tx) => {
        // Check for existing payment for this bill (idempotency)
        const existingPayment = await tx.payment.findFirst({
          where: { gatewayBillId: billId },
        })

        if (!existingPayment) {
          const newPayment = await tx.payment.create({
            data: {
              orgId: bill.orgId,
              leaseId: bill.leaseId,
              amountSen: bill.amountSen,
              unappliedSen: bill.amountSen,
              method: 'online',
              status: 'approved',
              receivedAt: new Date(),
              gatewayBillId: billId,
            },
          })

          await allocatePayment(tx, newPayment.id)

          await tx.auditLog.create({
            data: {
              orgId: bill.orgId,
              actorId: null,
              action: 'payment.gateway_received',
              entityId: newPayment.id,
              details: { billId, paidAmount: bill.amountSen.toString(), method: 'online' },
            },
          })
        }

        await tx.gatewayBill.update({
          where: { id: billId },
          data: { status: 'paid' },
        })
      })
    }

    return Response.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
