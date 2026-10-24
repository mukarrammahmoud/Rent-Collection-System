import { Prisma } from '@prisma/client'

/**
 * Payment Allocation Module (FIFO Waterfall)
 *
 * Allocates an approved payment to unpaid lease invoices in deterministic priority order:
 * 1. due_date ASC
 * 2. kind ('deposit' before 'rent')
 * 3. period_index ASC (nulls first)
 * 4. id ASC
 *
 * Strict Rules:
 * - Pure bigint arithmetic for all sen values (no floating point).
 * - Concurrency & Idempotency safe (exits if allocations already exist).
 * - Tracks unapplied balance in payment.unapplied_sen.
 * - Dynamic invoice status (never written to database).
 */
export async function allocatePayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<void> {
  // 1. Concurrency & Idempotency: Fetch target payment inside transaction
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
  })

  if (!payment) {
    throw new Error(`Payment with id "${paymentId}" not found`)
  }

  // Idempotency check: if allocations already exist for this paymentId, return immediately
  const existingAllocation = await tx.paymentAllocation.findFirst({
    where: { paymentId },
  })

  if (existingAllocation) {
    return
  }

  // Ensure payment status is 'approved'
  if (payment.status !== 'approved') {
    throw new Error(
      `Cannot allocate payment "${paymentId}": status must be "approved", got "${payment.status}"`,
    )
  }

  // 2. Invoice Target Scope: Fetch all invoices for lease, including future ones
  const invoices = await tx.invoice.findMany({
    where: {
      leaseId: payment.leaseId,
      orgId: payment.orgId,
    },
    include: {
      allocations: {
        select: {
          amountSen: true,
        },
      },
    },
  })

  // Compute current paid amount and remaining unpaid balance for each invoice
  const unpaidInvoices = invoices
    .map((inv) => {
      const paidSen = inv.allocations.reduce((acc, a) => acc + a.amountSen, BigInt(0))
      const unpaidSen = inv.amountSen - paidSen
      return {
        ...inv,
        paidSen,
        unpaidSen,
      }
    })
    .filter((inv) => inv.unpaidSen > BigInt(0))

  // 3. Strict Ordering (Waterfall Priority):
  // a. due_date ASC
  // b. kind ('deposit' before 'rent')
  // c. period_index ASC (nulls first, then 0, 1, 2...)
  // d. id ASC (tie-breaker)
  unpaidInvoices.sort((a, b) => {
    // a. due_date ASC
    const timeA = a.dueDate.getTime()
    const timeB = b.dueDate.getTime()
    if (timeA !== timeB) {
      return timeA - timeB
    }

    // b. kind ('deposit' before 'rent')
    if (a.kind !== b.kind) {
      return a.kind === 'deposit' ? -1 : 1
    }

    // c. period_index ASC (nulls first for deposits, then 0, 1, 2...)
    if (a.periodIndex === null && b.periodIndex !== null) return -1
    if (a.periodIndex !== null && b.periodIndex === null) return 1
    if (a.periodIndex !== null && b.periodIndex !== null && a.periodIndex !== b.periodIndex) {
      return a.periodIndex - b.periodIndex
    }

    // d. id ASC (tie-breaker)
    return a.id.localeCompare(b.id)
  })

  // 4. Allocation Loop
  let remainingToAllocate = payment.amountSen
  const allocationsToCreate: {
    orgId: string
    paymentId: string
    invoiceId: string
    amountSen: bigint
  }[] = []

  for (const invoice of unpaidInvoices) {
    if (remainingToAllocate === BigInt(0)) {
      break
    }

    const allocAmount = remainingToAllocate < invoice.unpaidSen ? remainingToAllocate : invoice.unpaidSen

    if (allocAmount > BigInt(0)) {
      allocationsToCreate.push({
        orgId: payment.orgId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        amountSen: allocAmount,
      })
      remainingToAllocate -= allocAmount
    }
  }

  // Create allocated records in batch if any
  if (allocationsToCreate.length > 0) {
    await tx.paymentAllocation.createMany({
      data: allocationsToCreate,
    })
  }

  // 5. Unapplied Remainder: Update payment row with remaining balance
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      unappliedSen: remainingToAllocate,
    },
  })
}
