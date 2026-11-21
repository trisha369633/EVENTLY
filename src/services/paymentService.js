import { getSupabaseClient } from '../lib/supabase.js'
import { getAdminEventsByIds } from './eventService.js'
import { getAdminOrganizationLabels } from './profileService.js'
import { getAdminReportRegistrations } from './registrationService.js'
import { requireSuperAdmin } from './roleService.js'

export const PAYMENT_PROOF_BUCKET = 'evently-payment-proofs'

const paymentColumns = [
  'id',
  'registration_id',
  'supersedes_payment_id',
  'payment_provider',
  'payment_method',
  'transaction_id',
  'sender_phone',
  'payment_note',
  'payment_amount',
  'screenshot_path',
  'payment_status',
  'rejection_reason',
  'receipt_number',
  'reviewed_by',
  'reviewed_at',
  'submitted_at',
].join(', ')

const reportPaymentColumns = [
  'id',
  'registration_id',
  'payment_method',
  'transaction_id',
  'payment_amount',
  'payment_status',
  'rejection_reason',
  'receipt_number',
  'reviewed_at',
  'submitted_at',
].join(', ')

function numericIds(values) {
  return [...new Set(values.map(String).filter((value) => /^\d+$/.test(value)))]
}

export async function getMyPaymentSubmissions(registrationIds) {
  const ids = numericIds(registrationIds)
  if (!ids.length) return []

  const { data, error } = await getSupabaseClient()
    .from('event_payment_submissions')
    .select(paymentColumns)
    .in('registration_id', ids)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getMyPaymentContext(registrationId) {
  const { data, error } = await getSupabaseClient().rpc('get_my_payment_context', {
    p_registration_id: Number(registrationId),
  })
  if (error) throw error
  return data?.[0] || null
}

export async function submitEventPayment({
  userId,
  registrationId,
  paymentMethod,
  transactionId,
  senderPhone,
  paymentNote,
  file,
}) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WEBP payment screenshot.')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('The payment screenshot must be 5 MB or smaller.')
  }
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure file naming is unavailable in this browser. Update your browser and try again.')
  }

  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
  const path = `${userId}/${registrationId}/${globalThis.crypto.randomUUID()}.${extensions[file.type]}`
  const client = getSupabaseClient()
  const storage = client.storage.from(PAYMENT_PROOF_BUCKET)
  const { error: uploadError } = await storage.upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) throw uploadError

  const { data, error } = await client.rpc('submit_event_payment', {
    p_registration_id: Number(registrationId),
    p_payment_method: paymentMethod,
    p_transaction_id: String(transactionId || '').trim(),
    p_screenshot_path: path,
    p_sender_phone: String(senderPhone || '').trim() || null,
    p_payment_note: String(paymentNote || '').trim() || null,
  })
  if (error) {
    const { error: cleanupError } = await storage.remove([path])
    if (cleanupError) {
      throw new Error(`${error.message} The unsubmitted screenshot could not be removed automatically; contact the administrator.`, { cause: error })
    }
    throw error
  }
  return data
}

export async function createPaymentProofUrl(path) {
  const { data, error } = await getSupabaseClient()
    .storage
    .from(PAYMENT_PROOF_BUCKET)
    .createSignedUrl(path, 120)
  if (error) throw error
  return data.signedUrl
}

export async function getAdminPaymentSummary() {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('get_admin_payment_summary')
  if (error) throw error
  const summary = data?.[0]
  if (!summary) throw new Error('The database did not return payment statistics.')
  return summary
}

