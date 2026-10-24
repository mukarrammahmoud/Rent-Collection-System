import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
// @ts-expect-error Could not find a declaration file for module 'pg'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { generateSchedule } from '../lib/billing'
import { allocatePayment } from '../lib/allocation'

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// Deterministic UUIDs
const ORG_NORTHWIND = '00000000-0000-0000-0000-000000000001'
const ORG_BETA = '00000000-0000-0000-0000-000000000002'

const USER_NORTHWIND_MANAGER = '10000000-0000-0000-0000-000000000001'
const USER_NORTHWIND_STAFF = '10000000-0000-0000-0000-000000000002'
const USER_AISYAH = '10000000-0000-0000-0000-000000000003'
const USER_BEN = '10000000-0000-0000-0000-000000000004'
const USER_PROBE = '10000000-0000-0000-0000-000000000005'

const USER_BETA_MANAGER = '20000000-0000-0000-0000-000000000001'
const USER_CHEN = '20000000-0000-0000-0000-000000000002'

const UNIT_A_12_3 = '30000000-0000-0000-0000-000000000001'
const UNIT_B_05_1 = '30000000-0000-0000-0000-000000000002'
const UNIT_C_01_7 = '30000000-0000-0000-0000-000000000003'
const UNIT_D_03_2 = '30000000-0000-0000-0000-000000000004'
const UNIT_KL_1 = '30000000-0000-0000-0000-000000000005'

const TENANT_AISYAH = '40000000-0000-0000-0000-000000000001'
const TENANT_BEN = '40000000-0000-0000-0000-000000000002'
const TENANT_PROBE = '40000000-0000-0000-0000-000000000003'
const TENANT_CHEN = '40000000-0000-0000-0000-000000000004'

const LEASE_AISYAH = '50000000-0000-0000-0000-000000000001'
const LEASE_BEN = '50000000-0000-0000-0000-000000000002'
const LEASE_PROBE = '50000000-0000-0000-0000-000000000003'
const LEASE_CHEN = '50000000-0000-0000-0000-000000000004'

const PAYMENT_AISYAH_1 = '60000000-0000-0000-0000-000000000001'
const PAYMENT_AISYAH_2 = '60000000-0000-0000-0000-000000000002'

