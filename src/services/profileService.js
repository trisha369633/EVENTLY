import { getSupabaseClient } from '../lib/supabase.js'
import { requireSuperAdmin } from './roleService.js'

export async function getProfile(userId) {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id, full_name, email, phone, avatar_url, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function listInstitutions() {
  const { data, error } = await getSupabaseClient()
    .from('institutions')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data
}

export async function listDepartments(institutionId) {
  const { data, error } = await getSupabaseClient()
    .from('departments')
    .select('id, name, institution_id')
    .eq('institution_id', institutionId)
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data
}

export async function getAdminOrganizationLabels(institutionIds, departmentIds) {
  await requireSuperAdmin()
  const client = getSupabaseClient()
  const uniqueInstitutions = [...new Set(institutionIds.filter(Boolean))]
  const uniqueDepartments = [...new Set(departmentIds.filter(Boolean))]
  const [institutionsResult, departmentsResult] = await Promise.all([
    uniqueInstitutions.length
      ? client.from('institutions').select('id, name').in('id', uniqueInstitutions)
      : Promise.resolve({ data: [], error: null }),
    uniqueDepartments.length
      ? client.from('departments').select('id, name').in('id', uniqueDepartments)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (institutionsResult.error) throw institutionsResult.error
  if (departmentsResult.error) throw departmentsResult.error
  return {
    institutions: new Map((institutionsResult.data || []).map((item) => [String(item.id), item.name])),
    departments: new Map((departmentsResult.data || []).map((item) => [String(item.id), item.name])),
  }
}
