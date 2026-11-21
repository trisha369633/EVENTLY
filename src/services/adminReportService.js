import { getAdminPaymentReportPage } from './paymentService.js'
import {
  getAdminDistributionHistory,
  getAdminDistributionItems,
  getDistributionItemVolunteers,
} from './distributionService.js'
import { getAdminEvents } from './eventService.js'
import { getEventTicketAssignments, getTicketVolunteerCandidates } from './ticketService.js'
import { requireSuperAdmin } from './roleService.js'
import { getSupabaseClient } from '../lib/supabase.js'

export async function getAdminReportEvents() {
  await requireSuperAdmin()
  return getAdminEvents()
}

export async function getAllAdminPaymentReportRows(filters = {}, pageSize = 500) {
  const rows = []
  let page = 0
  while (true) {
    const result = await getAdminPaymentReportPage({ ...filters, page, pageSize })
    rows.push(...result.payments)
    if (rows.length >= result.count || result.payments.length < pageSize) return rows
    page += 1
  }
}

export async function getAllAdminDistributionHistory(filters = {}, pageSize = 100) {
  const rows = []
  let offset = 0
  while (true) {
    const page = await getAdminDistributionHistory({
      ...filters,
      limit: pageSize,
      offset,
    })
    rows.push(...page)
    if (page.length < pageSize) return rows
    offset += pageSize
  }
}

export async function getAdminParticipantBenefitStatus({
  eventId = '',
  itemId = '',
  status = 'all',
  limit = 100,
  offset = 0,
} = {}) {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc(
    'get_admin_participant_benefit_status',
    {
      p_event_id: eventId ? Number(eventId) : null,
      p_item_id: itemId ? Number(itemId) : null,
      p_status: status && status !== 'all' ? status : null,
      p_limit: Number(limit),
      p_offset: Number(offset),
    },
  )
  if (error) throw error
  return data || []
}

export async function getAllAdminParticipantBenefitStatus(filters = {}, pageSize = 100) {
  const rows = []
  let offset = 0
  while (true) {
    const page = await getAdminParticipantBenefitStatus({
      ...filters,
      limit: pageSize,
      offset,
    })
    rows.push(...page)
    if (page.length < pageSize) return rows
    offset += pageSize
  }
}

async function inBatches(values, batchSize, worker) {
  const results = []
  for (let offset = 0; offset < values.length; offset += batchSize) {
    const batch = values.slice(offset, offset + batchSize)
    results.push(...await Promise.all(batch.map(worker)))
  }
  return results
}

export async function getAdminVolunteerActivityData() {
  await requireSuperAdmin()
  const [events, volunteers] = await Promise.all([
    getAdminEvents(),
    getTicketVolunteerCandidates(),
  ])
  const eventAssignments = await inBatches(events, 8, async (event) => ({
    eventId: String(event.id),
    eventTitle: event.title,
    assignments: await getEventTicketAssignments(event.id),
  }))
  let distributionItems = null
  let distributionError = ''
  let itemAssignments = []
  let itemAssignmentError = ''
  try {
    distributionItems = await getAdminDistributionItems()
    itemAssignments = await inBatches(distributionItems, 8, async (item) => ({
      itemId: String(item.item_id),
      eventId: String(item.event_id),
      itemName: item.item_name,
      assignments: await getDistributionItemVolunteers(item.item_id),
    }))
  } catch (error) {
    const message = getReportUnavailableMessage(error, 'Distribution-item assignments')
    if (distributionItems === null) distributionError = message
    else itemAssignmentError = message
  }
  return {
    events,
    volunteers,
    eventAssignments,
    distributionItems,
    distributionError,
    itemAssignments,
    itemAssignmentError,
  }
}

export function getReportUnavailableMessage(error, featureName) {
  if (error?.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(error?.message || '')) {
    return `${featureName} is unavailable because its required Supabase migration or RPC is not installed.`
  }
  if (error?.code === '42501' || /permission denied|not allowed|only a super admin/i.test(error?.message || '')) {
    return `${featureName} could not be accessed with the current database permissions.`
  }
  return error?.message || `${featureName} could not be loaded.`
}
