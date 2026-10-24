/**
 * GET /api/reports/collections
 * Authorized: Staff or Manager
 * Returns monthly collection totals for approved payments within a date range.
 * Query params: from (YYYY-MM), to (YYYY-MM)
 * Returns: [{ month: 'YYYY-MM', collectedSen: string }]
 */
import { NextRequest } from 'next/server'
import { requireStaff, toErrorResponse, getPrisma } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const caller = await requireStaff(req)
    const prisma = getPrisma()

    const url = req.nextUrl
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    // Validate YYYY-MM format
    const monthRegex = /^\d{4}-\d{2}$/
    if (!from || !monthRegex.test(from)) {
      return Response.json({ error: 'Invalid or missing "from" parameter (expected YYYY-MM)' }, { status: 400 })
    }
    if (!to || !monthRegex.test(to)) {
      return Response.json({ error: 'Invalid or missing "to" parameter (expected YYYY-MM)' }, { status: 400 })
    }

    if (to < from) {
      return Response.json({ error: '"to" must be >= "from"' }, { status: 400 })
    }

    const fromDate = new Date(`${from}-01T00:00:00.000Z`)
    // To date: first day of next month
    const [toYear, toMonth] = to.split('-').map(Number)
    const toNextMonth = toMonth === 12 ? 1 : toMonth + 1
    const toNextYear = toMonth === 12 ? toYear + 1 : toYear
    const toDate = new Date(`${String(toNextYear).padStart(4,'0')}-${String(toNextMonth).padStart(2,'0')}-01T00:00:00.000Z`)

    // Query approved payments within the org and date range
    const results = await prisma.$queryRaw<
      { month: string; collected_sen: bigint }[]
    >`
      SELECT
        to_char(date_trunc('month', received_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM') AS month,
        SUM(amount_sen) AS collected_sen
      FROM public.payments
      WHERE
        org_id = ${caller.orgId}::uuid
        AND status = 'approved'
        AND received_at >= ${fromDate}
        AND received_at < ${toDate}
      GROUP BY month
      ORDER BY month ASC
    `

    return Response.json(
      results.map((r) => ({
        month: r.month,
        collectedSen: r.collected_sen.toString(),
      })),
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
