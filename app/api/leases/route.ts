/**
 * POST /api/leases
 * Authorized: Manager
 * Creates a new lease and generates its invoice schedule.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireManager, toErrorResponse, getPrisma, HttpError } from '@/lib/auth'
import { generateSchedule, parseRinggitToSen } from '@/lib/billing'

const CreateLeaseSchema = z.object({
  unitId: z.string().uuid(),
  tenantId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  // Accept either string (e.g. "1,500.00") or number (already in sen)
  monthlyRentSen: z.union([z.string(), z.number().int().positive()]),
  depositSen: z.union([z.string(), z.number().int().min(0)]).optional().default(0),
})

export async function POST(req: NextRequest) {
  try {
    const caller = await requireManager(req)
    const prisma = getPrisma()

    const body = await req.json()
    const parsed = CreateLeaseSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { unitId, tenantId, startDate, endDate } = parsed.data

    // Parse money fields
    let monthlyRentSen: number
    let depositSen: number
    try {
      monthlyRentSen =
        typeof parsed.data.monthlyRentSen === 'string'
          ? parseRinggitToSen(parsed.data.monthlyRentSen)
          : parsed.data.monthlyRentSen
      depositSen =
        typeof parsed.data.depositSen === 'string'
          ? parseRinggitToSen(parsed.data.depositSen)
          : (parsed.data.depositSen as number)
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 })
    }

    if (endDate < startDate) {
      return Response.json({ error: 'endDate must be >= startDate' }, { status: 400 })
    }

    // Verify unit and tenant belong to the caller's org
    const unit = await prisma.unit.findFirst({
      where: { id: unitId, orgId: caller.orgId },
    })
    if (!unit) {
      return Response.json({ error: 'Unit not found in your organization' }, { status: 400 })
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, orgId: caller.orgId },
    })
    if (!tenant) {
      return Response.json({ error: 'Tenant not found in your organization' }, { status: 400 })
    }

    // Check for overlapping active leases on the same unit
    const overlap = await prisma.lease.findFirst({
      where: {
        unitId,
        AND: [
          { startDate: { lte: new Date(endDate) } },
          { endDate: { gte: new Date(startDate) } },
        ],
      },
    })
    if (overlap) {
      return Response.json(
        { error: 'Lease dates overlap with an existing lease on this unit' },
        { status: 409 },
      )
    }

    // Generate invoice schedule
    let schedule: ReturnType<typeof generateSchedule>
    try {
      schedule = generateSchedule({ startDate, endDate, monthlyRentSen, depositSen })
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 })
    }

    // Create lease + invoices in a transaction
    const lease = await prisma.$transaction(async (tx) => {
      const newLease = await tx.lease.create({
        data: {
          orgId: caller.orgId,
          unitId,
          tenantId,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
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
            periodIndex: inv.periodIndex,
            periodStart: inv.periodStart ? new Date(inv.periodStart) : null,
            periodEnd: inv.periodEnd ? new Date(inv.periodEnd) : null,
            dueDate: new Date(inv.dueDate),
            amountSen: BigInt(inv.amountSen),
          })),
        })
      }

      await tx.auditLog.create({
        data: {
          orgId: caller.orgId,
          actorId: caller.userId,
          action: 'lease.created',
          entityId: newLease.id,
          details: { unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen },
        },
      })

      return newLease
    })

    return Response.json({ id: lease.id }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
