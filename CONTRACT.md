# SYSTEM CONTRACT & SPECIFICATION SHEET

> **CRITICAL RULE:** All table names, column names, API routes, data types, and file paths in this file are strict contracts evaluated by automated test runners. Do NOT rename, alias, or alter their signatures.

---

## 1. Environment & Global Constraints

- **Currency:** Malaysian Ringgit (MYR / RM).
- **Sub-unit:** 1 Ringgit = 100 Sen.
- **Data Type for Money:** Stored strictly as `bigint` sen in PostgreSQL / Prisma. Zero floating-point types (`REAL`, `FLOAT`, `DOUBLE PRECISION` are forbidden).
- **Business Timezone:** `Asia/Kuala_Lumpur` (UTC+8, no daylight saving).
  - All input/output dates and timestamps displayed or accepted are in Malaysia Time.
  - Server runs in `UTC`.
- **Authorization Standards:** Dual-layer enforcement (Server Route handlers / Actions + PostgreSQL Row Level Security).
  - Bearer Token (`Authorization: Bearer <token>`) AND Session Cookie must both be supported.
  - 401: Unauthenticated.
  - 403: Forbidden (authenticated, but role not permitted).
  - 404: Record in another organization, or another tenant's record (hide existence).

---

## 2. Mandatory File Locations

```text
lib/billing.ts                              # Pure math & scheduling module (Zero external dependencies)
app/api/leases/route.ts                     # POST /api/leases
app/api/leases/[leaseId]/route.ts           # GET /api/leases/:leaseId
app/api/leases/[leaseId]/payments/route.ts  # POST /api/leases/:leaseId/payments
app/api/leases/[leaseId]/gateway-bills/route.ts # POST /api/leases/:leaseId/gateway-bills
app/api/payments/[paymentId]/approve/route.ts   # POST /api/payments/:paymentId/approve
app/api/payments/[paymentId]/reject/route.ts    # POST /api/payments/:paymentId/reject
app/api/payments/[paymentId]/void/route.ts      # POST /api/payments/:paymentId/void
app/api/reports/collections/route.ts        # GET /api/reports/collections
app/api/webhooks/gateway/route.ts           # POST /api/webhooks/gateway
app/payments/return/page.tsx                # Gateway return page (/payments/return)
supabase/config.toml                        # Local Supabase CLI configuration
supabase/migrations/                        # SQL migrations with RLS and Storage policies
prisma/schema.prisma                        # Prisma schema mirroring PostgreSQL exactly
prisma/seed.ts                              # Deterministic database seeding
REVIEW.md                                   # Part B: Pull Request Code Review
DECISIONS.md                                # Part C: Architectural Decisions (< 150 words each)
ai-logs/                                    # Exported AI session transcripts
README.md                                   # Setup guide, trade-offs, and disclosure
```

---

## 3. Database Schema Contract (Tables & Required Columns)

Every table below must exist in `supabase/migrations/` and `prisma/schema.prisma`:

| Table Name | Required Columns | Data Types & Constraints |
| :--- | :--- | :--- |
| `organizations` | `id`, `name` | `id: uuid PRIMARY KEY`, `name: text` |
| `memberships` | `user_id`, `org_id`, `role` | `user_id: uuid`, `org_id: uuid`, `role: 'manager' \| 'staff'` |
| `units` | `id`, `org_id`, `name` | `id: uuid PRIMARY KEY`, `org_id: uuid`, `name: text` |
| `tenants` | `id`, `org_id`, `user_id`, `full_name`, `email`, `phone` | `id: uuid PRIMARY KEY`, `org_id: uuid`, `user_id: uuid` |
| `leases` | `id`, `org_id`, `unit_id`, `tenant_id`, `start_date`, `end_date`, `monthly_rent_sen`, `deposit_sen` | `start_date: date`, `end_date: date`, `monthly_rent_sen: bigint`, `deposit_sen: bigint` |
| `invoices` | `id`, `org_id`, `lease_id`, `kind`, `period_index`, `period_start`, `period_end`, `due_date`, `amount_sen` | `kind: 'deposit' \| 'rent'`, `due_date: date`, `amount_sen: bigint` |
| `payments` | `id`, `org_id`, `lease_id`, `amount_sen`, `unapplied_sen`, `method`, `status`, `received_at`, `slip_path`, `gateway_bill_id` | `amount_sen: bigint`, `unapplied_sen: bigint`, `method: 'cash' \| 'bank_transfer' \| 'online'`, `status: 'pending_verification' \| 'approved' \| 'rejected' \| 'voided'`, `received_at: timestamptz` |
| `payment_allocations` | `id`, `org_id`, `payment_id`, `invoice_id`, `amount_sen` | `amount_sen: bigint` |
| `gateway_bills` | `id`, `org_id`, `lease_id`, `amount_sen`, `status` | `status: 'pending' \| 'paid' \| 'failed'`, `id: unguessable string` |
| `audit_log` | `id`, `org_id`, `actor_id`, `action`, `entity_id`, `details`, `created_at` | Append-only (`REVOKE UPDATE, DELETE` for all roles including DB owner) |

---

## 4. Supabase Storage Contract

- **Bucket Name:** `payment-slips` (Strictly Private).
- **Path Pattern:** `<org_id>/...`
- **Permissions:**
  - **Manager and Staff of the owning organization:** Upload and Read (via short-lived signed URLs).
  - **Tenants, other organizations, and anonymous callers:** Zero access (Blocked).
