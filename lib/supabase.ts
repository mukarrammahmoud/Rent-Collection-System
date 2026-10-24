/**
 * Supabase Server Client Factory
 *
 * Creates a Supabase client that reads cookies from Next.js headers
 * for SSR session support. Also exports a service-role admin client.
 */
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Returns a Supabase client bound to the current request's cookie store.
 * Used inside Route Handlers and Server Components.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // setAll called from a Server Component; cookies may be read-only.
        }
      },
    },
  })
}

/**
 * Service-role admin client. Bypasses RLS.
 * ONLY use for webhook handlers and internal operations.
 */
export function createSupabaseAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })
}