export async function getAdminPaymentSubmissions({ page = 0, pageSize = 20, status = '' } = {}) {
  await requireSuperAdmin()
  let query = getSupabaseClient()
    .from('event_payment_submissions')
    .select(paymentColumns, { count: 'exact' })
    .order('submitted_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (status) query = query.eq('payment_status', status)

  const { data, error, count } = await query
  if (error) throw error
  const payments = data || []
  const registrationIds = numericIds(payments.map((payment) => payment.registration_id))
  if (!registrationIds.length) return { payments: [], count: count || 0 }

  const { data: registrations, error: registrationError } = await getSupabaseClient()
    .from('event_registrations')
    .select('id, event_id, full_name, email, phone, participant_type, institution_id, department_id, fee_amount')
    .in('id', registrationIds)
  if (registrationError) throw registrationError

  const registrationRows = registrations || []
  const [events, labels] = await Promise.all([
    getAdminEventsByIds(registrationRows.map((row) => row.event_id)),
    getAdminOrganizationLabels(
      registrationRows.map((row) => row.institution_id),
      registrationRows.map((row) => row.department_id),
    ),
  ])
  const eventById = new Map(events.map((event) => [String(event.id), event]))
  const registrationById = new Map(registrationRows.map((registration) => [
    String(registration.id),
    {
      ...registration,
      event: eventById.get(String(registration.event_id)) || null,
      institution_name: labels.institutions.get(String(registration.institution_id)) || '—',
      department_name: labels.departments.get(String(registration.department_id)) || '—',
    },
  ]))
  return {
    payments: payments.map((payment) => ({
      ...payment,
      registration: registrationById.get(String(payment.registration_id)) || null,
    })),
    count: count || 0,
  }
}

export async function getAdminPaymentReportPage({
  page = 0,
  pageSize = 25,
  status = '',
  eventId = '',
  institutionId = '',
  departmentId = '',
  participantType = '',
  participantSearch = '',
  transactionSearch = '',
  registrationIds = null,
  start = '',
  endExclusive = '',
  dateField = 'submitted_at',
} = {}) {
  await requireSuperAdmin()
  if (!['submitted_at', 'reviewed_at'].includes(dateField)) {
    throw new Error('Unsupported payment report date field.')
  }

  let matchingRegistrationIds = numericIds(registrationIds || [])
  if (registrationIds && !matchingRegistrationIds.length) {
    return { payments: [], count: 0 }
  }

  const needsRegistrationFilter = Boolean(
    eventId || institutionId || departmentId || participantType || participantSearch,
  )
  if (needsRegistrationFilter) {
    const registrations = await getAdminReportRegistrations({
      eventId,
      institutionId,
      departmentId,
      participantType,
      search: participantSearch,
    }, { includeParticipantData: true })
    const matchedIds = numericIds(registrations.map((registration) => registration.id))
    if (registrationIds) {
      const allowed = new Set(matchingRegistrationIds)
      matchingRegistrationIds = matchedIds.filter((id) => allowed.has(id))
    } else {
      matchingRegistrationIds = matchedIds
    }
    if (!matchingRegistrationIds.length) return { payments: [], count: 0 }
  }

  let query = getSupabaseClient()
    .from('event_payment_submissions')
    .select(reportPaymentColumns, { count: 'exact' })
    .order(dateField, { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)

  if (status) query = query.eq('payment_status', status)
  if (start) query = query.gte(dateField, start)
  if (endExclusive) query = query.lt(dateField, endExclusive)
  if (matchingRegistrationIds.length) query = query.in('registration_id', matchingRegistrationIds)
  if (transactionSearch) {
    const safeSearch = String(transactionSearch).replace(/[,%()_*\\\r\n]/g, ' ').trim().slice(0, 100)
    if (safeSearch) query = query.ilike('transaction_id', `%${safeSearch}%`)
  }

  const { data, error, count } = await query
  if (error) throw error
  const payments = data || []
  if (!payments.length) return { payments: [], count: count || 0 }

  const registrationRows = await getAdminReportRegistrations({
    registrationIds: numericIds(payments.map((payment) => payment.registration_id)),
  }, { includeParticipantData: true })
  const registrationById = new Map(registrationRows.map((registration) => [String(registration.id), registration]))

  return {
    payments: payments.map((payment) => ({
      ...payment,
      registration: registrationById.get(String(payment.registration_id)) || null,
    })),
    count: count || 0,
  }
}

export async function reviewEventPayment({ paymentId, decision, rejectionReason = '' }) {
  await requireSuperAdmin()
  const { data, error } = await getSupabaseClient().rpc('review_event_payment', {
    p_payment_id: paymentId,
    p_decision: decision,
    p_rejection_reason: rejectionReason.trim() || null,
  })
  if (error) throw error
  return data
}