- **Clean-up rule:** If recording a payment fails after uploading a slip, the uploaded file must be cleaned up immediately.

---

## 5. Pure Billing Module Contract (lib/billing.ts)

```typescript
export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  periodIndex: number | null
  periodStart: string | null
  periodEnd: string | null
  dueDate: string
  amountSen: number
}

export function generateSchedule(lease: {
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[]

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus

export function parseRinggitToSen(input: string): number
```

### Deterministic Rules for lib/billing.ts:
- **Zero I/O & Zero Imports:** No framework or database dependencies.
- **Anchor Arithmetic:** Rent period $k$ anchor is calculated strictly from $\text{startDate} + k \text{ calendar months}$ (never accumulated from prior anchor). If the target month has fewer days, pin to the month's last day.
- **Proration on Truncated Period:**
  $$\text{amountSen} = \left\lfloor \frac{\text{monthlyRentSen} \times \text{daysUsed}}{\text{fullPeriodDays}} + 0.5 \right\rfloor$$
- **Overdue Threshold:** Due on `2026-03-01` becomes overdue strictly at `2026-03-02 00:00:00 MYT` (`2026-03-01T16:00:00Z`).
- **Invoice Status Resolution Order:**
  1. `paid` (if `paidSen >= amountSen`)
  2. `overdue` (if today's Malaysia calendar date > `dueDate`)
  3. `partially_paid` (if `paidSen > 0`)
  4. `unpaid`

---

## 6. HTTP API Specification

| Method & Route | Authorized Role | Success Response | Error Responses |
| :--- | :--- | :--- | :--- |
| `POST /api/leases` | Manager | `201 { id }` | `400 invalid input`, `409 overlaps unit lease` |
| `GET /api/leases/:leaseId` | Staff, Manager, Lease Tenant | `200 { lease, invoices, payments }` | `401`, `403`, `404` |
| `POST /api/leases/:leaseId/payments` | Staff, Manager | `201 { id, status }` | `400 invalid input`, `422 over the cap` |
| `POST /api/payments/:paymentId/approve` | Manager | `200 { status }` | `409 not pending`, `422 over balance` |
| `POST /api/payments/:paymentId/reject` | Manager | `200 { status }` | `400 reason < 5 chars`, `409 not pending` |
| `POST /api/payments/:paymentId/void` | Manager | `200 { status }` | `400 reason < 5 chars`, `409 not approved` |
| `POST /api/leases/:leaseId/gateway-bills` | Lease Tenant | `201 { billId, amountSen }` | `422 nothing due now` |
| `GET /api/reports/collections` | Staff, Manager | `200 [{ month, collectedSen }]` | `400 invalid range` |
| `POST /api/webhooks/gateway` | Gateway | `200` (or `401`, `404`, `422`) | See Webhook section |

---

## 7. Payment Webhook Protocol (POST /api/webhooks/gateway)

- **Content-Type:** `application/x-www-form-urlencoded`
- **Signature Calculation:**
  1. Extract all payload fields excluding `x_signature`.
  2. Sort keys alphabetically (ASCII character code order).
  3. Concatenate each key with its value directly: `keyvalue`.
  4. Join all pairs with `|`.
  5. Compute HMAC-SHA256 using `GATEWAY_X_SIGNATURE_KEY` formatted as lowercase hexadecimal.
- **Handling Matrix:**
  - Invalid signature $\rightarrow$ `401`
  - Unknown `bill_id` $\rightarrow$ `404`
  - `paid=true` AND `paid_amount != bill.amount_sen` $\rightarrow$ `422`
  - `paid=true` AND bill is pending or failed $\rightarrow$ `200` (Mark bill paid, create approved payment, allocate).
  - Duplicate deliveries $\rightarrow$ `200` (No side effects, idempotent).
  - `paid=false` AND bill is paid $\rightarrow$ `200` (Paid bill is immutable).

---

## 8. Seed Data Checklist (npm run seed)

- **Shared Credentials:** One shared password for all accounts.

### Organizations & Accounts
- **Northwind Properties:**
  - Manager: `manager@northwind.test`
  - Staff: `staff@northwind.test`
  - Tenants: `aisyah@northwind.test`, `ben@northwind.test`, `probe@northwind.test`
- **Beta Realty:**
  - Manager: `manager@beta.test`
  - Tenant: `chen@beta.test`

### Leases & Payments
- **Aisyah Rahman** (Northwind, Unit A-12-3):
  - Term: `2026-01-31` to `2026-07-15`, Rent: `RM 1,500.00`, Deposit: `RM 3,000.00`
  - Payment 1: Cash, `RM 3,000.00`, received `2026-01-31 10:00 MYT` (recorded by Manager, approved).
  - Payment 2: Bank Transfer, `RM 2,000.00`, received `2026-03-01 00:30 MYT` (recorded by Staff with slip, approved by Manager).
- **Ben Lim** (Northwind, Unit B-05-1):
  - Term: `2026-01-01` to `2026-04-15`, Rent: `RM 1,000.29`, Deposit: None.
- **Probe Tenant** (Northwind, Unit C-01-7):
  - Term: `2026-02-28` to `2027-02-27`, Rent: `RM 2,000.00`, Deposit: `RM 4,000.00`.
- **Chen Wei** (Beta Realty, Unit KL-1):
  - Term: `2026-03-15` to `2027-03-14`, Rent: `RM 2,200.00`, Deposit: `RM 4,400.00`.