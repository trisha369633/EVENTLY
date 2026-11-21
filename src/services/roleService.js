import { getSupabaseClient } from '../lib/supabase.js'

const supportedRoles = new Set(['super_admin', 'participant', 'volunteer'])

export async function getPlatformRoles(userId) {
  const { data, error } = await getSupabaseClient()
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)

  if (error) throw error
  return [...new Set((data || []).map(({ role }) => role).filter((role) => supportedRoles.has(role)))]
}

export async function requireSuperAdmin() {
  const { data, error } = await getSupabaseClient().auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Sign in to continue.')
  const roles = await getPlatformRoles(data.user.id)
  if (!roles.includes('super_admin')) {
    throw new Error('Only super admins can access administrative data.')
  }
  return data.user
}

export async function searchAdminUsers({
  search = '',
  role = null,
  limit = 50,
  offset = 0,
} = {}) {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('admin_search_users', {
    p_search: String(search || '').trim(),
    p_role_filter: role || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  const users = data || []
  return { users, count: Number(users[0]?.total_count || 0) }
}

export async function setVolunteerRole({ userId, active }) {
  await requireSuperAdmin()
  const { error } = await getSupabaseClient().rpc('admin_set_volunteer_role', {
    p_user_id: userId,
    p_is_active: Boolean(active),
  })
  if (error) throw error
}