async function seed() {
  console.log('Starting deterministic database seeding...')

  // 1. Ensure private storage bucket 'payment-slips' exists (5MB limit, PNG/JPEG/PDF)
  await prisma.$executeRawUnsafe(`
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'payment-slips',
      'payment-slips',
      false,
      5242880,
      ARRAY['image/png', 'image/jpeg', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'application/pdf'];
  `)

  // 2. Clean up tables in reverse relational dependency order
  console.log('Cleaning up existing data...')
  await prisma.$executeRawUnsafe(
    `ALTER TABLE public.audit_log DISABLE TRIGGER trg_audit_log_append_only;`,
  )
  await prisma.$executeRawUnsafe(`DELETE FROM public.audit_log;`)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE public.audit_log ENABLE TRIGGER trg_audit_log_append_only;`,
  )

  await prisma.paymentAllocation.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.gatewayBill.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.lease.deleteMany()
  await prisma.tenant.deleteMany()
  await prisma.unit.deleteMany()
  await prisma.membership.deleteMany()
  await prisma.organization.deleteMany()

  // 3. Seed Organizations
  console.log('Seeding organizations...')
  await prisma.organization.createMany({
    data: [
      { id: ORG_NORTHWIND, name: 'Northwind Properties' },
      { id: ORG_BETA, name: 'Beta Realty' },
    ],
  })

  // 4. Seed all 7 required users into auth.users and auth.identities
  console.log('Seeding auth users...')
  const users = [
    { id: USER_NORTHWIND_MANAGER, email: 'manager@northwind.test' },
    { id: USER_NORTHWIND_STAFF, email: 'staff@northwind.test' },
    { id: USER_AISYAH, email: 'aisyah@northwind.test' },
    { id: USER_BEN, email: 'ben@northwind.test' },
    { id: USER_PROBE, email: 'probe@northwind.test' },
    { id: USER_BETA_MANAGER, email: 'manager@beta.test' },
    { id: USER_CHEN, email: 'chen@beta.test' },
  ]

  for (const user of users) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        recovery_token
      ) VALUES (
        $1::uuid,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        $2,
        crypt('Password123!', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        '',
        ''
      ) ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        encrypted_password = EXCLUDED.encrypted_password,
        email_confirmed_at = now();
      `,
      user.id,
      user.email,
    )

    await prisma.$executeRawUnsafe(
      `DELETE FROM auth.identities WHERE user_id = $1::uuid;`,
      user.id,
    )

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        $1::uuid,
        $1::uuid,
        json_build_object('sub', $1::text, 'email', $2::text),
        'email',
        $2::text,
        now(),
        now(),
        now()
      );
      `,
      user.id,
      user.email,
    )
  }

  // 5. Seed Memberships
  console.log('Seeding memberships...')
  await prisma.membership.createMany({
    data: [
      {
        orgId: ORG_NORTHWIND,
        userId: USER_NORTHWIND_MANAGER,
        role: 'manager',
      },
      { orgId: ORG_NORTHWIND, userId: USER_NORTHWIND_STAFF, role: 'staff' },
      { orgId: ORG_BETA, userId: USER_BETA_MANAGER, role: 'manager' },
    ],
  })

  // 6. Seed Units
  console.log('Seeding property units...')
  await prisma.unit.createMany({
    data: [
      { id: UNIT_A_12_3, orgId: ORG_NORTHWIND, name: 'A-12-3' },
      { id: UNIT_B_05_1, orgId: ORG_NORTHWIND, name: 'B-05-1' },
      { id: UNIT_C_01_7, orgId: ORG_NORTHWIND, name: 'C-01-7' },
      { id: UNIT_D_03_2, orgId: ORG_NORTHWIND, name: 'D-03-2' }, // Vacant
      { id: UNIT_KL_1, orgId: ORG_BETA, name: 'KL-1' },
    ],
  })

  // 7. Seed Tenants
  console.log('Seeding tenants...')
  await prisma.tenant.createMany({
    data: [
      {
        id: TENANT_AISYAH,
        orgId: ORG_NORTHWIND,
        userId: USER_AISYAH,
        fullName: 'Aisyah Rahman',
        email: 'aisyah@northwind.test',
        phone: '+60123456781',
      },
      {
        id: TENANT_BEN,
        orgId: ORG_NORTHWIND,
        userId: USER_BEN,
        fullName: 'Ben Lim',
        email: 'ben@northwind.test',
        phone: '+60123456782',
      },
      {
        id: TENANT_PROBE,
        orgId: ORG_NORTHWIND,
        userId: USER_PROBE,
        fullName: 'Probe Tenant',
        email: 'probe@northwind.test',
        phone: '+60123456783',
      },
      {
        id: TENANT_CHEN,
        orgId: ORG_BETA,
        userId: USER_CHEN,
        fullName: 'Chen Wei',
        email: 'chen@beta.test',
        phone: '+60123456784',
      },
    ],
  })

  // 8. Seed Leases & Dynamic Invoices via generateSchedule
  console.log('Seeding leases and dynamic invoice schedules...')

  const leaseDefs = [
    {
      id: LEASE_AISYAH,
      orgId: ORG_NORTHWIND,
      unitId: UNIT_A_12_3,
      tenantId: TENANT_AISYAH,
      startDate: '2026-01-31',
      endDate: '2026-07-15',
      monthlyRentSen: 150000,
      depositSen: 300000,
    },
    {
      id: LEASE_BEN,
      orgId: ORG_NORTHWIND,
      unitId: UNIT_B_05_1,
      tenantId: TENANT_BEN,
      startDate: '2026-01-01',
      endDate: '2026-04-15',
      monthlyRentSen: 100029,
      depositSen: 0,
    },
    {
      id: LEASE_PROBE,
      orgId: ORG_NORTHWIND,
      unitId: UNIT_C_01_7,
      tenantId: TENANT_PROBE,
      startDate: '2026-02-28',
      endDate: '2027-02-27',
      monthlyRentSen: 200000,
      depositSen: 400000,
    },
    {
      id: LEASE_CHEN,
      orgId: ORG_BETA,
      unitId: UNIT_KL_1,
      tenantId: TENANT_CHEN,
      startDate: '2026-03-15',
      endDate: '2027-03-14',
      monthlyRentSen: 220000,
      depositSen: 440000,
    },
  ]

  for (const def of leaseDefs) {
    await prisma.lease.create({
      data: {
        id: def.id,
        orgId: def.orgId,
        unitId: def.unitId,
        tenantId: def.tenantId,
        startDate: new Date(def.startDate),
        endDate: new Date(def.endDate),
        monthlyRentSen: BigInt(def.monthlyRentSen),
        depositSen: BigInt(def.depositSen),
      },
    })

    const scheduledInvoices = generateSchedule({
      startDate: def.startDate,
      endDate: def.endDate,
      monthlyRentSen: def.monthlyRentSen,
      depositSen: def.depositSen,
    })

    for (const inv of scheduledInvoices) {
      await prisma.invoice.create({
        data: {
          orgId: def.orgId,
          leaseId: def.id,
          kind: inv.kind,
          periodIndex: inv.periodIndex,
          periodStart: inv.periodStart ? new Date(inv.periodStart) : null,
          periodEnd: inv.periodEnd ? new Date(inv.periodEnd) : null,
          dueDate: new Date(inv.dueDate),
          amountSen: BigInt(inv.amountSen),
        },
      })
    }
  }

  // 9. Seed Aisyah's Historical Payments & Waterfall Allocation
  console.log('Seeding payments and executing waterfall allocation...')

  // Payment 1: Cash 300,000 sen, received 2026-01-31 10:00 MYT (UTC+8 -> 2026-01-31T02:00:00.000Z)
  const payment1 = await prisma.payment.create({
    data: {
      id: PAYMENT_AISYAH_1,
      orgId: ORG_NORTHWIND,
      leaseId: LEASE_AISYAH,
      amountSen: BigInt(300000),
      unappliedSen: BigInt(300000),
      method: 'cash',
      status: 'approved',
      receivedAt: new Date('2026-01-31T02:00:00.000Z'),
    },
  })

  await prisma.$transaction(async (tx) => {
    await allocatePayment(tx, payment1.id)
  })

  await prisma.auditLog.create({
    data: {
      orgId: ORG_NORTHWIND,
      actorId: USER_NORTHWIND_MANAGER,
      action: 'payment.approved',
      entityId: payment1.id,
      details: {
        method: 'cash',
        amountSen: '300000',
        recordedBy: 'manager',
      },
    },
  })

  // Payment 2: Bank transfer 200,000 sen, received 2026-03-01 00:30 MYT (UTC+8 -> 2026-02-28T16:30:00.000Z)
  const payment2 = await prisma.payment.create({
    data: {
      id: PAYMENT_AISYAH_2,
      orgId: ORG_NORTHWIND,
      leaseId: LEASE_AISYAH,
      amountSen: BigInt(200000),
      unappliedSen: BigInt(200000),
      method: 'bank_transfer',
      status: 'approved',
      receivedAt: new Date('2026-02-28T16:30:00.000Z'),
      slipPath: `${ORG_NORTHWIND}/sample-slip.png`,
    },
  })

  await prisma.$transaction(async (tx) => {
    await allocatePayment(tx, payment2.id)
  })

  await prisma.auditLog.create({
    data: {
      orgId: ORG_NORTHWIND,
      actorId: USER_NORTHWIND_MANAGER,
      action: 'payment.approved',
      entityId: payment2.id,
      details: {
        method: 'bank_transfer',
        amountSen: '200000',
        recordedBy: 'staff',
        approvedBy: 'manager',
        slipPath: `${ORG_NORTHWIND}/sample-slip.png`,
      },
    },
  })

  console.log('✓ Database seeding completed successfully!')
}

seed()
  .catch((e) => {
    console.error('Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
