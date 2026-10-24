/**
 * Billing Schedule and Invoice Status Calculations
 *
 * Pure TypeScript, zero external dependencies, no I/O.
 * Independent of local machine timezone offsets.
 */

export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  periodIndex: number | null  // 0, 1, 2... for rent; null for the deposit
  periodStart: string | null  // 'YYYY-MM-DD'; null for the deposit
  periodEnd: string | null    // 'YYYY-MM-DD', inclusive; null for the deposit
  dueDate: string             // 'YYYY-MM-DD'
  amountSen: number           // integer
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

/**
 * Checks if a given Gregorian year is a leap year.
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)
}

/**
 * Returns the number of days in a given Gregorian month (1-12).
 */
function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
      return 31
    case 2:
      return isLeapYear(year) ? 29 : 28
    case 3:
      return 31
    case 4:
      return 30
    case 5:
      return 31
    case 6:
      return 30
    case 7:
      return 31
    case 8:
      return 31
    case 9:
      return 30
    case 10:
      return 31
    case 11:
      return 30
    case 12:
      return 31
    default:
      return 0
  }
}

/**
 * Validates and extracts year, month, and day components from a 'YYYY-MM-DD' string.
 * Strictly checks format and calendar validity.
 */
function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): "${dateStr}"`)
  }
  const [yStr, mStr, dStr] = dateStr.split('-')
  const year = parseInt(yStr, 10)
  const month = parseInt(mStr, 10)
  const day = parseInt(dStr, 10)

  if (month < 1 || month > 12) {
    throw new Error(`Invalid calendar month: ${month} in date "${dateStr}"`)
  }
  const maxDays = daysInMonth(year, month)
  if (day < 1 || day > maxDays) {
    throw new Error(`Invalid calendar day: ${day} for month ${month} in date "${dateStr}"`)
  }

  return { year, month, day }
}

/**
 * Formats year, month, and day into a 'YYYY-MM-DD' string.
 */
function formatDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0')
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Converts a Gregorian civil date to days since 1970-01-01 (pure integer math).
 * Howard Hinnant algorithm.
 */
function civilToDays(year: number, month: number, day: number): number {
  let y = year
  const m = month
  const d = day
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m <= 2 ? m + 9 : m - 3) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/**
 * Computes calendar day immediately before dateStr.
 */
function dayBefore(dateStr: string): string {
  const { year, month, day } = parseDateParts(dateStr)
  if (day > 1) {
    return formatDate(year, month, day - 1)
  }
  if (month > 1) {
    const prevMonth = month - 1
    const prevDay = daysInMonth(year, prevMonth)
    return formatDate(year, prevMonth, prevDay)
  }
  return formatDate(year - 1, 12, 31)
}

/**
 * Computes anchor k (startDate + k calendar months) with day pinning.
 */
function computeAnchor(startYear: number, startMonth: number, startDay: number, k: number): string {
  const totalMonths = startYear * 12 + (startMonth - 1) + k
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = (totalMonths % 12) + 1
  const maxDays = daysInMonth(targetYear, targetMonth)
  const targetDay = Math.min(startDay, maxDays)
  return formatDate(targetYear, targetMonth, targetDay)
}

/**
 * Parses a Ringgit currency string into integer sen.
 *
 * Rules:
 * - Strips leading/trailing whitespace.
 * - Accepts digits with optional comma thousand separators (strictly groups of 3 digits).
 * - Accepts optional decimal component with at most 2 digits.
 * - Throws Error on invalid input: empty string, negative values, >2 decimals, scientific notation,
 *   non-numeric prefixes/suffixes, malformed thousand groupings.
 * - Returns integer sen without floating-point inaccuracies.
 */
export function parseRinggitToSen(input: string): number {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string')
  }

  const trimmed = input.trim()
  if (trimmed === '') {
    throw new Error('Invalid input: empty string')
  }

  // Strictly match valid ringgit formats:
  // Group 1: Comma-separated integer part (e.g. 1,500 or 12,345,678)
  // Group 2: Non-comma integer part (e.g. 0, 7, 1234)
  // Group 3: Optional decimal part with 1 or 2 digits
  const match = trimmed.match(/^(?:([1-9]\d{0,2}(?:,\d{3})+)|(0|[1-9]\d*))(?:\.(\d{1,2}))?$/)
  if (!match) {
    throw new Error(`Invalid ringgit amount format: "${input}"`)
  }

  const intPart = (match[1] || match[2]).replace(/,/g, '')
  const dollars = parseInt(intPart, 10)

  const decPart = match[3]
  let cents = 0
  if (decPart !== undefined) {
    if (decPart.length === 1) {
      cents = parseInt(decPart, 10) * 10
    } else if (decPart.length === 2) {
      cents = parseInt(decPart, 10)
    }
  }

  const totalSen = dollars * 100 + cents
  if (!Number.isSafeInteger(totalSen)) {
    throw new Error('Value exceeds maximum safe integer')
  }

  return totalSen
}

/**
 * Generates the full schedule of deposit and rent invoices for a lease.
 */
export function generateSchedule(lease: {
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[] {
  if (!lease || typeof lease !== 'object') {
    throw new Error('Lease must be a valid object')
  }

  const { startDate, endDate, monthlyRentSen, depositSen } = lease

  const startParts = parseDateParts(startDate)
  parseDateParts(endDate)

  if (endDate < startDate) {
    throw new Error(`endDate (${endDate}) cannot be before startDate (${startDate})`)
  }

  if (typeof monthlyRentSen !== 'number' || !Number.isInteger(monthlyRentSen) || monthlyRentSen <= 0) {
    throw new Error(`monthlyRentSen must be a positive integer, got ${monthlyRentSen}`)
  }

  if (typeof depositSen !== 'number' || !Number.isInteger(depositSen) || depositSen < 0) {
    throw new Error(`depositSen must be a non-negative integer, got ${depositSen}`)
  }

  const schedule: ScheduledInvoice[] = []

  // Deposit invoice emitted first if depositSen > 0
  if (depositSen > 0) {
    schedule.push({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: startDate,
      amountSen: depositSen,
    })
  }

  let k = 0
  while (true) {
    const currentAnchor = computeAnchor(startParts.year, startParts.month, startParts.day, k)
    if (currentAnchor > endDate) {
      break
    }

    const nextAnchor = computeAnchor(startParts.year, startParts.month, startParts.day, k + 1)
    const nominalPeriodEnd = dayBefore(nextAnchor)

    const isPartial = endDate < nominalPeriodEnd
    const periodEnd = isPartial ? endDate : nominalPeriodEnd

    let amountSen: number
    if (isPartial) {
      const { year: cy, month: cm, day: cd } = parseDateParts(currentAnchor)
      const { year: ey, month: em, day: ed } = parseDateParts(endDate)
      const { year: ny, month: nm, day: nd } = parseDateParts(nominalPeriodEnd)

      const daysUsed = civilToDays(ey, em, ed) - civilToDays(cy, cm, cd) + 1
      const fullPeriodDays = civilToDays(ny, nm, nd) - civilToDays(cy, cm, cd) + 1

      // Prorated formula: Math.round((monthlyRentSen * daysUsed) / fullPeriodDays)
      amountSen = Math.round((monthlyRentSen * daysUsed) / fullPeriodDays)
    } else {
      amountSen = monthlyRentSen
    }

    schedule.push({
      kind: 'rent',
      periodIndex: k,
      periodStart: currentAnchor,
      periodEnd: periodEnd,
      dueDate: currentAnchor,
      amountSen: amountSen,
    })

    k++
  }

  return schedule
}

/**
 * Evaluates the status of an invoice relative to the current time in Malaysia Time (UTC+8).
 *
 * Precedence:
 * 1. 'paid' if paidSen >= amountSen
 * 2. 'overdue' if today's Malaysia date is strictly after dueDate
 * 3. 'partially_paid' if paidSen > 0
 * 4. 'unpaid'
 */
export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (!invoice || typeof invoice !== 'object') {
    throw new Error('Invoice must be an object')
  }
  parseDateParts(invoice.dueDate)

  if (typeof invoice.amountSen !== 'number' || !Number.isInteger(invoice.amountSen)) {
    throw new Error(`amountSen must be an integer, got ${invoice.amountSen}`)
  }
  if (typeof invoice.paidSen !== 'number' || !Number.isInteger(invoice.paidSen)) {
    throw new Error(`paidSen must be an integer, got ${invoice.paidSen}`)
  }
  if (!now || typeof now.getTime !== 'function' || isNaN(now.getTime())) {
    throw new Error('now must be a valid Date object')
  }

  // Precedence 1: paid
  if (invoice.paidSen >= invoice.amountSen) {
    return 'paid'
  }

  // Malaysia Time is UTC+8: add exactly 8 hours to UTC epoch time and extract YYYY-MM-DD
  const mytEpochMs = now.getTime() + 8 * 60 * 60 * 1000
  const mytDate = new Date(mytEpochMs)
  const mytYear = mytDate.getUTCFullYear()
  const mytMonth = String(mytDate.getUTCMonth() + 1).padStart(2, '0')
  const mytDay = String(mytDate.getUTCDate()).padStart(2, '0')
  const todayMalaysia = `${mytYear}-${mytMonth}-${mytDay}`

  // Precedence 2: overdue (today's Malaysia date strictly after dueDate)
  if (todayMalaysia > invoice.dueDate) {
    return 'overdue'
  }

  // Precedence 3: partially_paid
  if (invoice.paidSen > 0) {
    return 'partially_paid'
  }

  // Precedence 4: unpaid
  return 'unpaid'
}
