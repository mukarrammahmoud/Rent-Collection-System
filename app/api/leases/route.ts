/**
 * POST /api/leases
 * Authorized: Manager of the organization
 * Body: { unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen }
 *
 * - Validates all fields; dates must be valid ISO calendar dates, endDate >= startDate
 * - Overlap guard is concurrency-safe (performed inside the transaction)
 * - Calls generateSchedule from lib/billing.ts
 * - Returns 201 { id }
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireManager, toErrorResponse, getPrisma } from '@/lib/auth'
import { generateSchedule } from '@/lib/billing'

// Validate YYYY-MM-DD and that it is a real calendar date
function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00.000Z`)
  return !isNaN(d.getTime()) && d.toISOString().startsWith(s)
}

const CreateLeaseSchema = z.object({
  unitId: z.string().uuid('unitId must be a valid UUID'),
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
  startDate: z.string().refine(isValidCalendarDate, { message: 'startDate must be a valid YYYY-MM-DD date' }),
  endDate: z.string().refine(isValidCalendarDate, { message: 'endDate must be a valid YYYY-MM-DD date' }),
  monthlyRentSen: z.number()
    .int('monthlyRentSen must be an integer')
    .positive('monthlyRentSen must be > 0'),
  depositSen: z.number()
    .int('depositSen must be an integer')
    .min(0, 'depositSen must be >= 0'),
})

export async function POST(req: NextRequest) {
  try {
    const caller = await requireManager(req)
    const prisma = getPrisma()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = CreateLeaseSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen } = parsed.data

    if (endDate < startDate) {
      return Response.json({ error: 'endDate must be >= startDate' }, { status: 400 })
    }

    // Verify unit belongs to caller's org
    const unit = await prisma.unit.findFirst({
      where: { id: unitId, orgId: caller.orgId },
    })
    if (!unit) {
      return Response.json({ error: 'Unit not found in your organization' }, { status: 400 })
    }

    // Verify tenant belongs to caller's org
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, orgId: caller.orgId },
    })
    if (!tenant) {
      return Response.json({ error: 'Tenant not found in your organization' }, { status: 400 })
    }

    // Pre-compute invoice schedule (pure, no I/O) before entering the transaction
    let schedule: ReturnType<typeof generateSchedule>
    try {
      schedule = generateSchedule({ startDate, endDate, monthlyRentSen, depositSen })
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 })
    }

    const startDateObj = new Date(`${startDate}T00:00:00.000Z`)
    const endDateObj = new Date(`${endDate}T00:00:00.000Z`)

    // ---------------------------------------------------------------------------
    // Concurrency-safe transaction:
    //   1. Re-check for overlapping lease inside the transaction (prevents TOCTOU)
    //   2. Create lease
    //   3. Batch insert invoices
    //   4. Insert audit log
    // ---------------------------------------------------------------------------
    const lease = await prisma.$transaction(async (tx) => {
      // Overlap guard: (existing.start_date <= new.end_date) AND (existing.end_date >= new.start_date)
      const overlap = await tx.lease.findFirst({
        where: {
          unitId,
          AND: [
            { startDate: { lte: endDateObj } },
            { endDate: { gte: startDateObj } },
          ],
        },
        select: { id: true },
      })

      if (overlap) {
        throw Object.assign(new Error('Unit already has an active lease for this period'), {
          statusCode: 409,
        })
      }

      const newLease = await tx.lease.create({
        data: {
          orgId: caller.orgId,
          unitId,
          tenantId,
          startDate: startDateObj,
          endDate: endDateObj,
          monthlyRentSen: BigInt(monthlyRentSen),
          depositSen: BigInt(depositSen),
        },
      })

      if (schedule.length > 0) {
        await tx.invoice.createMany({
          data: schedule.map((inv) => ({
            orgId: caller.orgId,
            leaseId: newLease.id,
            kind: inv.kind,
            periodIndex: inv.periodIndex ?? null,
            periodStart: inv.periodStart ? new Date(`${inv.periodStart}T00:00:00.000Z`) : null,
            periodEnd: inv.periodEnd ? new Date(`${inv.periodEnd}T00:00:00.000Z`) : null,
            dueDate: new Date(`${inv.dueDate}T00:00:00.000Z`),
            amountSen: BigInt(inv.amountSen),
          })),
        })
      }

      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'LEASE_CREATE',
          entityId: newLease.id,
          details: {
            unitId,
            tenantId,
            startDate,
            endDate,
            monthlyRentSen,
            depositSen,
            invoiceCount: schedule.length,
          },
        },
      })

      return newLease
    })

    return Response.json({ id: lease.id }, { status: 201 })
  } catch (err) {
    // Surface the concurrency-detected 409 from inside the transaction
    if (err instanceof Error && (err as Error & { statusCode?: number }).statusCode === 409) {
      return Response.json({ error: err.message }, { status: 409 })
    }
    return toErrorResponse(err)
  }
}
