# REVIEW.md — Pull Request Code Review

> **Part B: Code Review Exercise**
> Reviewing a hypothetical pull request that introduces payment processing changes.

---

## PR Summary

The PR adds a new "bulk payment import" feature that accepts a CSV upload of historical payments and bulk-inserts them with status `approved`, then calls `allocatePayment` in a loop for each one.

---

## Review Comments

### 🔴 Critical: Race condition in bulk allocation loop

```typescript
// PR code (problematic)
for (const row of csvRows) {
  const payment = await prisma.payment.create({ data: { ...row, status: 'approved' } })
  await allocatePayment(prisma, payment.id)  // NOT inside a transaction
}
```

**Issue:** `allocatePayment` must run inside `prisma.$transaction`. Calling it on the bare `prisma` client means the payment update (`unappliedSen`) and the allocation inserts are separate database statements with no atomicity guarantee. If the process crashes between them, the payment is `approved` with no allocations, and the `unapplied_sen` still equals `amount_sen` — the balance accounting is silently corrupted.

**Fix:** Wrap each payment creation + allocation in a `$transaction` callback:

```typescript
await prisma.$transaction(async (tx) => {
  const payment = await tx.payment.create({ data: { ...row, status: 'approved' } })
  await allocatePayment(tx, payment.id)
})
```

---

### 🔴 Critical: Bypasses the 110% overpayment cap

**Issue:** Bulk-importing historical payments with `status: 'approved'` skips the cap check that exists in `POST /api/leases/:leaseId/payments`. A single malformed CSV row could cause total approved payments to exceed 110% of total invoice amounts, corrupting the `unapplied_sen` balance.

**Fix:** Compute the current approved total before inserting each batch row and reject the entire import if any row would breach the cap. Alternatively, apply the cap check inside the allocation logic itself so it is enforced regardless of the import path.

---

### 🟡 Major: Missing audit log entries

**Issue:** The PR creates `approved` payments with no corresponding `audit_log` entries. The audit log must record every state transition for compliance. Silent bulk imports make it impossible to trace who approved which payments and when.

**Fix:** Inside the same transaction, insert an `audit_log` row for each imported payment:

```typescript
await tx.auditLog.create({
  data: {
    orgId: payment.orgId,
    actorId: importedByUserId,
    action: 'payment.bulk_imported',
    entityId: payment.id,
    details: { source: 'csv', filename: uploadedFilename, amountSen: row.amountSen },
  },
})
```

---

### 🟡 Major: CSV parsing uses `parseFloat` for monetary values

```typescript
// PR code (problematic)
const amountSen = parseFloat(row.amount) * 100
```

**Issue:** `parseFloat` introduces floating-point precision errors. `parseFloat('1000.29') * 100` evaluates to `100029.00000000001` in IEEE-754, which when cast to `BigInt` throws a `RangeError` ("The number 100029.00000000001 cannot be converted to a BigInt because it is not an integer"). Even if cast with `Math.round`, this is an unnecessary source of bugs.

**Fix:** Use `parseRinggitToSen` from `lib/billing.ts` which performs exact integer arithmetic:

```typescript
import { parseRinggitToSen } from '@/lib/billing'
const amountSen = parseRinggitToSen(row.amount)
```

---

### 🟡 Major: No organization scoping on imported tenant/lease lookups

**Issue:** The PR looks up leases by ID from the CSV without verifying that `lease.orgId === caller.orgId`. A malicious CSV containing lease IDs from a different organization would allow cross-organization payment injection.

**Fix:** Always filter with `orgId`:

```typescript
const lease = await tx.lease.findFirst({
  where: { id: row.leaseId, orgId: caller.orgId },
})
if (!lease) throw new Error(`Lease ${row.leaseId} not found in your organization`)
```

---

### 🟠 Minor: No row-level validation before bulk insert

**Issue:** The PR reads all CSV rows into memory and starts inserting before validating. A validation failure on row 500 after 499 successful inserts leaves partial data in the database.

**Fix:** Validate all rows in a first pass (without writing to the database), collect all errors, return them to the user, and only proceed with the insert if all rows pass validation.

---

### 🟠 Minor: `received_at` defaults to `now()` for historical records

**Issue:** Bulk importing historical payments with `receivedAt` defaulting to the current timestamp makes the data incorrect. The CSV likely contains the actual historical receipt dates.

**Fix:** Parse `receivedAt` from the CSV column and validate it is a valid ISO 8601 timestamp. Reject rows where the date is in the future.

---

### ✅ Approved Pattern: Idempotency key on CSV row

The PR includes a `source_ref` column in the CSV that is stored on the payment and has a `UNIQUE` constraint. This is an excellent pattern — re-uploading the same CSV will skip already-imported rows gracefully. No changes needed here.

---

## Summary

| Severity | Count |
|---|---|
| 🔴 Critical (data corruption / security) | 2 |
| 🟡 Major (correctness / compliance) | 3 |
| 🟠 Minor (data quality) | 2 |
| ✅ Approved | 1 |

**Verdict: REQUEST CHANGES.** The transaction safety issue and cross-org scoping gap must be fixed before merge.
