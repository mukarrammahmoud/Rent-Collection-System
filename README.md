# Rent Collection System

An enterprise multi-tenant rent collection and ledger platform built with **Next.js 16 (App Router)**, **Prisma**, and **Supabase (PostgreSQL + RLS + Storage)**. Features pure mathematical billing schedule generation, deterministic waterfall payment allocation, tamper-proof append-only audit trails, and multi-tenant isolation.

---

## Quick Start & Setup Instructions

Follow these exact steps to run the application locally:

```bash
# 1. Install dependencies
npm install

# 2. Start local Supabase containers (requires Docker)
npx supabase start

# 3. Reset database and run all SQL migrations
npx supabase db reset

# 4. Seed the database with test organizations, users, and leases
npm run seed

# 5. Build for production (verifies zero errors)
npm run build

# 6. Launch the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application and portfolio dashboard.

---

## Test Personas & Credentials

All seeded test accounts share the password: **`Password123!`**.  
Use the floating **Persona Switcher** in the top navigation bar to switch between personas instantly without manual credential entry.

### Northwind Properties (`org_id: 00000000-0000-0000-0000-000000000001`)

| Persona | Role | Email | Scope / Details |
| :--- | :--- | :--- | :--- |
| **Manager** | `manager` | `manager@northwind.test` | Organization-wide administration, payment approvals, voiding, lease creation |
| **Staff** | `staff` | `staff@northwind.test` | Payment recording with slip upload, collections reporting |
| **Aisyah Rahman** | `tenant` | `aisyah@northwind.test` | Unit `A-12-3` (`2026-01-31` to `2026-07-15`), Rent: RM 1,500.00, Deposit: RM 3,000.00 |
| **Ben Lim** | `tenant` | `ben@northwind.test` | Unit `B-05-1` (`2026-01-01` to `2026-04-15`), Rent: RM 1,000.29, No Deposit |
| **Probe Tenant** | `tenant` | `probe@northwind.test` | Unit `C-01-7` (`2026-02-28` to `2027-02-27`), Rent: RM 2,000.00, Deposit: RM 4,000.00 |
| *Vacant Unit* | — | — | Unit `D-03-2` (available for new lease creation) |

### Beta Realty (`org_id: 00000000-0000-0000-0000-000000000002`)

| Persona | Role | Email | Scope / Details |
| :--- | :--- | :--- | :--- |
| **Manager** | `manager` | `manager@beta.test` | Isolated Beta Realty administration |
| **Chen Wei** | `tenant` | `chen@beta.test` | Unit `KL-1` (`2026-03-15` to `2027-03-14`), Rent: RM 2,200.00, Deposit: RM 4,400.00 |

---

## Testing & Verification Commands

```bash
# Verify TypeScript compilation (zero errors)
npx tsc --noEmit

# Production Next.js build verification
npm run build

# Run deterministic database seeding
npm run seed
```

---

## Architecture & Engineering Design

### 1. Money Stored Strictly as BigInt Sen (No Floats)
All monetary amounts are stored as PostgreSQL `bigint` and Prisma `BigInt` (1 MYR = 100 sen). Eliminates IEEE-754 floating-point drift across schedules, invoices, and payment allocations.

### 2. Pure Billing Module (`lib/billing.ts`)
- **Zero external dependencies**: Zero imports from React, Next.js, Prisma, or date libraries.
- **Howard Hinnant civil calendar integer arithmetic**: Computes days since Unix epoch mathematically. Every $k$-th anchor is calculated as $(Y, M+k, D)$ and pinned to the target month's last day, preventing cumulative month-drift across any system timezone (`TZ=UTC`, `TZ=Asia/Kuala_Lumpur`, `TZ=America/New_York`).
- **Proration formula**: $\lfloor \frac{\text{monthlyRentSen} \times \text{daysUsed}}{\text{fullPeriodDays}} + 0.5 \rfloor$.
- **Dynamic invoice status resolver**: Correctly maps `paid`, `partially_paid`, `unpaid`, and `overdue` (evaluated strictly at 00:00:00 Malaysia Time following the due date).

### 3. Deterministic Waterfall Allocation (`lib/allocation.ts`)
- Waterfall ordering: `due_date ASC` $\rightarrow$ `kind ASC` ('deposit' before 'rent') $\rightarrow$ `period_index ASC` $\rightarrow$ `id ASC`.
- Idempotency guard: Early exit inside isolated transaction if allocations exist for the payment, preventing duplicate credits from re-sent webhooks.

### 4. Dual-Layer Authorization
- **Layer 1 (Route Handlers):** `lib/auth.ts` inspects Bearer tokens or SSR session cookies, enforcing HTTP 401, 403, and 404 tenant isolation (hiding cross-org resources).
- **Layer 2 (PostgreSQL RLS):** Supabase RLS policies enforce `auth.uid()` checks at the PostgreSQL engine level.

### 5. Append-Only Audit Trail
- `audit_log` table protected by a `BEFORE UPDATE OR DELETE` PostgreSQL trigger raising an exception.
- Privileges `REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC, anon, authenticated`.

### 6. Payment Gateway Webhook Protocol (`POST /api/webhooks/gateway`)
- Accepts `application/x-www-form-urlencoded`.
- Signs payload with HMAC-SHA256 over ASCII-sorted keys concatenated with values and separated by `|`.
- Idempotent execution: duplicate deliveries return 200 without side effects.

---

## HTTP API Route Summary

| Method & Route | Authorized Role | Description |
| :--- | :--- | :--- |
| `POST /api/leases` | Manager | Creates lease and scheduled invoices with overlap check |
| `GET /api/leases/:leaseId` | Staff, Manager, Lease Tenant | Retrieves lease, tenant, unit, invoices, and payments |
| `POST /api/leases/:leaseId/payments` | Staff, Manager | Records cash/transfer payment with 110% overpayment cap check |
| `POST /api/payments/:paymentId/approve` | Manager | Approves pending payment, runs waterfall allocation |
| `POST /api/payments/:paymentId/reject` | Manager | Rejects pending payment with required reason |
| `POST /api/payments/:paymentId/void` | Manager | Voids approved payment, deletes allocations, and restores balance |
| `POST /api/leases/:leaseId/gateway-bills` | Lease Tenant | Generates gateway bill for outstanding invoice balance |
| `GET /api/reports/collections` | Staff, Manager | Aggregates approved monthly collections in MYT timezone |
| `POST /api/webhooks/gateway` | Gateway | Secure webhook handler verifying HMAC signature and allocating |

---

## AI Collaboration Disclosure

Detailed documentation of AI assistance, models used (Claude Sonnet, Gemini Flash), engineering design prompts, and debugging sessions can be found in [`ai-logs/session-summary.md`](./ai-logs/session-summary.md).
