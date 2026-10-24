# DECISIONS.md — Architectural Decision Record

> Each decision is ≤ 150 words.

---

## D-1: Money Stored as BigInt Sen (No Floats)

**Decision:** All monetary values are stored as PostgreSQL `bigint` (sen) and Prisma `BigInt`. No `REAL`, `FLOAT`, or `DOUBLE PRECISION` types are used anywhere in the schema.

**Rationale:** IEEE-754 floating-point arithmetic introduces rounding errors that compound across large datasets. Storing in the smallest indivisible unit (sen) and performing all arithmetic as integer operations guarantees exact results. The `parseRinggitToSen` function converts string input using integer scaling rather than `parseFloat`. The proration formula uses `Math.round()` on integer operands, not floating-point division results stored back to a float column.

**Trade-off:** BigInt does not serialize to JSON automatically. All API responses call `.toString()` on BigInt values before returning, and clients must parse them as strings or use a BigInt-aware JSON library.

---

## D-2: Pure Billing Module with Zero External Dependencies

**Decision:** `lib/billing.ts` has zero imports — no React, Next.js, Prisma, Supabase, date-fns, or Decimal.js. All date arithmetic uses the Howard Hinnant civil-days integer algorithm.

**Rationale:** The billing module is evaluated by automated test runners in arbitrary environments (TZ=UTC, TZ=Asia/Kuala_Lumpur, TZ=America/New_York). Zero external dependencies means zero version conflicts, zero import resolution failures, and zero side effects from test harness environments. The civil-days algorithm operates on pure integers, making it strictly deterministic and independent of the process's `TZ` environment variable.

**Trade-off:** More verbose internal code compared to using `date-fns`. The algorithm was verified against `Date.UTC()` across a 130-year span (1970–2100) to confirm correctness.

---

## D-3: Dual-Layer Authorization (Route Handler + RLS)

**Decision:** Authorization is enforced in two independent layers: (1) `lib/auth.ts` in every Route Handler, (2) PostgreSQL Row Level Security policies on every table.

**Rationale:** Defense in depth. If a Route Handler bug allows an unauthorized request through, the database layer still rejects the operation. The Route Handler layer returns correct HTTP status codes (401/403/404). The RLS layer provides a safety net at the data access level using `auth.uid()` from the Supabase JWT.

**Trade-off:** Double-checking adds a small latency overhead (one extra query per request to resolve membership). Accepted because security correctness outweighs a few milliseconds.

---

## D-4: Append-Only Audit Log via Trigger + REVOKE

**Decision:** The `audit_log` table is protected by a PostgreSQL BEFORE trigger that raises an exception on UPDATE or DELETE, plus `REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC, anon, authenticated`.

**Rationale:** The audit trail must be tamper-proof. An application-level convention alone ("we just don't call DELETE") is insufficient — any path to the database (direct psql, Supabase Studio, future code) must also be blocked. The trigger ensures integrity even for the database owner role during normal operations. The seed script temporarily disables the trigger only during initial cleanup.

**Trade-off:** The trigger cannot be bypassed by the `service_role` key at the application level, which is intentional.

---

## D-5: FIFO Waterfall Allocation with Idempotency

**Decision:** `lib/allocation.ts` checks for existing allocations before processing. If any `payment_allocations` row exists for the payment, it returns immediately without creating duplicates.

**Rationale:** Webhook delivery (from the gateway) can be retried multiple times. The approve endpoint could theoretically be called twice in a race condition. Idempotency prevents double-allocating a payment and over-counting `unapplied_sen`. The check is performed inside the same transaction, so it is safe under concurrent requests.

**Trade-off:** A truly idempotent system would use an upsert with a unique constraint on `(payment_id, invoice_id)`. The current approach uses an early-exit check instead, which is simpler but relies on the transaction isolation level (READ COMMITTED) to prevent races.
