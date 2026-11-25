import { useEffect, useState } from 'react'
import { useAuth } from '../../context/useAuth.js'
import { getSafeImageUrl, normalizeCustomFields, slugify } from '../../lib/eventUtils.js'
import {
  createEvent,
  getEventGuestSettings,
  isEventSlugAvailable,
  saveEventGuestSettings,
  updateEvent,
} from '../../services/eventService.js'
import { listDepartments, listInstitutions } from '../../services/profileService.js'

const modes = ['offline', 'online', 'hybrid']
const fieldTypes = ['text', 'textarea', 'number', 'select', 'checkbox']
const createEventDraftStorageKey = 'evently:/admin/events/create:draft'

function readCreateEventDraft() {
  try {
    const storedDraft = window.sessionStorage.getItem(createEventDraftStorageKey)
    if (!storedDraft) return null
    const draft = JSON.parse(storedDraft)
    return draft && typeof draft === 'object' ? draft : null
  } catch (error) {
    console.error('The create-event draft could not be restored.', error)
    return null
  }
}

function saveCreateEventDraft(draft) {
  try {
    window.sessionStorage.setItem(createEventDraftStorageKey, JSON.stringify(draft))
  } catch (error) {
    console.error('The create-event draft could not be saved.', error)
  }
}

function clearCreateEventDraft() {
  try {
    window.sessionStorage.removeItem(createEventDraftStorageKey)
  } catch (error) {
    console.error('The create-event draft could not be cleared.', error)
  }
}

function toLocalDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function normalizePaymentAccounts(accounts) {
  if (!Array.isArray(accounts)) return []
  return accounts.map((account) => ({
    number: String(account?.number || ''),
    note: String(account?.note || ''),
  }))
}

function isValidPaymentNumber(value) {
  const compact = value.trim().replace(/[\s().-]/g, '')
  return /^\+?\d{8,15}$/.test(compact)
}

function errorMessage(error) {
  if (error?.code === '23505' || String(error?.message).includes('events_slug_key')) {
    return 'That URL slug is already in use. Choose a different one.'
  }
  if (error?.code === '23514') return 'The event details do not satisfy a database validation rule. Check the dates, fees, status, and mode.'
  if (error?.code === '23503') return 'The selected institution or department is no longer available.'
  if (error?.code === '42501' || String(error?.message).toLowerCase().includes('row-level security')) {
    return 'Your account is not permitted to manage events.'
  }
  return error?.message || 'The event could not be saved. Please try again.'
}

function initialValues(event) {
  return {
    title: event?.title || '',
    slug: event?.slug || '',
    short_description: event?.short_description || '',
    description: event?.description || '',
    cover_image_url: event?.cover_image_url || '',
    institution_id: event?.institution_id || '',
    department_id: event?.department_id || '',
    venue: event?.venue || '',
    event_mode: event?.event_mode || 'offline',
    event_start: toLocalDateTime(event?.event_start),
    event_end: toLocalDateTime(event?.event_end),
    registration_deadline: toLocalDateTime(event?.registration_deadline),
    student_fee: event?.student_fee ?? 0,
    teacher_fee: event?.teacher_fee ?? 0,
    alumni_fee: event?.alumni_fee ?? 0,
    alumni_allowed: event?.alumni_allowed ?? true,
    child_under_6_fee: Number(event?.child_under_6_fee ?? 0),
    child_above_6_fee: Number(event?.child_above_6_fee ?? 0),
    seat_limit: event?.seat_limit ?? '',
    status: event?.status || 'draft',
  }
}

