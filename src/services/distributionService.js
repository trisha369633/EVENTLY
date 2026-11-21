import { getSupabaseClient } from '../lib/supabase.js'
import { requireSuperAdmin } from './roleService.js'

let subscriptionSequence = 0

export function createDistributionRequestId() {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure request IDs are unavailable in this browser.')
  }
  if (cryptoApi.randomUUID) return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function callRpc(name, parameters) {
  const { data, error } = await getSupabaseClient().rpc(name, parameters)
  if (error) throw error
  return data
}

export async function getAdminDistributionSummary(eventId = '') {
  await requireSuperAdmin()
  const rows = await callRpc('get_admin_distribution_summary', {
    p_event_id: eventId ? Number(eventId) : null,
  })
  const summary = rows?.[0]
  if (!summary) throw new Error('The database did not return distribution analytics.')
  return summary
}

export async function getAdminContinuousDistributionSummary(eventId = '') {
  await requireSuperAdmin()
  return (await callRpc('get_admin_continuous_distribution_summary', {
    p_event_id: eventId ? Number(eventId) : null,
  })) || []
}

export async function getAdminDistributionItems(eventId = '') {
  await requireSuperAdmin()
  return (await callRpc('get_admin_distribution_items', {
    p_event_id: eventId ? Number(eventId) : null,
  })) || []
}

export async function getAdminDistributionHistory({
  eventId = '',
  itemId = '',
  volunteerUserId = '',
  status = '',
  limit = 50,
  offset = 0,
} = {}) {
  await requireSuperAdmin()
  return (await callRpc('get_admin_distribution_history', {
    p_event_id: eventId ? Number(eventId) : null,
    p_item_id: itemId ? Number(itemId) : null,
    p_volunteer_user_id: volunteerUserId || null,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  })) || []
}

export async function getAdminDistributionVolunteerActivity(eventId = '', itemId = '') {
  await requireSuperAdmin()
  return (await callRpc('get_admin_distribution_volunteer_activity', {
    p_event_id: eventId ? Number(eventId) : null,
    p_item_id: itemId ? Number(itemId) : null,
  })) || []
}

export async function getDistributionItemVolunteers(itemId) {
  await requireSuperAdmin()
  return (await callRpc('get_distribution_item_volunteers', {
    p_item_id: Number(itemId),
  })) || []
}

export async function setDistributionItemVolunteer({ itemId, volunteerUserId, active }) {
  await requireSuperAdmin()
  await callRpc('set_distribution_item_volunteer', {
    p_item_id: Number(itemId),
    p_volunteer_user_id: volunteerUserId,
    p_is_active: Boolean(active),
  })
}

export async function saveDistributionItem(item) {
  await requireSuperAdmin()
  const rows = await callRpc('save_event_distribution_item', {
    p_item_id: item.id ? Number(item.id) : null,
    p_event_id: Number(item.eventId),
    p_item_name: item.itemName,
    p_description: item.description || null,
    p_total_quantity: Number(item.totalQuantity),
    p_max_per_participant: Number(item.maxPerParticipant),
    p_distribution_starts_at: item.startsAt || null,
    p_distribution_ends_at: item.endsAt || null,
    p_distribution_location: item.location || null,
    p_is_active: Boolean(item.isActive),
  })
  const itemId = rows
  if (typeof itemId !== 'number' && typeof itemId !== 'string') {
    throw new Error('The database did not return the saved distribution item.')
  }
  return String(itemId)
}

export async function correctEventDistribution({ recordId, quantity, reason }) {
  await requireSuperAdmin()
  return callRpc('correct_event_distribution', {
    p_distribution_record_id: recordId,
    p_quantity: Number(quantity),
    p_reason: reason,
    p_request_id: createDistributionRequestId(),
  })
}

export async function getMyDistributionEvents() {
  return (await callRpc('get_my_distribution_events')) || []
}

export async function getMyDistributionItems() {
  return (await callRpc('get_my_distribution_items')) || []
}

export async function getMyEventDistributionBenefits(eventId = '') {
  return (await callRpc('get_my_event_distribution_benefits', {
    p_event_id: eventId ? Number(eventId) : null,
  })) || []
}

export async function getMyDistributionRecentActivity(limit = 10) {
  return (await callRpc('get_my_distribution_recent_activity', {
    p_limit: limit,
  })) || []
}

export async function getDistributionChecklist({ eventId, token }) {
  return (await callRpc('get_distribution_checklist', {
    p_event_id: Number(eventId),
    p_token: String(token || '').trim(),
  })) || []
}

export async function recordEventDistribution({
  eventId,
  itemId,
  token,
  quantity,
  requestId = createDistributionRequestId(),
}) {
  const rows = await callRpc('record_event_distribution', {
    p_event_id: Number(eventId),
    p_item_id: Number(itemId),
    p_token: String(token || '').trim(),
    p_quantity: Number(quantity),
    p_request_id: requestId,
  })
  const record = rows?.[0]
  if (!record) throw new Error('The database did not confirm the item distribution.')
  return record
}

export async function recordContinuousEventDistribution({
  eventId,
  token,
  itemIds,
  requestId = createDistributionRequestId(),
}) {
  const rows = await callRpc('record_continuous_event_distribution', {
    p_event_id: Number(eventId),
    p_token: String(token || '').trim(),
    p_item_ids: itemIds.map((itemId) => Number(itemId)),
    p_request_id: requestId,
  })
  if (!rows?.length) {
    throw new Error('The database did not confirm the scan session.')
  }
  return rows
}

export async function recordContinuousAttendeeDistribution({
  eventId,
  token,
  itemIds,
  requestId = createDistributionRequestId(),
}) {
  const rows = await callRpc('record_continuous_attendee_distribution', {
    p_event_id: Number(eventId),
    p_token: String(token || '').trim(),
    p_item_ids: itemIds.map((itemId) => Number(itemId)),
    p_request_id: requestId,
  })
  return rows || []
}

export async function setDistributionItemGuestEligibility({ itemId, guestEligible }) {
  await requireSuperAdmin()
  await callRpc('set_distribution_item_guest_eligibility', {
    p_item_id: Number(itemId),
    p_guest_eligible: Boolean(guestEligible),
  })
}

export function subscribeToDistributionUpdates({ eventId = '', onChange, onStatus }) {
  const client = getSupabaseClient()
  const eventFilter = /^\d+$/.test(String(eventId))
    ? `event_id=eq.${eventId}`
    : undefined
  const channel = client.channel(`evently-distributions-${++subscriptionSequence}`)
  const tables = [
    'event_distribution_items',
    'event_distribution_item_volunteers',
    'event_distribution_records',
    'event_distribution_corrections',
  ]

  for (const table of tables) {
    const filter = { event: '*', schema: 'public', table }
    if (eventFilter) filter.filter = eventFilter
    channel.on('postgres_changes', filter, onChange)
  }

  channel.subscribe((status, error) => onStatus?.(status, error))
  return channel
}