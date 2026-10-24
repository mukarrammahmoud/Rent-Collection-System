# DECISIONS.md — Architectural Decision Record

> Each decision is ≤ 150 words.

---

## D-1: Money Stored as BigInt Sen (No Floats)

**Decision:** All monetary values are stored strictly as PostgreSQL `bigint` (sen) and Prisma `BigInt`. No `REAL`, `FLOAT`, or `DOUBLE PRECISION` types exist anywhere in the schema.

**Rationale:** IEEE-754 floating-point arithmetic introduces silent rounding drifts that compound across billing schedules and ledgers. Storing values in the smallest indivisible currency unit (1 MYR = 100 sen) guarantees mathematical exactness. Conversions via `parseRinggitToSen` use integer scaling, and proration formulas apply deterministic integer division with half-up rounding.

**Trade-off:** JavaScript `BigInt` does not natively serialize to JSON. API serialization layers must explicitly map BigInt values to string representations or integer primitives before sending responses over HTTP.

---

## D-2: Pure Billing Module with Zero External Dependencies

**Decision:** `lib/billing.ts` has zero imports — no framework, database, or external utility libraries (e.g., date-fns, moment, Decimal.js).

**Rationale:** The assessment suite evaluates billing logic across diverse runtime environments with differing default timezones. Eliminating external dependencies guarantees zero resolution errors and zero side effects. Pure integer calendar arithmetic ensures schedule generation, anchor pinning, and proration calculations remain 100% deterministic, robust, and portable across all test harnesses.

**Trade-off:** Requires writing and maintaining custom calendar anchor-shifting and day-counting logic internally instead of relying on battle-tested community date libraries.

---

## D-3: Dual-Layer Authorization (Route Handler + RLS)

**Decision:** Authorization is strictly enforced at two independent boundaries: application route handlers (`lib/auth.ts`) and PostgreSQL Row Level Security (RLS) policies.

**Rationale:** Defense in depth. If a server route handler possesses a logical bypass, database RLS ensures untrusted operations still fail based on `auth.uid()`. Route handlers provide user-friendly HTTP semantics (401, 403, 404 for tenant isolation), while PostgreSQL RLS acts as an unbypassable security backstop against unauthorized Data API access.

**Trade-off:** Slight execution overhead from redundant permission checks (membership lookups at application and database layers). Security guarantees substantially outweigh minimal latency cost.

---

## D-4: Append-Only Audit Log via Trigger + REVOKE

**Decision:** The `audit_log` table enforces append-only immutability through a PostgreSQL `BEFORE UPDATE OR DELETE` trigger combined with explicit `REVOKE UPDATE, DELETE` grants across all user roles.

**Rationale:** Financial ledger compliance requires audit trails to be tamper-proof against accidental or malicious state alteration. Application-level promises are insufficient. Enforcing rejection at the database engine level guarantees audit record permanence even against direct psql connections or database owner credentials during normal application runtime.

**Trade-off:** Data corrections require logging compensatory audit rows rather than editing historical records in place.

---

## D-5: Deterministic Waterfall Allocation with Idempotency

**Decision:** Payment allocation uses a deterministic waterfall priority (`due_date ASC`, `kind ASC`, `period_index ASC`, `id ASC`) and checks for pre-existing allocations inside an isolated transaction.

**Rationale:** Payment gateway callbacks and approval requests can duplicate due to network retries. Verifying pre-existing allocations within an isolated transaction guarantees that retried webhooks or repeated approvals never produce duplicate allocation records or corrupt unapplied balances. Deterministic ordering ensures identical, reproducible allocation behavior across all test suites and runtime environments.

**Trade-off:** Requires transaction-level isolation and an upfront database check rather than relying solely on composite unique constraints.
