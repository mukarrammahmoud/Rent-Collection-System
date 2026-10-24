# Rent Collection System

A full-stack rent collection platform built with Next.js 16 (App Router), Prisma, and Supabase. Manages organizations, leases, invoices, and multi-method payments with a complete audit trail.

---

## Prerequisites

- Node.js 20+
- pnpm 11+
- Docker (for Supabase local)
- Supabase CLI

---

## Setup

### 1. Start Supabase locally

```bash
supabase start
```

### 2. Apply migrations

```bash
supabase db push
# or
supabase migration up
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Configure environment

Copy `.env.example` → `.env` (or use the defaults which match `supabase start` output):

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start>
SUPABASE_SERVICE_ROLE_KEY=<service role key from supabase start>
GATEWAY_X_SIGNATURE_KEY=secret-signature-key
```

### 5. Generate Prisma client

```bash
pnpm exec prisma generate
```

### 6. Seed the database

```bash
pnpm seed
```

This will create:
- 2 organizations (Northwind Properties, Beta Realty)
- 7 users with password `Password123!`
- 4 leases with dynamically generated invoice schedules
- Sample payments with FIFO waterfall allocation
- Private `payment-slips` storage bucket

### 7. Run the development server

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## Architecture Overview

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Database | PostgreSQL (via Supabase) |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Auth | Supabase Auth (Bearer + SSR cookies) |
| Storage | Supabase Storage (`payment-slips` bucket) |
| Validation | Zod 4 |

### Key Design Decisions

**Money as BigInt (sen)**: All monetary values are stored as `bigint` integers in sen (1 MYR = 100 sen). This eliminates floating-point precision errors entirely.

**Pure billing module** (`lib/billing.ts`): Zero external dependencies, no I/O. All date math uses the Howard Hinnant civil-days algorithm so results are identical regardless of the process's local timezone (tested under UTC, Asia/Kuala_Lumpur, America/New_York).

**FIFO waterfall allocation** (`lib/allocation.ts`): When a payment is approved, it is allocated across unpaid invoices in strict priority order: due date ASC → deposit before rent → period index ASC → id ASC. The algorithm is idempotent and concurrency-safe.

**Dual-layer authorization**: Every request is validated at the Route Handler level (Bearer token or SSR session → `lib/auth.ts`) AND enforced again by PostgreSQL Row Level Security policies in the migration.

**Append-only audit log**: The `audit_log` table has a trigger that raises an exception on UPDATE/DELETE, and UPDATE/DELETE privileges are revoked from all roles. Every state-changing operation writes an immutable audit entry.

### Trade-offs

- **No floating point for proration**: The proration formula uses integer arithmetic (`Math.round((rent × days) / total)`) rather than a Decimal library to keep `lib/billing.ts` dependency-free.
- **Prisma singleton in Route Handlers**: A module-level Prisma client is reused across requests in the same Node.js process. This avoids connection exhaustion but means the first cold-start request pays the connection cost.
- **Service-role client only in webhook**: The gateway webhook uses the admin client to bypass RLS because it is an external caller without a user JWT. The webhook is secured instead by HMAC-SHA256 signature verification.

---

## API Reference

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/leases` | Manager | Create lease + invoice schedule |
| GET | `/api/leases/:leaseId` | Staff/Manager/Tenant | Lease detail with computed invoice status |
| POST | `/api/leases/:leaseId/payments` | Staff/Manager | Record payment (cash, bank transfer) |
| POST | `/api/leases/:leaseId/gateway-bills` | Lease Tenant | Create online payment gateway bill |
| POST | `/api/payments/:paymentId/approve` | Manager | Approve + allocate payment |
| POST | `/api/payments/:paymentId/reject` | Manager | Reject pending payment |
| POST | `/api/payments/:paymentId/void` | Manager | Void approved payment |
| GET | `/api/reports/collections` | Staff/Manager | Monthly collection report |
| POST | `/api/webhooks/gateway` | Gateway (HMAC) | Payment gateway callback |

---

## AI Disclosure

This project was developed with AI assistance (Antigravity IDE / Gemini). The AI was used to:
- Implement `lib/billing.ts` with timezone-safe pure math and test it across 3 timezones
- Generate the Prisma schema and SQL migrations with RLS policies
- Write the seed script with deterministic UUIDs and payment allocation
- Scaffold all Next.js 16 Route Handlers following the updated `params: Promise<...>` API
- Write `lib/auth.ts` and `lib/supabase.ts` helper modules

All generated code was reviewed for correctness against `CONTRACT.md`.
