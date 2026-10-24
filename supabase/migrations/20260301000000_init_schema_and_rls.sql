-- 20260301000000_init_schema_and_rls.sql
-- Initial Schema, Constraints, Storage & Row Level Security (RLS)

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLES

-- organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- memberships
CREATE TABLE IF NOT EXISTS public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_memberships_user_org UNIQUE (user_id, org_id)
);

-- units
CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_units_org_name UNIQUE (org_id, name)
);

-- tenants
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- leases
CREATE TABLE IF NOT EXISTS public.leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  monthly_rent_sen bigint NOT NULL CHECK (monthly_rent_sen > 0),
  deposit_sen bigint NOT NULL CHECK (deposit_sen >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_lease_dates CHECK (end_date >= start_date)
);

-- invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deposit', 'rent')),
  period_index integer,
  period_start date,
  period_end date,
  due_date date NOT NULL,
  amount_sen bigint NOT NULL CHECK (amount_sen >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- payments
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  amount_sen bigint NOT NULL CHECK (amount_sen > 0),
  unapplied_sen bigint NOT NULL DEFAULT 0 CHECK (unapplied_sen >= 0),
  method text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'online')),
  status text NOT NULL CHECK (status IN ('pending_verification', 'approved', 'rejected', 'voided')),
  received_at timestamptz NOT NULL DEFAULT now(),
  slip_path text,
  gateway_bill_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- payment_allocations
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount_sen bigint NOT NULL CHECK (amount_sen > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- gateway_bills
CREATE TABLE IF NOT EXISTS public.gateway_bills (
  id text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  amount_sen bigint NOT NULL CHECK (amount_sen > 0),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- audit_log (Append-only)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  entity_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce append-only on audit_log
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON public.audit_log;
CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();

REVOKE UPDATE, DELETE ON public.audit_log FROM PUBLIC, anon, authenticated;

-- 3. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org_id ON public.memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_units_org_id ON public.units(org_id);
CREATE INDEX IF NOT EXISTS idx_tenants_org_id ON public.tenants(org_id);
CREATE INDEX IF NOT EXISTS idx_tenants_user_id ON public.tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_leases_org_id ON public.leases(org_id);
CREATE INDEX IF NOT EXISTS idx_leases_unit_id ON public.leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_tenant_id ON public.leases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_lease_id ON public.invoices(lease_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_lease_id ON public.payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON public.payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice_id ON public.payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_gateway_bills_lease_id ON public.gateway_bills(lease_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON public.audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);

-- 4. RLS HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.is_org_member(check_org_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.memberships
    WHERE memberships.user_id = auth.uid()
      AND memberships.org_id = check_org_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_org_manager(check_org_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.memberships
    WHERE memberships.user_id = auth.uid()
      AND memberships.org_id = check_org_id
      AND memberships.role = 'manager'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_lease_tenant(check_lease_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.id = check_lease_id
      AND t.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. ROW LEVEL SECURITY (RLS) POLICIES

-- organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their own organization"
  ON public.organizations FOR SELECT
  USING (public.is_org_member(id));

CREATE POLICY "Managers can update their own organization"
  ON public.organizations FOR UPDATE
  USING (public.is_org_manager(id))
  WITH CHECK (public.is_org_manager(id));

-- memberships
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view memberships in their organization"
  ON public.memberships FOR SELECT
  USING (public.is_org_member(org_id) OR user_id = auth.uid());

CREATE POLICY "Managers can manage memberships in their organization"
  ON public.memberships FOR ALL
  USING (public.is_org_manager(org_id))
  WITH CHECK (public.is_org_manager(org_id));

-- units
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view units in their organization"
  ON public.units FOR SELECT
  USING (public.is_org_member(org_id));

CREATE POLICY "Managers can manage units in their organization"
  ON public.units FOR ALL
  USING (public.is_org_manager(org_id))
  WITH CHECK (public.is_org_manager(org_id));

-- tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view tenants in their organization"
  ON public.tenants FOR SELECT
  USING (public.is_org_member(org_id) OR user_id = auth.uid());

CREATE POLICY "Members can insert or update tenants in their organization"
  ON public.tenants FOR ALL
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

-- leases
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and lease tenants can view leases"
  ON public.leases FOR SELECT
  USING (
    public.is_org_member(org_id)
    OR tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Managers can insert leases in their organization"
  ON public.leases FOR INSERT
  WITH CHECK (public.is_org_manager(org_id));

CREATE POLICY "Managers can update leases in their organization"
  ON public.leases FOR UPDATE
  USING (public.is_org_manager(org_id))
  WITH CHECK (public.is_org_manager(org_id));

-- invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and lease tenants can view invoices"
  ON public.invoices FOR SELECT
  USING (
    public.is_org_member(org_id)
    OR public.is_lease_tenant(lease_id)
  );

CREATE POLICY "Members can manage invoices in their organization"
  ON public.invoices FOR ALL
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

-- payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and lease tenants can view payments"
  ON public.payments FOR SELECT
  USING (
    public.is_org_member(org_id)
    OR public.is_lease_tenant(lease_id)
  );

CREATE POLICY "Staff and Managers can record payments"
  ON public.payments FOR INSERT
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "Managers can update payment status"
  ON public.payments FOR UPDATE
  USING (public.is_org_manager(org_id))
  WITH CHECK (public.is_org_manager(org_id));

-- payment_allocations
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and lease tenants can view allocations"
  ON public.payment_allocations FOR SELECT
  USING (
    public.is_org_member(org_id)
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_allocations.payment_id
        AND public.is_lease_tenant(p.lease_id)
    )
  );

CREATE POLICY "Members can insert allocations"
  ON public.payment_allocations FOR INSERT
  WITH CHECK (public.is_org_member(org_id));

-- gateway_bills
ALTER TABLE public.gateway_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and lease tenants can view gateway bills"
  ON public.gateway_bills FOR SELECT
  USING (
    public.is_org_member(org_id)
    OR public.is_lease_tenant(lease_id)
  );

CREATE POLICY "Lease tenants and members can create gateway bills"
  ON public.gateway_bills FOR INSERT
  WITH CHECK (
    public.is_org_member(org_id)
    OR public.is_lease_tenant(lease_id)
  );

CREATE POLICY "Members can update gateway bills"
  ON public.gateway_bills FOR UPDATE
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

-- audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view audit logs for their organization"
  ON public.audit_log FOR SELECT
  USING (public.is_org_member(org_id));

CREATE POLICY "Members can insert audit logs for their organization"
  ON public.audit_log FOR INSERT
  WITH CHECK (public.is_org_member(org_id));

-- 6. SUPABASE STORAGE BUCKET & POLICIES (payment-slips)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-slips',
  'payment-slips',
  false,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'application/pdf'];

-- Storage RLS: Manager and Staff of owning organization can upload (<org_id>/... pattern)
CREATE POLICY "Staff and Manager can upload payment slips"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'payment-slips'
    AND public.is_org_member((split_part(name, '/', 1))::uuid)
  );

-- Storage RLS: Manager and Staff of owning organization can read payment slips
CREATE POLICY "Staff and Manager can read payment slips"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'payment-slips'
    AND public.is_org_member((split_part(name, '/', 1))::uuid)
  );
