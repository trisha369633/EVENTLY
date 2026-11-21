import { getSupabaseClient } from '../lib/supabase.js'

export class IdentityAlreadyExistsError extends Error {
  code = 'IDENTITY_ALREADY_EXISTS'
}

export async function getUserIdentity(userId) {
  const { data, error } = await getSupabaseClient()
    .from('user_identities')
    .select('identity_type, identity_number, is_verified, institution_id, department_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function ensureUserIdentity(user) {
  const metadata = user.user_metadata || {}
  const identityType = String(metadata.identity_type || '').toLowerCase()
  const identityNumber = String(metadata.identity_number || '').trim()
  const institutionId = metadata.institution_id

  if (!identityType || !identityNumber || !institutionId) return null

  const existing = await getUserIdentity(user.id)
  if (existing) return existing

  const { error } = await getSupabaseClient()
    .from('user_identities')
    .insert({
      user_id: user.id,
      institution_id: institutionId,
      department_id: metadata.department_id || null,
      identity_type: identityType,
      identity_number: identityNumber,
      is_verified: false,
    })

  if (error?.code === '23505') {
    const sameUserIdentity = await getUserIdentity(user.id)
    if (sameUserIdentity) return sameUserIdentity
    throw new IdentityAlreadyExistsError()
  }
  if (error) throw error

  return getUserIdentity(user.id)
}
