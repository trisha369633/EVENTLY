import { getSupabaseClient } from '../lib/supabase.js'
import { getAdminEventsByIds } from './eventService.js'
import { getAdminOrganizationLabels } from './profileService.js'
import { getPlatformRoles, requireSuperAdmin } from './roleService.js'

const REGISTRATION_COLUMNS = [
  'id',
  'event_id',
  'user_id',
  'full_name',
  'email',
  'phone',
  'participant_type',
  'institution_id',
  'department_id',
  'identity_number',
  'form_answers',
  'fee_amount',
  'registration_status',
  'registered_at',
].join(', ')

const ADMIN_REGISTRATION_COLUMNS = [
  'id',
  'event_id',
  'full_name',
  'email',
  'phone',
  'participant_type',
  'institution_id',
  'department_id',
  'identity_number',
  'fee_amount',
  'registration_status',
  'registered_at',
].join(', ')

const REPORT_REGISTRATION_COLUMNS = [
  'id',
  'event_id',
  'user_id',
  'participant_type',
  'institution_id',
  'department_id',
  'fee_amount',
  'registration_status',
  'registered_at',
].join(', ')

const PARTICIPANT_REGISTRATION_COLUMNS = [
  'id',
  'event_id',
  'user_id',
  'full_name',
  'email',
  'phone',
  'participant_type',
  'institution_id',
  'department_id',
  'fee_amount',
  'registration_status',
  'registered_at',
].join(', ')

const reportPageSize = 1000

async function getCurrentUserId() {
  const { data, error } = await getSupabaseClient().auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Sign in to continue.')
  return data.user.id
}

export async function registerForEvent(registrationData) {
  await getCurrentUserId()
  const { data, error } = await getSupabaseClient().rpc('register_event_with_guests', {
    p_event_id: Number(registrationData.event_id),
    p_full_name: registrationData.full_name.trim(),
    p_email: registrationData.email.trim().toLowerCase(),
    p_phone: registrationData.phone.trim(),
    p_participant_type: registrationData.participant_type,
    p_institution_id: Number(registrationData.institution_id),
    p_department_id: registrationData.department_id ? Number(registrationData.department_id) : null,
    p_identity_number: registrationData.identity_number.trim(),
    p_form_answers: registrationData.form_answers || {},
    p_guests: registrationData.guests || [],
  })
  if (error) throw error
  const registration = Array.isArray(data) ? data[0] : data
  if (!registration) throw new Error('The database did not confirm the registration.')
  return registration
}

