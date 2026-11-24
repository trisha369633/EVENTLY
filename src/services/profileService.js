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

export async function getParticipantProfileEditorData(userId) {
  const client = getSupabaseClient()
  const [profileResult, identityResult, institutionsResult, departmentsResult] = await Promise.all([
    client.from('profiles').select('id, full_name, email, phone').eq('id', userId).maybeSingle(),
    client.from('user_identities')
      .select('id, identity_type, institution_id, department_id, identity_number, is_verified')
      .eq('user_id', userId)
      .maybeSingle(),
    client.from('institutions').select('id, name').eq('is_active', true).order('name'),
    client.from('departments')
      .select('id, institution_id, name, code')
      .eq('is_active', true)
      .order('name'),
  ])

  if (profileResult.error) throw profileResult.error
  if (identityResult.error) throw identityResult.error
  if (institutionsResult.error) throw institutionsResult.error
  if (departmentsResult.error) throw departmentsResult.error

  return {
    profile: profileResult.data,
    identity: identityResult.data,
    institutions: institutionsResult.data || [],
    departments: departmentsResult.data || [],
  }
}

export async function saveParticipantProfileIdentity(input) {
  const { error } = await getSupabaseClient().rpc('upsert_my_participant_profile_identity', {
    p_full_name: input.full_name.trim(),
    p_phone: input.phone.trim() || null,
    p_identity_type: input.identity_type || null,
    p_institution_id: input.institution_id || null,
    p_department_id: input.department_id || null,
    p_identity_number: input.identity_number.trim() || null,
  })

  if (error) throw error
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
