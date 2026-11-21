import { getSupabaseClient } from '../lib/supabase.js'
import { requireSuperAdmin } from './roleService.js'

const EVENT_COLUMNS = [
  'id',
  'title',
  'slug',
  'short_description',
  'description',
  'cover_image_url',
  'institution_id',
  'department_id',
  'venue',
  'event_mode',
  'event_start',
  'event_end',
  'registration_deadline',
  'student_fee',
  'teacher_fee',
  'alumni_fee',
  'seat_limit',
  'status',
  'custom_form_fields',
  'created_by',
  'created_at',
  'updated_at',
].join(', ')

function uniqueIds(rows, column) {
  return [...new Set(rows.map((row) => row[column]).filter(Boolean))]
}

async function addEventLabels(events) {
  if (!events.length) return []

  const client = getSupabaseClient()
  const institutionIds = uniqueIds(events, 'institution_id')
  const departmentIds = uniqueIds(events, 'department_id')
  const [institutionsResult, departmentsResult] = await Promise.all([
    institutionIds.length
      ? client.from('institutions').select('id, name').in('id', institutionIds)
      : Promise.resolve({ data: [], error: null }),
    departmentIds.length
      ? client.from('departments').select('id, name').in('id', departmentIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (institutionsResult.error) throw institutionsResult.error
  if (departmentsResult.error) throw departmentsResult.error

  const institutions = new Map((institutionsResult.data || []).map((row) => [row.id, row.name]))
  const departments = new Map((departmentsResult.data || []).map((row) => [row.id, row.name]))
  return events.map((event) => ({
    ...event,
    institution_name: institutions.get(event.institution_id) || 'University',
    department_name: departments.get(event.department_id) || '',
  }))
}

export async function getPublishedEvents() {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select(EVENT_COLUMNS)
    .ilike('status', 'published')
    .order('event_start', { ascending: true })

  if (error) throw error
  return addEventLabels(data || [])
}

export async function getPublishedEventBySlug(slug) {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('slug', slug)
    .ilike('status', 'published')
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return (await addEventLabels([data]))[0]
}

export async function getOwnRegisteredEventBySlug(slug) {
  const { data, error } = await getSupabaseClient().rpc('get_my_registered_event_details')
  if (error) throw error
  const row = (data || []).find((event) => event.slug === slug)
  if (!row) return null
  const { event_status: status, ...event } = row
  return (await addEventLabels([{ ...event, status }]))[0]
}

export async function getAdminEventById(eventId) {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('id', eventId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return (await addEventLabels([data]))[0]
}

export async function getAdminEvents() {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .select(EVENT_COLUMNS)
    .order('event_start', { ascending: true })

  if (error) throw error
  return addEventLabels(data || [])
}

export async function getAdminEventsByIds(eventIds) {
  const ids = [...new Set(eventIds.map(String).filter((id) => /^\d+$/.test(id)))]
  if (!ids.length) return []

  const { data, error } = await getSupabaseClient()
    .from('events')
    .select('id, title, slug, institution_id, department_id')
    .in('id', ids)
  if (error) throw error
  return addEventLabels(data || [])
}

export async function createEvent(eventData) {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .insert(eventData)
    .select(EVENT_COLUMNS)
    .single()

  if (error) throw error
  return (await addEventLabels([data]))[0]
}

export async function updateEvent(eventId, eventData) {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .update({ ...eventData, updated_at: new Date().toISOString() })
    .eq('id', eventId)
    .select(EVENT_COLUMNS)
    .single()

  if (error) throw error
  return (await addEventLabels([data]))[0]
}

export async function updateEventStatus(eventId, status) {
  const { data, error } = await getSupabaseClient()
    .from('events')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', eventId)
    .select('id, status')
    .single()

  if (error) throw error
  return data
}

export async function getEventGuestSettings(eventId) {
  const { data, error } = await getSupabaseClient().rpc('get_event_guest_settings', {
    p_event_id: Number(eventId),
  })
  if (error) throw error
  return data || []
}

export async function saveEventGuestSettings({
  eventId,
  isEnabled,
  maxGuestsPerParticipant,
  totalGuestLimit,
  guestDistributionEnabled,
  relationshipFees,
}) {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('save_event_guest_settings', {
    p_event_id: Number(eventId),
    p_is_enabled: Boolean(isEnabled),
    p_max_guests_per_participant: Number(maxGuestsPerParticipant),
    p_total_guest_limit: Number(totalGuestLimit),
    p_guest_distribution_enabled: Boolean(guestDistributionEnabled),
    p_relationship_fees: relationshipFees,
  })
  if (error) throw error
  return data?.[0] || null
}

export async function isEventSlugAvailable(slug, excludeEventId = null) {
  let query = getSupabaseClient()
    .from('events')
    .select('id')
    .eq('slug', slug)
    .limit(1)
  if (excludeEventId !== null) query = query.neq('id', excludeEventId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return !data
}

export async function getPublicRegistrationCounts(eventIds) {
  const ids = [...new Set(eventIds.map(String).filter((id) => /^\d+$/.test(id)))]
  if (!ids.length) return {}

  const { data, error } = await getSupabaseClient().rpc(
    'get_public_event_registration_counts',
    { p_event_ids: ids },
  )
  if (error) throw error
  return Object.fromEntries((data || []).map(({ event_id, registration_count }) => [
    String(event_id),
    Number(registration_count),
  ]))
}

export async function getEventRegistrationCount(eventId) {
  const counts = await getPublicRegistrationCounts([eventId])
  return counts[String(eventId)] ?? 0
}

export async function getAdminRegistrationCounts(eventIds) {
  await requireSuperAdmin()
  const ids = [...new Set(eventIds.map(String).filter((id) => /^\d+$/.test(id)))]
  if (!ids.length) return {}

  const results = await Promise.all(ids.map(async (id) => {
    const { count, error } = await getSupabaseClient()
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', id)
      .eq('registration_status', 'registered')
    if (error) throw error
    return [id, count || 0]
  }))
  return Object.fromEntries(results)
}

export const getEventBySlug = getPublishedEventBySlug
export { EVENT_COLUMNS }