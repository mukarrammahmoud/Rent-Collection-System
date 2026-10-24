/**
 * Shared Authentication & Authorization Helper
 *
 * Resolves the caller identity from either:
 *   - Authorization: Bearer <token> header
 *   - Supabase SSR session cookies
 *
 * Returns a typed CallerContext or throws standard HTTP errors.
 */
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from './supabase'
import { PrismaClient } from '@prisma/client'
// @ts-expect-error Could not find a declaration file for module 'pg'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

// ---------------------------------------------------------------------------
// Prisma singleton (reused across requests in the same process)
// ---------------------------------------------------------------------------
let _prisma: PrismaClient | null = null
let _pool: Pool | null = null

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })
    const adapter = new PrismaPg(_pool)
    _prisma = new PrismaClient({ adapter })
  }
  return _prisma
}

// ---------------------------------------------------------------------------
// HTTP Error helpers
// ---------------------------------------------------------------------------
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function unauthorized(msg = 'Unauthorized'): HttpError {
  return new HttpError(401, msg)
}
export function forbidden(msg = 'Forbidden'): HttpError {
  return new HttpError(403, msg)
}
export function notFound(msg = 'Not found'): HttpError {
  return new HttpError(404, msg)
}

// ---------------------------------------------------------------------------
// Caller context types
// ---------------------------------------------------------------------------
export type StaffContext = {
  kind: 'staff'
  userId: string
  orgId: string
  role: 'manager' | 'staff'
}

export type TenantContext = {
  kind: 'tenant'
  userId: string
  tenantId: string
  orgId: string
}

export type CallerContext = StaffContext | TenantContext

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------
function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return null
}

// ---------------------------------------------------------------------------
// Core identity resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the authenticated caller from a request.
 * Supports both Bearer tokens and SSR session cookies.
 * Throws HttpError(401) if unauthenticated.
 */
export async function getCallerContext(req: NextRequest): Promise<CallerContext> {
  const supabase = await createSupabaseServerClient()
  const prisma = getPrisma()

  // Try Bearer token first, then fall back to cookie session
  const token = extractBearerToken(req)
  let userId: string

  if (token) {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) {
      throw unauthorized()
    }
    userId = data.user.id
  } else {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      throw unauthorized()
    }
    userId = data.user.id
  }

  // Check memberships table first (staff/manager)
  const membership = await prisma.membership.findFirst({
    where: { userId },
  })

  if (membership) {
    return {
      kind: 'staff',
      userId,
      orgId: membership.orgId,
      role: membership.role as 'manager' | 'staff',
    }
  }

  // Check tenants table
  const tenant = await prisma.tenant.findFirst({
    where: { userId },
  })

  if (tenant) {
    return {
      kind: 'tenant',
      userId,
      tenantId: tenant.id,
      orgId: tenant.orgId,
    }
  }

  throw unauthorized('No membership or tenant record found')
}

/**
 * Requires the caller to be a staff/manager of any org.
 * Throws 403 if tenant.
 */
export async function requireStaff(req: NextRequest): Promise<StaffContext> {
  const ctx = await getCallerContext(req)
  if (ctx.kind !== 'staff') {
    throw forbidden()
  }
  return ctx
}

/**
 * Requires the caller to be a manager.
 * Throws 403 if staff (non-manager) or tenant.
 */
export async function requireManager(req: NextRequest): Promise<StaffContext> {
  const ctx = await getCallerContext(req)
  if (ctx.kind !== 'staff' || ctx.role !== 'manager') {
    throw forbidden()
  }
  return ctx
}

/**
 * Converts HttpError to a Response object.
 */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status })
  }
  console.error('Unhandled error:', err)
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}
