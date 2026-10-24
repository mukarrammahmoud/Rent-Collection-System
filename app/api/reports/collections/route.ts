/**
 * GET /api/reports/collections
 * Authorized: Staff or Manager of the organization
 *
 * Query params:
 *   from  – YYYY-MM (inclusive)
 *   to    – YYYY-MM (inclusive)
 *
 * Business Logic:
 *   Aggregate amount_sen of payments WHERE status = 'approved' AND org_id = caller.orgId,
 *   bucketed by the calendar month of received_at in Malaysian Time (Asia/Kuala_Lumpur, UTC+8).
 *
 *   The UTC window is computed by converting the MYT month boundaries to UTC:
 *     - Window start = first instant of `from` month in MYT  → subtract 8h to get UTC
 *     - Window end   = first instant of month-after-`to` in MYT → subtract 8h to get UTC
 *
 * Returns 200: [{ month: 'YYYY-MM', collectedSen: number }, …]
 * Returns 400: invalid or missing params, or to < from
 */
import { NextRequest } from 'next/server'
import { requireStaff, toErrorResponse, getPrisma } from '@/lib/auth'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Validates a YYYY-MM string has a real month (01-12). */
function isValidMonth(s: string): boolean {
  return MONTH_RE.test(s)
}

/**
 * Returns the UTC Date representing midnight MYT (UTC+8) of the first day
 * of the given 'YYYY-MM' month.
 * e.g. '2026-01' → 2025-12-31T16:00:00.000Z  (MYT 2026-01-01 00:00:00)
 */
function mytMonthStartAsUtc(yyyyMm: string): Date {
  const [y, m] = yyyyMm.split('-').map(Number)
  // MYT midnight = UTC midnight − 8 hours
  return new Date(Date.UTC(y, m - 1, 1) - 8 * 60 * 60 * 1000)
}

/**
 * Returns the UTC Date of the first instant of the month AFTER yyyyMm in MYT.
 */
function mytNextMonthStartAsUtc(yyyyMm: string): Date {
  const [y, m] = yyyyMm.split('-').map(Number)
  const nextYear = m === 12 ? y + 1 : y
  const nextMonth = m === 12 ? 1 : m + 1
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1) - 8 * 60 * 60 * 1000)
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireStaff(req)
    const prisma = getPrisma()

    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')

    // Validate presence and format
    if (!from || !isValidMonth(from)) {
      return Response.json(
        { error: 'Missing or invalid "from" parameter. Expected YYYY-MM (e.g. 2026-01).' },
        { status: 400 },
      )
    }
    if (!to || !isValidMonth(to)) {
      return Response.json(
        { error: 'Missing or invalid "to" parameter. Expected YYYY-MM (e.g. 2026-12).' },
        { status: 400 },
      )
    }
    if (to < from) {
      return Response.json(
        { error: '"to" must be >= "from"' },
        { status: 400 },
      )
    }

    // Compute UTC window boundaries that correspond to the MYT month boundaries
    const windowStart = mytMonthStartAsUtc(from)   // inclusive
    const windowEnd = mytNextMonthStartAsUtc(to)    // exclusive

    // Raw SQL: bucket received_at by MYT calendar month, SUM amount_sen
    // The AT TIME ZONE conversion happens in PostgreSQL so it respects DST (though
    // Asia/Kuala_Lumpur has no DST, this is the correct pattern).
    const rows = await prisma.$queryRaw<{ month: string; collected_sen: bigint }[]>`
      SELECT
        to_char(
          date_trunc('month', received_at AT TIME ZONE 'Asia/Kuala_Lumpur'),
          'YYYY-MM'
        ) AS month,
        SUM(amount_sen)::bigint AS collected_sen
      FROM public.payments
      WHERE
        org_id    = ${caller.orgId}::uuid
        AND status    = 'approved'
        AND received_at >= ${windowStart}
        AND received_at <  ${windowEnd}
      GROUP BY 1
      ORDER BY 1 ASC
    `

    // collectedSen is returned as a number per the CONTRACT spec example
    return Response.json(
      rows.map((r) => ({
        month: r.month,
        collectedSen: Number(r.collected_sen),
      })),
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
