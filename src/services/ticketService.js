import { getSupabaseClient } from '../lib/supabase.js'
import { requireSuperAdmin } from './roleService.js'

export async function getMyEventTickets() {
  const { data, error } = await getSupabaseClient().rpc('get_my_event_tickets')
  if (error) throw error
  return data || []
}

export async function getMyAttendeeTickets() {
  const { data, error } = await getSupabaseClient().rpc('get_my_attendee_tickets')
  if (error) throw error
  return data || []
}

export async function getEventTicketPassMeta(ticketId) {
  const { data, error } = await getSupabaseClient().rpc('get_event_ticket_pass_meta', {
    p_ticket_id: Number(ticketId),
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data || null
}

export async function validateAttendeeTicket({ eventId, token }) {
  const { data, error } = await getSupabaseClient().rpc('validate_attendee_ticket', {
    p_event_id: Number(eventId),
    p_token: String(token || '').trim(),
  })
  if (error) throw error
  return data?.[0] || null
}

export async function checkInAttendeeTicket({ eventId, token }) {
  const { data, error } = await getSupabaseClient().rpc('check_in_attendee_ticket', {
    p_event_id: Number(eventId),
    p_token: String(token || '').trim(),
  })
  if (error) throw error
  return data?.[0] || null
}

export async function getTicketScannerEvents() {
  const { data, error } = await getSupabaseClient().rpc('get_ticket_scanner_events')
  if (error) throw error
  return data || []
}

export async function checkInEventTicket({ eventId, token }) {
  const { data, error } = await getSupabaseClient().rpc('check_in_event_ticket', {
    p_event_id: Number(eventId),
    p_token: String(token || '').trim(),
  })
  if (error) throw error
  const result = data?.[0]
  if (!result) throw new Error('The database did not return a ticket validation result.')
  return result
}

export async function getAdminTicketSummary(eventId = '') {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('get_admin_ticket_summary', {
    p_event_id: eventId ? Number(eventId) : null,
  })
  if (error) throw error
  const summary = data?.[0]
  if (!summary) throw new Error('The database did not return ticket statistics.')
  return summary
}

export async function getAdminEventTickets({
  eventId = '',
  status = '',
  search = '',
  limit = 20,
  offset = 0,
} = {}) {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('get_admin_event_tickets', {
    p_event_id: eventId ? Number(eventId) : null,
    p_status: status || null,
    p_search: String(search || '').trim() || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  const tickets = data || []
  return { tickets, count: Number(tickets[0]?.total_count || 0) }
}

export async function getAdminTicketRecords({
  eventId = '',
  status = '',
  search = '',
  limit = 20,
  offset = 0,
} = {}) {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('get_admin_ticket_records', {
    p_event_id: eventId ? Number(eventId) : null,
    p_status: status || null,
    p_search: String(search || '').trim() || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  const tickets = data || []
  return { tickets, count: Number(tickets[0]?.total_count || 0) }
}

export async function getTicketVolunteerCandidates() {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('list_ticket_volunteer_candidates')
  if (error) throw error
  return data || []
}

export async function getEventTicketAssignments(eventId) {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('get_event_ticket_assignments', {
    p_event_id: Number(eventId),
  })
  if (error) throw error
  return data || []
}

export async function assignEventTicketVolunteer({ eventId, volunteerUserId }) {
  await requireSuperAdmin()
  const { error } = await getSupabaseClient().rpc('assign_event_ticket_volunteer', {
    p_event_id: Number(eventId),
    p_volunteer_user_id: volunteerUserId,
  })
  if (error) throw error
}

export async function revokeEventTicketVolunteer({ eventId, volunteerUserId }) {
  await requireSuperAdmin()
  const { error } = await getSupabaseClient().rpc('revoke_event_ticket_volunteer', {
    p_event_id: Number(eventId),
    p_volunteer_user_id: volunteerUserId,
  })
  if (error) throw error
}

export async function revokeEventTicket(ticketId) {
  await requireSuperAdmin()
  const { error } = await getSupabaseClient().rpc('revoke_event_ticket', {
    p_ticket_id: ticketId,
  })
  if (error) throw error
}
