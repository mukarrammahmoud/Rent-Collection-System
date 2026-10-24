# AI Collaboration & Session Summary Log

This document fulfills the assessment requirement for documenting AI assistance, prompts, model interactions, engineering workflows, and critical architectural decisions.

---

## 1. Overview & Tooling

- **AI Assistants & Models Used:**
  - **Claude 3.5 Sonnet / Claude Sonnet 4.6 (Thinking)**: Used for architecture decomposition, pure mathematical algorithm design (`lib/billing.ts`), edge-case stress testing, and pull request code review.
  - **Gemini 3.8 Flash (High)**: Used for rapid multi-file validation, UI component synthesis, route integration, and build type-checking.
- **Workflow & Environment:**
  - IDE: Google Antigravity paired with local Supabase CLI and PostgreSQL.
  - Interaction Pattern: Contract-first pair programming. All modules strictly adhere to `CONTRACT.md` before implementation.

---

## 2. Key Engineering Decisions Guided by AI

### 1. Howard Hinnant Civil-Days Integer Calendar (`lib/billing.ts`)
- **Challenge:** The billing module is evaluated against hidden test suites across random system timezones (`TZ=UTC`, `TZ=Asia/Kuala_Lumpur`, `TZ=America/New_York`). Standard JavaScript `Date` parsing or accumulation of months introduces silent 1-day shifts when crossing DST or month boundaries (e.g. adding 1 month to Jan 31).
- **AI Recommendation:** Zero external dependencies and zero reliance on local `Date` parsing. Implemented Howard Hinnant's civil calendar algorithm operating on pure integer days since Unix epoch. Every $k$-th monthly anchor is calculated from `(startYear, startMonth + k, startDay)` pinned to the target month's last day if necessary, preventing cumulative drift.
- **Verification:** Verified mathematically against `Date.UTC()` across a 130-year span (1970–2100).

### 2. Deterministic Waterfall Payment Allocation (`lib/allocation.ts`)
- **Challenge:** When payments arrive (cash, bank transfer, or online gateway), allocations must be applied deterministically and idempotently without concurrency corruption or double-crediting.
- **AI Recommendation:**
  - Waterfall priority sort: `due_date ASC` $\rightarrow$ `kind ASC` ('deposit' before 'rent' alphabetically) $\rightarrow$ `period_index ASC` (nulls first) $\rightarrow$ `id ASC`.
  - Atomicity: Executed inside `prisma.$transaction`.
  - Idempotency guard: Checks if any allocation record already exists for the given `paymentId`. If present, immediately exits early, preventing duplicate allocations from gateway callback retries.

### 3. Append-Only Audit Log via Database Triggers & Privileges
- **Challenge:** Financial compliance requires audit records to be immutable even if application code is compromised or if direct DB connections occur.
- **AI Recommendation:**
  - PostgreSQL `BEFORE UPDATE OR DELETE` trigger on `public.audit_log` raising an exception.
  - Revocation of privileges: `REVOKE UPDATE, DELETE ON public.audit_log FROM PUBLIC, anon, authenticated`.
  - Application-level: Prisma schema and API endpoints only support `auditLog.create`.

### 4. Dual-Layer Defense-in-Depth Authorization
- **Challenge:** Single-point authorization in application route handlers risks unauthorized leaks if a developer forgets a check or writes a flawed conditional.
- **AI Recommendation:**
  - **Layer 1 (Route Handlers):** `lib/auth.ts` inspects Bearer tokens or SSR session cookies, looks up memberships and tenant bindings, and enforces organization boundaries with semantic HTTP responses (401 unauthenticated, 403 forbidden, 404 tenant isolation).
  - **Layer 2 (PostgreSQL RLS):** Supabase Row Level Security policies enforce `auth.uid()` checks at the PostgreSQL engine level, acting as an unbypassable backstop against accidental Data API exposure.

---

## 3. Prompts & Iteration Workflow

| Phase | Prompt Objective | Outcome |
| :--- | :--- | :--- |
| **Phase 1** | Pure billing module with zero dependencies (`lib/billing.ts`) | Implemented civil-days calendar, anchor calculation, proration integer formula, and invoice status resolver. |
| **Phase 2** | Database schema harmonization with `CONTRACT.md` (`prisma/schema.prisma`) | Corrected `userId` UUID type, indexed `leaseId` on gateway bills, added `@unique` on `payments.gateway_bill_id`. |
| **Phase 3** | Deterministic seeding & storage configuration (`prisma/seed.ts`) | Provisioned 2 orgs, 7 users, 5 units, 4 leases, and seeded payments; created private `payment-slips` bucket. |
| **Phase 4** | Complete payment lifecycle & security (`lib/auth.ts`, `lib/allocation.ts`, Webhooks) | Implemented HMAC-SHA256 signature verification, 110% overpayment cap, manager approval/rejection/void endpoints. |
| **Phase 5** | Lease management & collections reporting | Overlap validation in transaction, `GET /api/leases/[leaseId]` rollup, and Malaysia timezone collections report. |
| **Phase 6** | UI & Submission Artifacts | Built Fast Persona Switcher (`components/persona-switcher.tsx`), Tenant Pay online flow (`/payments/return`), and full documentation. |

---

## 4. Assessment Checklist

- [x] Pure TypeScript `lib/billing.ts` with zero external dependencies and zero imports.
- [x] All money stored strictly as `BigInt` sen (no floats).
- [x] Dual-layer authorization: `lib/auth.ts` + PostgreSQL RLS.
- [x] Immutable `audit_log` via DB trigger + `REVOKE`.
- [x] Idempotent payment allocation waterfall.
- [x] HMAC-SHA256 gateway webhook protocol with ASCII key sorting.
- [x] Storage bucket `payment-slips` private with 5MB limit and allowed MIME types.
- [x] 7 test personas with instant switcher and shared password `Password123!`.
- [x] Clean Next.js 16 build with zero TypeScript errors.
