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
const fieldTypes = ['text', 'number', 'email', 'phone', 'dropdown', 'radio', 'textarea', 'checkbox']
const guestRelationships = ['father', 'mother', 'sister', 'brother', 'husband', 'wife', 'child']

function toLocalDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
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
    seat_limit: event?.seat_limit ?? '',
    status: event?.status || 'draft',
  }
}

function initialCustomFields(event) {
  if (!Array.isArray(event?.custom_form_fields)) return []
  return event.custom_form_fields.map((field, index) => ({
    id: String(field.id || `field-${index + 1}`),
    name: String(field.name || field.key || field.id || ''),
    label: String(field.label || field.title || ''),
    type: String(field.type || 'text').toLowerCase(),
    required: Boolean(field.required),
    options: Array.isArray(field.options)
      ? field.options.map((option) => typeof option === 'string' ? option : option?.label || '').join(', ')
      : '',
  }))
}

function EventForm({ event = null, onSaved }) {
  const { user } = useAuth()
  const statuses = event ? ['draft', 'published', 'cancelled', 'completed'] : ['draft', 'published']
  const [values, setValues] = useState(() => initialValues(event))
  const [customFields, setCustomFields] = useState(() => initialCustomFields(event))
  const [institutions, setInstitutions] = useState([])
  const [departments, setDepartments] = useState([])
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [slugTouched, setSlugTouched] = useState(Boolean(event?.slug))
  const [guestEnabled, setGuestEnabled] = useState(false)
  const [maxGuests, setMaxGuests] = useState('0')
  const [totalGuestLimit, setTotalGuestLimit] = useState('0')
  const [guestDistributionEnabled, setGuestDistributionEnabled] = useState(true)
  const [guestFees, setGuestFees] = useState(
    Object.fromEntries(guestRelationships.map((relationship) => [relationship, '0'])),
  )

  useEffect(() => {
    let active = true
    Promise.all([
      listInstitutions(),
      event?.institution_id ? listDepartments(event.institution_id) : Promise.resolve([]),
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
  }, [event?.institution_id])

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
        setGuestFees((current) => {
          const next = { ...current }
          rows.forEach((row) => {
            if (row.relationship) next[row.relationship] = String(row.guest_fee)
          })
          return next
        })
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

  const updateCustomField = (id, patch) => {
    setCustomFields((current) => current.map((field) => field.id === id ? { ...field, ...patch } : field))
  }

  const addCustomField = () => {
    const id = `field-${Date.now()}`
    setCustomFields((current) => [...current, {
      id,
      name: '',
      label: '',
      type: 'text',
      required: false,
      options: '',
    }])
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
    for (const key of ['student_fee', 'teacher_fee', 'alumni_fee']) {
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
    guestRelationships.forEach((relationship) => {
      if (!Number.isFinite(Number(guestFees[relationship])) || Number(guestFees[relationship]) < 0) {
        nextErrors[`guest_${relationship}`] = 'Enter a guest fee of zero or more.'
      }
    })
    if (values.seat_limit !== '' && (!Number.isInteger(Number(values.seat_limit)) || Number(values.seat_limit) <= 0)) {
      nextErrors.seat_limit = 'Enter a positive whole number.'
    }
    if (customFields.some((field) => !field.label.trim())) nextErrors.customFields = 'Every additional field needs a label.'
    const fieldNames = customFields.map((field) => field.name || slugify(field.label))
    if (new Set(fieldNames).size !== fieldNames.length) nextErrors.customFields = 'Additional field labels must produce unique field names.'
    try {
      normalizeCustomFields(customFields.map((field) => ({
        ...field,
        name: field.name || slugify(field.label),
        options: ['dropdown', 'radio'].includes(field.type)
          ? field.options.split(',').map((option) => option.trim()).filter(Boolean)
          : [],
      })))
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
        alumni_fee: Number(values.alumni_fee),
        seat_limit: values.seat_limit === '' ? null : Number(values.seat_limit),
        status: requestedStatus,
        custom_form_fields: normalizeCustomFields(customFields.map((field) => ({
          ...field,
          name: field.name || slugify(field.label),
          options: ['dropdown', 'radio'].includes(field.type)
            ? field.options.split(',').map((option) => option.trim()).filter(Boolean)
            : [],
        }))),
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
        relationshipFees: guestRelationships.map((relationship) => ({
          relationship,
          guest_fee: Number(guestFees[relationship]),
          is_active: guestEnabled,
        })),
      })
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
          {['student_fee', 'teacher_fee', 'alumni_fee'].map((key) => (
            <label className="form-field" key={key}><span>{key.split('_')[0][0].toUpperCase() + key.split('_')[0].slice(1)} registration fee</span><input type="number" min="0" step="0.01" value={values[key]} onChange={(event) => updateValue(key, event.target.value)} aria-invalid={Boolean(errors[key])} />{errors[key] && <small className="field-error">{errors[key]}</small>}</label>
          ))}
          <label className="form-field"><span>Maximum seat limit <small className="optional-hint">(optional)</small></span><input type="number" min="1" step="1" value={values.seat_limit} onChange={(event) => updateValue('seat_limit', event.target.value)} aria-invalid={Boolean(errors.seat_limit)} />{errors.seat_limit && <small className="field-error">{errors.seat_limit}</small>}</label>
          {event && <label className="form-field"><span>Event status</span><select value={values.status} onChange={(changeEvent) => updateValue('status', changeEvent.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>}
        </div>
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
              {guestRelationships.map((relationship) => (
                <label className="form-field" key={relationship}>
                  <span className="capitalize">{relationship} guest fee (৳)</span>
                  <input type="number" min="0" step="0.01" value={guestFees[relationship]} onChange={(changeEvent) => setGuestFees((current) => ({ ...current, [relationship]: changeEvent.target.value }))} />
                  {errors[`guest_${relationship}`] && <small className="field-error">{errors[`guest_${relationship}`]}</small>}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="admin-form-section">
        <div className="admin-section-heading"><div><h2>Additional registration fields</h2><p>These are stored in the event’s custom_form_fields JSON array.</p></div><button className="button button-outline button-small" type="button" onClick={addCustomField}>Add field</button></div>
        {errors.customFields && <p className="field-error" role="alert">{errors.customFields}</p>}
        {!customFields.length && <p className="admin-muted">No additional fields. Standard participant details are collected automatically.</p>}
        {customFields.map((field) => (
          <div className="custom-field-editor" key={field.id}>
            <label className="form-field"><span>Field label</span><input value={field.label} onChange={(event) => updateCustomField(field.id, { label: event.target.value, name: slugify(event.target.value) })} /></label>
            <label className="form-field"><span>Field type</span><select value={field.type} onChange={(event) => updateCustomField(field.id, { type: event.target.value })}>{fieldTypes.map((type) => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
            {['dropdown', 'radio'].includes(field.type) && <label className="form-field form-field-full"><span>Options (comma separated)</span><input value={field.options} onChange={(event) => updateCustomField(field.id, { options: event.target.value })} placeholder="Option one, Option two" /></label>}
            <label className="check-option"><input type="checkbox" checked={field.required} onChange={(event) => updateCustomField(field.id, { required: event.target.checked })} /><span>Required</span></label>
            <button type="button" className="inline-button custom-field-remove" onClick={() => setCustomFields((current) => current.filter((item) => item.id !== field.id))}>Remove field</button>
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