function initialCustomFields(event) {
  if (!Array.isArray(event?.custom_form_fields)) return []
  const usedIds = new Set()
  return event.custom_form_fields.map((field, index) => {
    const label = String(field.label || field.title || '')
    const baseId = String(field.id || slugify(label) || `field-${index + 1}`)
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`
      suffix += 1
    }
    usedIds.add(id)
    const storedType = String(field.type || 'text').toLowerCase()
    const type = ({ dropdown: 'select', radio: 'select', email: 'text', phone: 'text' })[storedType] || storedType
    const options = Array.isArray(field.options)
      ? field.options.map((option) => typeof option === 'string' ? option : option?.label || option?.value || '').join(', ')
      : ''
    const preserveId = field.preserveId ?? !field.localId
    return {
      id,
      localId: field.localId || id,
      preserveId,
      label,
      type: fieldTypes.includes(type) ? type : 'text',
      required: Boolean(field.required),
      options,
    }
  })
}

function getUniqueCustomFieldId(label, fields, localId) {
  const baseId = slugify(label)
  if (!baseId) return ''
  const usedIds = new Set(fields.filter((field) => field.localId !== localId && field.id).map((field) => field.id))
  let id = baseId
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  return id
}

function getCustomFieldPayload(fields) {
  return normalizeCustomFields(fields.map((field) => ({
    id: field.id || getUniqueCustomFieldId(field.label, fields, field.localId),
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.type === 'select'
      ? field.options.split(',').map((option) => option.trim()).filter(Boolean)
      : [],
  })))
}

function EventForm({ event = null, onSaved }) {
  const { user } = useAuth()
  const statuses = event ? ['draft', 'published', 'cancelled', 'completed'] : ['draft', 'published']
  const [savedDraft] = useState(() => event ? null : readCreateEventDraft())
  const [values, setValues] = useState(() => ({ ...initialValues(event), ...savedDraft?.values }))
  const [paymentAccounts, setPaymentAccounts] = useState(() => (
    normalizePaymentAccounts(savedDraft?.paymentAccounts ?? event?.payment_accounts)
  ))
  const [customFields, setCustomFields] = useState(() => initialCustomFields({
    custom_form_fields: savedDraft?.customFields ?? event?.custom_form_fields,
  }))
  const [institutions, setInstitutions] = useState([])
  const [departments, setDepartments] = useState([])
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [slugTouched, setSlugTouched] = useState(savedDraft?.slugTouched ?? Boolean(event?.slug))
  const [guestEnabled, setGuestEnabled] = useState(savedDraft?.guestEnabled ?? false)
  const [maxGuests, setMaxGuests] = useState(savedDraft?.maxGuests ?? '0')
  const [totalGuestLimit, setTotalGuestLimit] = useState(savedDraft?.totalGuestLimit ?? '0')
  const [guestDistributionEnabled, setGuestDistributionEnabled] = useState(savedDraft?.guestDistributionEnabled ?? true)
  const [commonGuestFee, setCommonGuestFee] = useState(savedDraft?.commonGuestFee ?? '0')
  const [childUnder6Fee, setChildUnder6Fee] = useState(String(savedDraft?.childUnder6Fee ?? values.child_under_6_fee ?? 0))
  const [childAbove6Fee, setChildAbove6Fee] = useState(String(savedDraft?.childAbove6Fee ?? values.child_above_6_fee ?? 0))
  const initialInstitutionId = event?.institution_id || savedDraft?.values?.institution_id || ''

  useEffect(() => {
    if (event) return
    saveCreateEventDraft({
      values,
      paymentAccounts,
      customFields,
      slugTouched,
      guestEnabled,
      maxGuests,
      totalGuestLimit,
      guestDistributionEnabled,
      commonGuestFee,
      childUnder6Fee,
      childAbove6Fee,
    })
  }, [
    event,
    values,
    paymentAccounts,
    customFields,
    slugTouched,
    guestEnabled,
    maxGuests,
    totalGuestLimit,
    guestDistributionEnabled,
    commonGuestFee,
    childUnder6Fee,
    childAbove6Fee,
  ])

  useEffect(() => {
    let active = true
    Promise.all([
      listInstitutions(),
      initialInstitutionId ? listDepartments(initialInstitutionId) : Promise.resolve([]),
    ])
      .then(([nextInstitutions, nextDepartments]) => {
        if (!active) return
        setInstitutions(nextInstitutions)
        setDepartments(nextDepartments)
        if (!nextInstitutions.length) setFormError('No active universities are available for events.')
      })
      .catch((error) => {
        if (active) setFormError(error.message || 'Institution and department options could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [event?.institution_id, initialInstitutionId])

  useEffect(() => {
    if (!event?.id) return undefined
    let active = true
    getEventGuestSettings(event.id)
      .then((rows) => {
        if (!active) return
        const first = rows[0]
        if (!first) return
        setGuestEnabled(Boolean(first.is_enabled))
        setMaxGuests(String(first.max_guests_per_participant))
        setTotalGuestLimit(String(first.total_guest_limit))
        setGuestDistributionEnabled(Boolean(first.guest_distribution_enabled))
        setCommonGuestFee(String(first?.common_guest_fee ?? rows.find((row) => row.relationship && row.relationship !== 'child')?.guest_fee ?? 0))
      })
      .catch((error) => setFormError(error.message || 'Guest settings could not be loaded.'))
    return () => {
      active = false
    }
  }, [event?.id])

  const updateValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
  }

  const updateAlumniAllowed = (allowed) => {
    setValues((current) => ({
      ...current,
      alumni_allowed: allowed,
      alumni_fee: allowed ? current.alumni_fee : '0',
    }))
    setErrors((current) => ({ ...current, alumni_fee: '' }))
  }

  const updatePaymentAccount = (index, key, value) => {
    setPaymentAccounts((current) => current.map((account, accountIndex) => (
      accountIndex === index ? { ...account, [key]: value } : account
    )))
    setErrors((current) => ({ ...current, paymentAccounts: undefined }))
  }

  const addPaymentAccount = () => {
    setPaymentAccounts((current) => [...current, { number: '', note: '' }])
    setErrors((current) => ({ ...current, paymentAccounts: undefined }))
  }

  const removePaymentAccount = (index) => {
    setPaymentAccounts((current) => current.filter((_, accountIndex) => accountIndex !== index))
    setErrors((current) => ({ ...current, paymentAccounts: undefined }))
  }

  const handleInstitutionChange = async (institutionId) => {
    updateValue('institution_id', institutionId)
    updateValue('department_id', '')
    setDepartments([])
    if (!institutionId) return
    setLoading(true)
    setFormError('')
    try {
      setDepartments(await listDepartments(institutionId))
    } catch (error) {
      setFormError(error.message || 'Departments could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  const updateCustomField = (localId, patch) => {
    setCustomFields((current) => current.map((field) => field.localId === localId ? { ...field, ...patch } : field))
    setErrors((current) => ({ ...current, customFields: '' }))
  }

  const updateCustomFieldLabel = (localId, label) => {
    setCustomFields((current) => current.map((field) => {
      if (field.localId !== localId) return field
      return {
        ...field,
        label,
        id: field.preserveId ? field.id : getUniqueCustomFieldId(label, current, localId),
      }
    }))
    setErrors((current) => ({ ...current, customFields: '' }))
  }

  const addCustomField = () => {
    const localId = `new-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${customFields.length + 1}`}`
    setCustomFields((current) => [...current, {
      id: '',
      localId,
      preserveId: false,
      label: '',
      type: 'text',
      required: false,
      options: '',
    }])
    setErrors((current) => ({ ...current, customFields: '' }))
  }

  const validate = async () => {
    const nextErrors = {}
    for (const key of ['title', 'slug', 'description', 'institution_id', 'venue', 'event_start', 'event_end', 'registration_deadline']) {
      if (!String(values[key] || '').trim()) nextErrors[key] = 'This field is required.'
    }
    if (values.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) nextErrors.slug = 'Use lowercase letters, numbers, and hyphens.'
    if (values.event_start && values.event_end && new Date(values.event_start) >= new Date(values.event_end)) {
      nextErrors.event_end = 'Event end must be after the start.'
    }
    if (values.event_start && values.registration_deadline && new Date(values.registration_deadline) > new Date(values.event_start)) {
      nextErrors.registration_deadline = 'Deadline cannot be after the event starts.'
    }
    if (values.cover_image_url && !getSafeImageUrl(values.cover_image_url)) {
      nextErrors.cover_image_url = 'Enter an HTTP or HTTPS image URL.'
    }
    for (const key of values.alumni_allowed
      ? ['student_fee', 'teacher_fee', 'alumni_fee']
      : ['student_fee', 'teacher_fee']) {
      if (values[key] === '' || !Number.isFinite(Number(values[key])) || Number(values[key]) < 0) {
        nextErrors[key] = 'Enter a fee of zero or more.'
      }
    }
    if (!Number.isInteger(Number(maxGuests)) || Number(maxGuests) < 0) {
      nextErrors.maxGuests = 'Enter a guest limit of zero or more.'
    }
    if (!Number.isInteger(Number(totalGuestLimit)) || Number(totalGuestLimit) < 0) {
      nextErrors.totalGuestLimit = 'Enter a guest capacity of zero or more.'
    }
    for (const [key, value] of [
      ['commonGuestFee', commonGuestFee],
      ['childUnder6Fee', childUnder6Fee],
      ['childAbove6Fee', childAbove6Fee],
    ]) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) {
        nextErrors[key] = 'Enter a guest fee of zero or more.'
      }
    }
    if (values.seat_limit !== '' && (!Number.isInteger(Number(values.seat_limit)) || Number(values.seat_limit) <= 0)) {
      nextErrors.seat_limit = 'Enter a positive whole number.'
    }
    const paymentAccountErrors = paymentAccounts.map(({ number, note }) => (
      number.trim() || note.trim()
        ? isValidPaymentNumber(number) ? '' : 'Enter a valid number with 8–15 digits.'
        : ''
    ))
    if (paymentAccountErrors.some(Boolean)) nextErrors.paymentAccounts = paymentAccountErrors
    if (customFields.some((field) => !field.label.trim())) nextErrors.customFields = 'Every additional field needs a label.'
    try {
      getCustomFieldPayload(customFields)
    } catch (error) {
      nextErrors.customFields = error.message
    }
    if (values.slug && !nextErrors.slug) {
      try {
        const available = await isEventSlugAvailable(values.slug, event?.id ?? null)
        if (!available) nextErrors.slug = 'That URL slug is already in use.'
      } catch (error) {
        nextErrors.submit = error.message || 'The URL slug could not be checked.'
      }
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (submitEvent) => {
    submitEvent.preventDefault()
    setFormError('')
    if (!(await validate())) return
    setBusy(true)
    try {
      const requestedStatus = event
        ? values.status
        : submitEvent.nativeEvent.submitter?.value || 'draft'
      const payload = {
        title: values.title.trim(),
        slug: values.slug.trim(),
        short_description: values.short_description.trim(),
        description: values.description.trim(),
        cover_image_url: values.cover_image_url.trim()
          ? getSafeImageUrl(values.cover_image_url)
          : null,
        institution_id: values.institution_id,
        department_id: values.department_id || null,
        venue: values.venue.trim(),
        event_mode: values.event_mode,
        event_start: new Date(values.event_start).toISOString(),
        event_end: new Date(values.event_end).toISOString(),
        registration_deadline: new Date(values.registration_deadline).toISOString(),
        student_fee: Number(values.student_fee),
        teacher_fee: Number(values.teacher_fee),
        alumni_fee: values.alumni_allowed ? Number(values.alumni_fee) : 0,
        alumni_allowed: values.alumni_allowed,
        child_under_6_fee: Number(childUnder6Fee || 0),
        child_above_6_fee: Number(childAbove6Fee || 0),
        seat_limit: values.seat_limit === '' ? null : Number(values.seat_limit),
        status: requestedStatus,
        payment_accounts: paymentAccounts
          .filter((account) => account.number.trim() || account.note.trim())
          .map((account) => ({ number: account.number.trim(), note: account.note.trim() })),
        custom_form_fields: getCustomFieldPayload(customFields),
      }
      const saved = event
        ? await updateEvent(event.id, payload)
        : await createEvent({ ...payload, created_by: user.id })
      await saveEventGuestSettings({
        eventId: saved.id,
        isEnabled: guestEnabled,
        maxGuestsPerParticipant: Number(maxGuests),
        totalGuestLimit: Number(totalGuestLimit),
        guestDistributionEnabled,
        relationshipFees: [
          { relationship: 'common', guest_fee: Number(commonGuestFee), is_active: guestEnabled },
          { relationship: 'child_under_6', guest_fee: Number(childUnder6Fee || 0), is_active: guestEnabled },
          { relationship: 'child_above_6', guest_fee: Number(childAbove6Fee || 0), is_active: guestEnabled },
        ],
      })
      if (!event) clearCreateEventDraft()
      onSaved(saved)
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="admin-event-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      {formError && <div className="form-feedback" role="alert">{formError}</div>}
      {errors.submit && <div className="form-feedback" role="alert">{errors.submit}</div>}
      {loading && <p className="inline-notice" role="status">Loading institutions and departments…</p>}
      <div className="admin-form-section">
        <h2>Event details</h2>
        <div className="form-grid">
          <label className="form-field"><span>Event title</span><input value={values.title} onChange={(event) => { updateValue('title', event.target.value); if (!slugTouched) updateValue('slug', slugify(event.target.value)) }} aria-invalid={Boolean(errors.title)} />{errors.title && <small className="field-error">{errors.title}</small>}</label>
          <label className="form-field"><span>URL slug</span><input value={values.slug} onChange={(event) => { setSlugTouched(true); updateValue('slug', slugify(event.target.value)) }} aria-invalid={Boolean(errors.slug)} />{errors.slug && <small className="field-error">{errors.slug}</small>}</label>
          <label className="form-field form-field-full"><span>Short description</span><textarea rows="2" value={values.short_description} onChange={(event) => updateValue('short_description', event.target.value)} maxLength="300" /></label>
          <label className="form-field form-field-full"><span>Full description</span><textarea rows="6" value={values.description} onChange={(event) => updateValue('description', event.target.value)} aria-invalid={Boolean(errors.description)} />{errors.description && <small className="field-error">{errors.description}</small>}</label>
          <label className="form-field form-field-full"><span>Cover image URL</span><input type="url" value={values.cover_image_url} onChange={(event) => updateValue('cover_image_url', event.target.value)} placeholder="https://…" />{errors.cover_image_url && <small className="field-error">{errors.cover_image_url}</small>}</label>
        </div>
      </div>

      <div className="admin-form-section">
        <h2>Location and schedule</h2>
        <div className="form-grid">
          <label className="form-field"><span>University</span><select value={values.institution_id} onChange={(event) => void handleInstitutionChange(event.target.value)} disabled={loading}><option value="">Select university</option>{institutions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>{errors.institution_id && <small className="field-error">{errors.institution_id}</small>}</label>
          <label className="form-field"><span>Department</span><select value={values.department_id} onChange={(event) => updateValue('department_id', event.target.value)} disabled={!values.institution_id || loading}><option value="">University-wide / no department</option>{departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="form-field"><span>Venue</span><input value={values.venue} onChange={(event) => updateValue('venue', event.target.value)} aria-invalid={Boolean(errors.venue)} />{errors.venue && <small className="field-error">{errors.venue}</small>}</label>
          <label className="form-field"><span>Event mode</span><select value={values.event_mode} onChange={(event) => updateValue('event_mode', event.target.value)}>{modes.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
          <label className="form-field"><span>Event start</span><input type="datetime-local" value={values.event_start} onChange={(event) => updateValue('event_start', event.target.value)} aria-invalid={Boolean(errors.event_start)} />{errors.event_start && <small className="field-error">{errors.event_start}</small>}</label>
          <label className="form-field"><span>Event end</span><input type="datetime-local" value={values.event_end} onChange={(event) => updateValue('event_end', event.target.value)} aria-invalid={Boolean(errors.event_end)} />{errors.event_end && <small className="field-error">{errors.event_end}</small>}</label>
          <label className="form-field"><span>Registration deadline</span><input type="datetime-local" value={values.registration_deadline} onChange={(event) => updateValue('registration_deadline', event.target.value)} aria-invalid={Boolean(errors.registration_deadline)} />{errors.registration_deadline && <small className="field-error">{errors.registration_deadline}</small>}</label>
        </div>
      </div>

      <div className="admin-form-section">
        <h2>Fees and capacity</h2>
        <div className="form-grid">
          <label className="form-field"><span>Student registration fee</span><input type="number" min="0" step="0.01" value={values.student_fee} onChange={(changeEvent) => updateValue('student_fee', changeEvent.target.value)} aria-invalid={Boolean(errors.student_fee)} />{errors.student_fee && <small className="field-error">{errors.student_fee}</small>}</label>
          <label className="form-field"><span>Teacher registration fee</span><input type="number" min="0" step="0.01" value={values.teacher_fee} onChange={(changeEvent) => updateValue('teacher_fee', changeEvent.target.value)} aria-invalid={Boolean(errors.teacher_fee)} />{errors.teacher_fee && <small className="field-error">{errors.teacher_fee}</small>}</label>
          <label className="form-field"><span>Alumni registration fee</span><input type="number" min="0" step="0.01" value={values.alumni_fee} onChange={(changeEvent) => updateValue('alumni_fee', changeEvent.target.value)} disabled={!values.alumni_allowed} aria-invalid={Boolean(errors.alumni_fee)} />{!values.alumni_allowed && <small className="optional-hint">Saved as 0 while alumni registration is not allowed.</small>}{errors.alumni_fee && <small className="field-error">{errors.alumni_fee}</small>}</label>
          <label className="form-field"><span>Alumni registration</span><select value={values.alumni_allowed ? 'allowed' : 'not_allowed'} onChange={(changeEvent) => updateAlumniAllowed(changeEvent.target.value === 'allowed')}><option value="allowed">Allowed</option><option value="not_allowed">Not Allowed</option></select></label>
          <label className="form-field"><span>Maximum seat limit <small className="optional-hint">(optional)</small></span><input type="number" min="1" step="1" value={values.seat_limit} onChange={(event) => updateValue('seat_limit', event.target.value)} aria-invalid={Boolean(errors.seat_limit)} />{errors.seat_limit && <small className="field-error">{errors.seat_limit}</small>}</label>
          {event && <label className="form-field"><span>Event status</span><select value={values.status} onChange={(changeEvent) => updateValue('status', changeEvent.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>}
        </div>
      </div>

      <div className="admin-form-section">
        <div className="admin-section-heading payment-accounts-heading">
          <div><h2>Payment Receiving Numbers</h2><p>These numbers are shown to participants when they register for this event.</p></div>
          <button className="button button-outline button-small" type="button" onClick={addPaymentAccount}>+ Add Payment Number</button>
        </div>
        {!paymentAccounts.length && <p className="admin-muted">No receiving numbers configured.</p>}
        {paymentAccounts.map((account, index) => {
          const rowError = errors.paymentAccounts?.[index]
          return (
            <div className="payment-account-form-row" key={index} role="group" aria-label={`Payment number ${index + 1}`}>
              <label className="form-field">
                <span>Number</span>
                <input
                  type="tel"
                  value={account.number}
                  onChange={(changeEvent) => updatePaymentAccount(index, 'number', changeEvent.target.value)}
                  placeholder="017XXXXXXXX"
                  required={Boolean(account.number.trim() || account.note.trim())}
                  aria-invalid={Boolean(rowError)}
                />
                {rowError && <small className="field-error">{rowError}</small>}
              </label>
              <label className="form-field">
                <span>Note <small className="optional-hint">(optional)</small></span>
                <input
                  value={account.note}
                  onChange={(changeEvent) => updatePaymentAccount(index, 'note', changeEvent.target.value)}
                  placeholder="bKash + Nagad"
                />
              </label>
              <button className="inline-button payment-account-remove" type="button" onClick={() => removePaymentAccount(index)}>Remove</button>
            </div>
          )
        })}
      </div>

      <div className="admin-form-section">
        <div className="admin-section-heading">
          <div><h2>Guest &amp; Family Registration</h2><p>Configure family and guest admission for this event.</p></div>
          <label className="check-option"><input type="checkbox" checked={guestEnabled} onChange={(changeEvent) => setGuestEnabled(changeEvent.target.checked)} /><span>Enable guest registration</span></label>
        </div>
        {guestEnabled && (
          <>
            <div className="form-grid">
              <label className="form-field"><span>Maximum guests per participant</span><input type="number" min="0" step="1" value={maxGuests} onChange={(changeEvent) => setMaxGuests(changeEvent.target.value)} />{errors.maxGuests && <small className="field-error">{errors.maxGuests}</small>}</label>
              <label className="form-field"><span>Total guest admission limit</span><input type="number" min="0" step="1" value={totalGuestLimit} onChange={(changeEvent) => setTotalGuestLimit(changeEvent.target.value)} />{errors.totalGuestLimit && <small className="field-error">{errors.totalGuestLimit}</small>}</label>
              <label className="check-option"><input type="checkbox" checked={guestDistributionEnabled} onChange={(changeEvent) => setGuestDistributionEnabled(changeEvent.target.checked)} /><span>Allow eligible guests to receive assigned distribution items</span></label>
            </div>
            <div className="form-grid">
              <label className="form-field">
                <span>Common Guest Fee (BDT)</span>
                <input type="number" min="0" step="0.01" value={commonGuestFee} onChange={(changeEvent) => setCommonGuestFee(changeEvent.target.value)} aria-invalid={Boolean(errors.commonGuestFee)} />
                {errors.commonGuestFee && <small className="field-error">{errors.commonGuestFee}</small>}
              </label>
              <label className="form-field">
                <span>Child Under 6 Years Fee (BDT)</span>
                <input type="number" min="0" step="0.01" value={childUnder6Fee} onChange={(changeEvent) => setChildUnder6Fee(changeEvent.target.value)} aria-invalid={Boolean(errors.childUnder6Fee)} />
                {errors.childUnder6Fee && <small className="field-error">{errors.childUnder6Fee}</small>}
              </label>
              <label className="form-field">
                <span>Child Above 6 Years Fee (BDT)</span>
                <input type="number" min="0" step="0.01" value={childAbove6Fee} onChange={(changeEvent) => setChildAbove6Fee(changeEvent.target.value)} aria-invalid={Boolean(errors.childAbove6Fee)} />
                {errors.childAbove6Fee && <small className="field-error">{errors.childAbove6Fee}</small>}
              </label>
            </div>
          </>
        )}
      </div>

      <div className="admin-form-section">
        <div className="admin-section-heading"><div><h2>Additional registration fields</h2></div><button className="button button-outline button-small" type="button" onClick={addCustomField}>Add field</button></div>
        {errors.customFields && <p className="field-error" role="alert">{errors.customFields}</p>}
        {!customFields.length && <p className="admin-muted">No additional fields. Standard participant details are collected automatically.</p>}
        {customFields.map((field) => (
          <div className="custom-field-editor" key={field.localId}>
            <label className="form-field"><span>Field label</span><input required value={field.label} onChange={(event) => updateCustomFieldLabel(field.localId, event.target.value)} /></label>
            <label className="form-field"><span>Field type</span><select value={field.type} onChange={(event) => updateCustomField(field.localId, { type: event.target.value })}>{fieldTypes.map((type) => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
            {field.type === 'select' && <label className="form-field form-field-full"><span>Options (comma separated)</span><input value={field.options} onChange={(event) => updateCustomField(field.localId, { options: event.target.value })} placeholder="S, M, L, XL" /></label>}
            <label className="check-option"><input type="checkbox" checked={field.required} onChange={(event) => updateCustomField(field.localId, { required: event.target.checked })} /><span>Required</span></label>
            <button type="button" className="inline-button custom-field-remove" onClick={() => {
              setCustomFields((current) => current.filter((item) => item.localId !== field.localId))
              setErrors((current) => ({ ...current, customFields: '' }))
            }}>Remove</button>
          </div>
        ))}
      </div>

      <div className="admin-form-actions">
        {event
          ? <button className="button button-primary" type="submit" disabled={busy || loading}>{busy ? 'Saving event…' : 'Save changes'}</button>
          : <>
            <button className="button button-outline" type="submit" value="draft" disabled={busy || loading}>{busy ? 'Saving event…' : 'Save as draft'}</button>
            <button className="button button-primary" type="submit" value="published" disabled={busy || loading}>{busy ? 'Saving event…' : 'Publish event'}</button>
          </>}
      </div>
    </form>
  )
}

export default EventForm