export async function getMyRegistrations() {
  const userId = await getCurrentUserId()
  const { data, error } = await getSupabaseClient()
    .from('event_registrations')
    .select(REGISTRATION_COLUMNS)
    .eq('user_id', userId)
    .order('registered_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getMyRegisteredEventDetails() {
  const { data, error } = await getSupabaseClient().rpc('get_my_registered_event_details')
  if (error) throw error
  return data || []
}

export async function getRegistrationByEvent(eventId) {
  const userId = await getCurrentUserId()
  const { data, error } = await getSupabaseClient()
    .from('event_registrations')
    .select(REGISTRATION_COLUMNS)
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getEventRegistrations(eventId) {
  const userId = await getCurrentUserId()
  const roles = await getPlatformRoles(userId)
  if (!roles.includes('super_admin')) {
    throw new Error('Only super admins can view event registrations.')
  }

  const { data, error } = await getSupabaseClient()
    .from('event_registrations')
    .select(REGISTRATION_COLUMNS)
    .eq('event_id', eventId)
    .order('registered_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getAdminRegistrations({
  page = 0,
  pageSize = 20,
  search = '',
  eventId = '',
  participantType = '',
  status = '',
} = {}) {
  await requireSuperAdmin()

  let query = getSupabaseClient()
    .from('event_registrations')
    .select(ADMIN_REGISTRATION_COLUMNS, { count: 'exact' })
    .order('registered_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)

  if (eventId) query = query.eq('event_id', eventId)
  if (participantType) query = query.eq('participant_type', participantType)
  if (status) query = query.eq('registration_status', status)
  const safeSearch = String(search).replace(/[,%()_*\\\r\n]/g, ' ').trim().slice(0, 100)
  if (safeSearch) {
    const pattern = `*${safeSearch}*`
    query = query.or([
      `full_name.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      `phone.ilike.${pattern}`,
      `identity_number.ilike.${pattern}`,
    ].join(','))
  }

  const { data, error, count } = await query
  if (error) throw error
  const rows = data || []
  const [events, labels] = await Promise.all([
    getAdminEventsByIds(rows.map((row) => row.event_id)),
    getAdminOrganizationLabels(
      rows.map((row) => row.institution_id),
      rows.map((row) => row.department_id),
    ),
  ])
  const eventById = new Map(events.map((event) => [String(event.id), event]))
  return {
    registrations: rows.map((row) => ({
      ...row,
      event: eventById.get(String(row.event_id)) || null,
      institution_name: labels.institutions.get(String(row.institution_id)) || '—',
      department_name: labels.departments.get(String(row.department_id)) || '—',
    })),
    count: count || 0,
  }
}

export async function getAdminReportRegistrations(filters = {}, { includeParticipantData = false } = {}) {
  await requireSuperAdmin()
  const columns = includeParticipantData ? PARTICIPANT_REGISTRATION_COLUMNS : REPORT_REGISTRATION_COLUMNS
  const rows = []
  let offset = 0

  while (true) {
    let query = getSupabaseClient()
      .from('event_registrations')
      .select(columns)
      .order('registered_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + reportPageSize - 1)

    if (filters.eventId) query = query.eq('event_id', filters.eventId)
    if (filters.registrationIds?.length) query = query.in('id', filters.registrationIds)
    if (filters.institutionId) query = query.eq('institution_id', filters.institutionId)
    if (filters.departmentId) query = query.eq('department_id', filters.departmentId)
    if (filters.participantType) query = query.eq('participant_type', filters.participantType)
    if (filters.status) query = query.eq('registration_status', filters.status)
    if (filters.userId) query = query.eq('user_id', filters.userId)
    if (filters.start) query = query.gte('registered_at', filters.start)
    if (filters.endExclusive) query = query.lt('registered_at', filters.endExclusive)
    if (includeParticipantData && filters.search) {
      const safeSearch = String(filters.search).replace(/[,%()_*\\\r\n]/g, ' ').trim().slice(0, 100)
      if (safeSearch) {
        const pattern = `*${safeSearch}*`
        query = query.or([
          `full_name.ilike.${pattern}`,
          `email.ilike.${pattern}`,
          `phone.ilike.${pattern}`,
          `identity_number.ilike.${pattern}`,
        ].join(','))
      }
    }

    const { data, error } = await query
    if (error) throw error
    const pageRows = data || []
    rows.push(...pageRows)
    if (pageRows.length < reportPageSize) break
    offset += reportPageSize
  }

  if (!rows.length) return []
  const [events, labels] = await Promise.all([
    getAdminEventsByIds(rows.map((row) => row.event_id)),
    getAdminOrganizationLabels(
      rows.map((row) => row.institution_id),
      rows.map((row) => row.department_id),
    ),
  ])
  const eventById = new Map(events.map((event) => [String(event.id), event]))
  return rows.map((row) => ({
    ...row,
    event: eventById.get(String(row.event_id)) || null,
    institution_name: labels.institutions.get(String(row.institution_id)) || '—',
    department_name: labels.departments.get(String(row.department_id)) || '—',
  }))
}

export async function getRecentAdminRegistrations(limit = 5) {
  const result = await getAdminRegistrations({ page: 0, pageSize: limit })
  return result.registrations
}

export async function getAdminRegistrationTotal() {
  await requireSuperAdmin()
  const { count, error } = await getSupabaseClient()
    .from('event_registrations')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

export { REGISTRATION_COLUMNS }