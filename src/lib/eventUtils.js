export function formatEventDate(value, options = { month: 'long', day: 'numeric', year: 'numeric' }) {
  if (!value) return 'Date to be announced'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date to be announced' : date.toLocaleDateString('en-US', options)
}

export function formatEventDateTime(value) {
  if (!value) return 'Date to be announced'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date to be announced'
    : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export function getSafeImageUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  try {
    const parsed = new URL(url, window.location.origin)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}

export function formatFee(value) {
  const amount = Number(value)
  if (value === null || value === undefined || !Number.isFinite(amount)) return 'Fee unavailable'
  return amount === 0 ? 'Free' : `৳${amount.toLocaleString('en-BD')}`
}

export function getStartingFee(event) {
  const fees = [event.student_fee, event.teacher_fee, event.alumni_fee]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
  return fees.length ? Math.min(...fees) : null
}

export function getRegistrationAvailability(event, registrationCount, now = Date.now()) {
  const status = String(event.status || '').toLowerCase()
  const startsAt = Date.parse(event.event_start)
  const deadline = Date.parse(event.registration_deadline)
  const limit = event.seat_limit === null ? null : Number(event.seat_limit)
  const count = registrationCount === null || registrationCount === undefined
    ? null
    : Number(registrationCount)

  if (status === 'cancelled') return { state: 'Event Cancelled', closed: true, remaining: null }
  if (status === 'completed' || (Number.isFinite(startsAt) && startsAt <= now)) {
    return { state: 'Event Completed', closed: true, remaining: null }
  }
  if (status !== 'published' || (Number.isFinite(deadline) && deadline < now)) {
    return { state: 'Registration Closed', closed: true, remaining: null }
  }
  if (limit !== null && count !== null && limit - count <= 0) {
    return { state: 'Event Full', closed: true, remaining: 0 }
  }
  if (Number.isFinite(deadline) && deadline - now <= 24 * 60 * 60 * 1000) {
    return { state: 'Registration Closing Soon', closed: false, remaining: limit === null || count === null ? null : limit - count }
  }

  return {
    state: 'Registration Open',
    closed: false,
    remaining: limit === null || count === null ? null : limit - count,
  }
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return []
  return options.map((option) => {
    if (typeof option === 'string') return { label: option, value: option }
    if (option && typeof option === 'object' && typeof option.label === 'string') {
      return { label: option.label, value: String(option.value ?? option.label) }
    }
    throw new Error('An event form dropdown has an invalid option.')
  })
}

export function normalizeCustomFields(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error('This event has an invalid additional-form configuration.')

  const fields = value.map((field, index) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new Error('This event has an invalid additional-form field.')
    }
    const label = String(field.label || field.title || '').trim()
    const type = String(field.type || 'text').toLowerCase()
    const name = String(field.name || field.key || field.id || slugify(label)).trim()
    const allowedTypes = new Set(['text', 'number', 'email', 'phone', 'dropdown', 'radio', 'textarea', 'checkbox'])
    if (!label || !name || !allowedTypes.has(type)) {
      throw new Error('This event has an unsupported additional-form field.')
    }
    const options = normalizeOptions(field.options)
    if (['dropdown', 'radio'].includes(type) && !options.length) {
      throw new Error(`“${label}” has no options configured.`)
    }
    return {
      name,
      label,
      type,
      required: field.required === true,
      options,
      id: String(field.id || `${name}-${index}`),
    }
  })
  if (new Set(fields.map((field) => field.name)).size !== fields.length) {
    throw new Error('This event has duplicate additional-form field names.')
  }
  return fields
}
