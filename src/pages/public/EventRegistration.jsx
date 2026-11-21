import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useAuth } from '../../context/useAuth.js'
import { formatEventDateTime, formatFee, getRegistrationAvailability, normalizeCustomFields } from '../../lib/eventUtils.js'
import { navigate } from '../../lib/navigation.js'
import {
  getPublishedEventBySlug,
  getPublicRegistrationCounts,
  getEventGuestSettings,
} from '../../services/eventService.js'
import { getUserIdentity } from '../../services/identityService.js'
import { getProfile, listDepartments, listInstitutions } from '../../services/profileService.js'
import { getRegistrationByEvent, registerForEvent } from '../../services/registrationService.js'

const participantTypes = ['student', 'teacher', 'alumni']

function registrationErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase()
  if (error?.code === '23505' || message.includes('unique_event_user') || message.includes('duplicate key')) {
    return 'You already have a registration for this event.'
  }
  if (message.includes('deadline') || message.includes('registration is closed')) {
    return 'The registration deadline has passed. The database did not accept this registration.'
  }
  if (message.includes('seat') || message.includes('full')) {
    return 'This event has reached its seat limit.'
  }
  if (message.includes('status') || message.includes('published')) {
    return 'This event is no longer accepting registrations.'
  }
  if (error?.code === '42501' || message.includes('row-level security')) {
    return 'Your account is not permitted to register for this event. Please contact the platform administrator.'
  }
  if (error?.code === '23503' || error?.code === '23514') {
    return 'Some registration details are no longer valid. Review your institution, department, and participant type.'
  }
  return error?.message || 'We could not submit your registration. Your information is still here; please try again.'
}

function EventRegistration({ slug }) {
  const { user, loading: authLoading, roles } = useAuth()
  const [event, setEvent] = useState(null)
  const [counts, setCounts] = useState(null)
  const [registration, setRegistration] = useState(null)
  const [institutions, setInstitutions] = useState([])
  const [departments, setDepartments] = useState([])
  const [values, setValues] = useState({
    full_name: '',
    email: '',
    phone: '',
    participant_type: '',
    institution_id: '',
    department_id: '',
    identity_number: '',
  })
  const [answers, setAnswers] = useState({})
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [lookupsLoading, setLookupsLoading] = useState(false)
  const [hydratedUserKey, setHydratedUserKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [formConfigurationError, setFormConfigurationError] = useState('')
  const [customFields, setCustomFields] = useState([])
  const [guestSettings, setGuestSettings] = useState({
    isEnabled: false,
    maxGuests: 0,
    remainingCapacity: 0,
    relationships: [],
  })
  const [bringingGuests, setBringingGuests] = useState(false)
  const [guests, setGuests] = useState([])

  useEffect(() => {
    let active = true
    getPublishedEventBySlug(slug)
      .then(async (item) => {
        if (!active) return
        setEvent(item)
        if (!item) return
        try {
          setCustomFields(normalizeCustomFields(item.custom_form_fields))
          setFormConfigurationError('')
        } catch (fieldError) {
          setCustomFields([])
          setFormConfigurationError(fieldError.message)
        }
        try {
          const nextCounts = await getPublicRegistrationCounts([item.id])
          if (active) setCounts(nextCounts[String(item.id)] ?? 0)
        } catch {
          if (active) setCounts(null)
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'This event could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [slug])

  useEffect(() => {
    if (!event) return undefined
    let active = true
    getEventGuestSettings(event.id)
      .then((rows) => {
        if (!active) return
        const first = rows[0]
        setGuestSettings({
          isEnabled: Boolean(first?.is_enabled),
          maxGuests: Number(first?.max_guests_per_participant || 0),
          remainingCapacity: Number(first?.remaining_guest_capacity || 0),
          relationships: rows
            .filter((row) => row.relationship && row.relationship_is_active)
            .map((row) => ({
              value: row.relationship,
              label: row.relationship[0].toUpperCase() + row.relationship.slice(1),
              fee: Number(row.guest_fee || 0),
            })),
        })
      })
      .catch(() => {
        if (active) setGuestSettings({ isEnabled: false, maxGuests: 0, remainingCapacity: 0, relationships: [] })
      })
    return () => {
      active = false
    }
  }, [event])

  useEffect(() => {
    if (authLoading || !user || !event) return undefined
    let active = true
    Promise.all([
      getProfile(user.id),
      getUserIdentity(user.id),
      listInstitutions(),
      getRegistrationByEvent(event.id),
    ])
      .then(async ([nextProfile, identity, nextInstitutions, existingRegistration]) => {
        if (!active) return
        setLookupError('')
        setInstitutions(nextInstitutions)
        if (!nextInstitutions.length) setLookupError('No active universities are available for registration. Contact the platform administrator.')
        setRegistration(existingRegistration)
        setDepartments([])
        const nextValues = {
          full_name: nextProfile?.full_name || '',
          email: nextProfile?.email || user.email || '',
          phone: nextProfile?.phone || '',
          participant_type: participantTypes.includes(identity?.identity_type) ? identity.identity_type : '',
          institution_id: identity?.institution_id || '',
          department_id: identity?.department_id || '',
          identity_number: identity?.identity_number || '',
        }
        setValues(nextValues)
        if (nextValues.institution_id) {
          const nextDepartments = await listDepartments(nextValues.institution_id)
          if (active) {
            setDepartments(nextDepartments)
            if (!nextDepartments.length) {
              setValues((current) => ({ ...current, department_id: '' }))
              setLookupError('No active departments are available for this university.')
            }
          }
        }
      })
      .catch((loadError) => {
        if (active) {
          setRegistration(null)
          setDepartments([])
          setValues({
            full_name: '',
            email: user.email || '',
            phone: '',
            participant_type: '',
            institution_id: '',
            department_id: '',
            identity_number: '',
          })
          setLookupError(loadError.message || 'Your registration details could not be loaded.')
        }
      })
      .finally(() => {
        if (active) {
          setHydratedUserKey(`${user.id}:${event.id}`)
          setLookupsLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [authLoading, user, event])

  const availability = useMemo(
    () => event ? getRegistrationAvailability(event, counts) : null,
    [event, counts],
  )
  const initialLookupsLoading = Boolean(user && event && hydratedUserKey !== `${user.id}:${event.id}`)
  const allLookupsLoading = lookupsLoading || initialLookupsLoading

  const updateValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
  }

  const onInstitutionChange = async (institutionId) => {
    updateValue('institution_id', institutionId)
    updateValue('department_id', '')
    setDepartments([])
    if (!institutionId) return
    setLookupsLoading(true)
    setLookupError('')
    try {
      const nextDepartments = await listDepartments(institutionId)
      setDepartments(nextDepartments)
      if (!nextDepartments.length) setLookupError('No active departments are available for this university.')
    } catch (loadError) {
      setLookupError(loadError.message || 'Departments could not be loaded.')
    } finally {
      setLookupsLoading(false)
    }
  }

  const validate = () => {
    const nextErrors = {}
    for (const [key, label] of [
      ['full_name', 'Full name'],
      ['email', 'Email address'],
      ['phone', 'Phone number'],
      ['participant_type', 'Participant type'],
      ['institution_id', 'University'],
      ['department_id', 'Department'],
      ['identity_number', 'Student / Employee ID'],
    ]) {
      if (!String(values[key] || '').trim()) nextErrors[key] = `${label} is required.`
    }
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) nextErrors.email = 'Enter a valid email address.'
    if (values.phone && !/^[+\d\s().-]{8,20}$/.test(values.phone)) nextErrors.phone = 'Enter a valid phone number.'
    if (values.institution_id && !institutions.some((institution) => institution.id === values.institution_id)) {
      nextErrors.institution_id = 'Select an active university.'
    }
    if (values.department_id && !departments.some((department) => department.id === values.department_id)) {
      nextErrors.department_id = 'Select an active department.'
    }
    customFields.forEach((field) => {
      const answer = answers[field.name]
      if (field.required && (field.type === 'checkbox' ? answer !== true : !String(answer ?? '').trim())) {
        nextErrors[`custom:${field.name}`] = `${field.label} is required.`
      }
      if (field.type === 'number' && answer !== '' && answer !== undefined && !Number.isFinite(Number(answer))) {
        nextErrors[`custom:${field.name}`] = `Enter a valid number for ${field.label}.`
      }
      if (field.type === 'email' && answer && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(answer))) {
        nextErrors[`custom:${field.name}`] = `Enter a valid email address for ${field.label}.`
      }
      if (field.type === 'dropdown' && answer && !field.options.some((option) => option.value === answer)) {
        nextErrors[`custom:${field.name}`] = `Choose a valid option for ${field.label}.`
      }
      if (field.type === 'radio' && answer && !field.options.some((option) => option.value === answer)) {
        nextErrors[`custom:${field.name}`] = `Choose a valid option for ${field.label}.`
      }
    })
    if (bringingGuests) {
      if (!guests.length) nextErrors.guests = 'Add at least one guest or turn off guest registration.'
      if (guests.length > guestSettings.maxGuests) nextErrors.guests = `A maximum of ${guestSettings.maxGuests} guest${guestSettings.maxGuests === 1 ? '' : 's'} is allowed.`
      if (guests.length > guestSettings.remainingCapacity) nextErrors.guests = 'The event guest admission limit has been reached.'
      guests.forEach((guest, index) => {
        if (!guest.full_name.trim()) nextErrors[`guest_name_${index}`] = 'Guest full name is required.'
        if (!guestSettings.relationships.some((relationship) => relationship.value === guest.relationship)) {
          nextErrors[`guest_relationship_${index}`] = 'Select an enabled guest relationship.'
        }
      })
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (submitEvent) => {
    submitEvent.preventDefault()
    if (!user || !roles.includes('participant')) {
      setError('A participant account is required to register.')
      return
    }
    if (formConfigurationError) return
    if (!validate()) return
    setSubmitting(true)
    setError('')
    try {
      const result = await registerForEvent({
        event_id: event.id,
        ...values,
        form_answers: answers,
        guests: bringingGuests ? guests.map((guest) => ({
          full_name: guest.full_name.trim(),
          relationship: guest.relationship,
        })) : [],
      })
      if (Number(result.fee_amount) > 0) {
        navigate(`/payments/${result.id}`, { replace: true })
        return
      }
      setRegistration(result)
      setSuccess(result)
    } catch (submitError) {
      setError(registrationErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || authLoading || initialLookupsLoading) return <section className="container event-page-state" aria-live="polite"><p>Preparing your registration…</p></section>
  if (!event) return <section className="not-found container"><span className="eyebrow">EVENT NOT FOUND</span><h1>This event is unavailable.</h1><p>{error || 'Only published events can accept registrations.'}</p><a className="button button-outline" href="/events">Explore events</a></section>
  if (!roles.includes('participant')) return <section className="not-found container"><span className="eyebrow">PARTICIPANT ACCESS</span><h1>Registration is for participants.</h1><p>Sign in with a participant account to register for this event.</p><a className="button button-outline" href="/events">Back to events</a></section>

  if (success) {
    return (
      <section className="container registration-success">
        <span className="success-icon"><Icon name="check" size={28} /></span>
        <span className="eyebrow">REGISTRATION CONFIRMED</span>
        <h1>You’re registered for {event.title}.</h1>
        <p>Your free-event registration was accepted. No payment is required.</p>
        <div className="registration-summary">
          <div><span>Participant</span><strong>{success.full_name}</strong></div>
          <div><span>Participant type</span><strong>{success.participant_type}</strong></div>
          <div><span>Event starts</span><strong>{formatEventDateTime(event.event_start)}</strong></div>
          <div><span>Registration fee</span><strong>{formatFee(success.fee_amount)}</strong></div>
        </div>
        <div className="registration-success-actions">
          <a className="button button-outline" href="/dashboard/my-events">View my registrations</a>
          <a className="button button-outline" href={`/events/${encodeURIComponent(event.slug)}`}>View event details</a>
        </div>
      </section>
    )
  }

  if (registration) {
    const cancelled = registration.registration_status === 'cancelled'
    return (
      <section className="container event-page-state">
        <span className="eyebrow">{cancelled ? 'REGISTRATION CANCELLED' : 'ALREADY REGISTERED'}</span>
        <h1>{cancelled ? 'This registration was cancelled.' : 'You’re already registered.'}</h1>
        <p>{event.title} · {formatEventDateTime(event.event_start)}</p>
        {Number(registration.fee_amount) > 0 && registration.registration_status === 'registered' && !['cancelled', 'completed'].includes(event.status) && <a className="button button-primary" href={`/payments/${registration.id}`}>Continue to payment</a>}
        {Number(registration.fee_amount) > 0 && ['cancelled', 'completed'].includes(event.status) && <p className="inline-notice">Payment is unavailable because this event is {event.status}.</p>}
        <a className="button button-primary" href="/dashboard/my-events">View my registrations</a>
      </section>
    )
  }

  if (availability.closed) {
    return <section className="container event-page-state"><span className="eyebrow">{availability.state.toUpperCase()}</span><h1>Registration is closed.</h1><p>{event.title} is no longer accepting registrations. The database is the final authority on availability.</p><a className="button button-outline" href={`/events/${encodeURIComponent(event.slug)}`}>View event details</a></section>
  }

  const participantFee = values.participant_type ? event[`${values.participant_type}_fee`] : null
  const selectedGuestFees = guests.map((guest) => (
    guestSettings.relationships.find((relationship) => relationship.value === guest.relationship)?.fee || 0
  ))
  const guestFeeTotal = selectedGuestFees.reduce((total, fee) => total + Number(fee), 0)
  const grandTotal = (Number(participantFee) || 0) + guestFeeTotal

  return (
    <section className="container registration-page">
      <a className="back-link registration-back-link" href={`/events/${encodeURIComponent(event.slug)}`}><span aria-hidden="true">←</span> Event details</a>
      <div className="registration-page-header">
        <span className="eyebrow">EVENT REGISTRATION</span>
        <h1>Register for {event.title}</h1>
        <p>{formatEventDateTime(event.event_start)} · {event.venue}</p>
      </div>
      {(error || lookupError) && <div className="form-feedback" role="alert">{error || lookupError}</div>}
      {formConfigurationError && <div className="form-feedback" role="alert">{formConfigurationError}</div>}
      <div className="registration-form-layout">
        <form className="registration-form" onSubmit={handleSubmit} noValidate>
          <div className="registration-form-section">
            <h2>Your details</h2>
            <div className="form-grid">
              <label className="form-field"><span>Full name</span><input value={values.full_name} onChange={(event) => updateValue('full_name', event.target.value)} autoComplete="name" aria-invalid={Boolean(errors.full_name)} />{errors.full_name && <small className="field-error">{errors.full_name}</small>}</label>
              <label className="form-field"><span>Email address</span><input type="email" value={values.email} onChange={(event) => updateValue('email', event.target.value)} autoComplete="email" aria-invalid={Boolean(errors.email)} />{errors.email && <small className="field-error">{errors.email}</small>}</label>
              <label className="form-field"><span>Phone number</span><input type="tel" value={values.phone} onChange={(event) => updateValue('phone', event.target.value)} autoComplete="tel" aria-invalid={Boolean(errors.phone)} />{errors.phone && <small className="field-error">{errors.phone}</small>}</label>
              <label className="form-field"><span>Participant type</span><select value={values.participant_type} onChange={(event) => updateValue('participant_type', event.target.value)} aria-invalid={Boolean(errors.participant_type)}><option value="">Select type</option>{participantTypes.map((type) => <option value={type} key={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select>{errors.participant_type && <small className="field-error">{errors.participant_type}</small>}</label>
              <label className="form-field"><span>University</span><select value={values.institution_id} onChange={(event) => void onInstitutionChange(event.target.value)} disabled={allLookupsLoading || !institutions.length} aria-invalid={Boolean(errors.institution_id)}><option value="">Select university</option>{institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{errors.institution_id && <small className="field-error">{errors.institution_id}</small>}</label>
                  <label className="form-field"><span>Department</span><select value={values.department_id} onChange={(event) => updateValue('department_id', event.target.value)} disabled={!values.institution_id || allLookupsLoading} aria-invalid={Boolean(errors.department_id)}><option value="">Select department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{errors.department_id && <small className="field-error">{errors.department_id}</small>}</label>
              <label className="form-field form-field-last"><span>Student / Employee ID</span><input value={values.identity_number} onChange={(event) => updateValue('identity_number', event.target.value)} aria-invalid={Boolean(errors.identity_number)} />{errors.identity_number && <small className="field-error">{errors.identity_number}</small>}</label>
            </div>
          </div>

          {customFields.length > 0 && (
            <div className="registration-form-section">
              <h2>Additional information</h2>
              <div className="form-grid">
                {customFields.map((field) => {
                  const errorKey = `custom:${field.name}`
                  const update = (value) => {
                    setAnswers((current) => ({ ...current, [field.name]: value }))
                    setErrors((current) => ({ ...current, [errorKey]: '' }))
                  }
                  if (field.type === 'checkbox') {
                    return <label className="form-field custom-checkbox-field" key={field.id}><span>{field.label}{field.required ? ' *' : ''}</span><input type="checkbox" checked={Boolean(answers[field.name])} onChange={(event) => update(event.target.checked)} aria-invalid={Boolean(errors[errorKey])} />{errors[errorKey] && <small className="field-error">{errors[errorKey]}</small>}</label>
                  }
                  if (field.type === 'textarea') {
                    return <label className="form-field form-field-full" key={field.id}><span>{field.label}{field.required ? ' *' : ''}</span><textarea rows="4" value={answers[field.name] || ''} onChange={(event) => update(event.target.value)} aria-invalid={Boolean(errors[errorKey])} />{errors[errorKey] && <small className="field-error">{errors[errorKey]}</small>}</label>
                  }
                  if (field.type === 'dropdown') {
                    return <label className="form-field" key={field.id}><span>{field.label}{field.required ? ' *' : ''}</span><select value={answers[field.name] || ''} onChange={(event) => update(event.target.value)} aria-invalid={Boolean(errors[errorKey])}><option value="">Select an option</option>{field.options.map((option) => <option key={`${field.id}-${option.value}`} value={option.value}>{option.label}</option>)}</select>{errors[errorKey] && <small className="field-error">{errors[errorKey]}</small>}</label>
                  }
                  if (field.type === 'radio') {
                    return <fieldset className="form-field form-field-full custom-radio-field" key={field.id} aria-invalid={Boolean(errors[errorKey])}>
                      <legend>{field.label}{field.required ? ' *' : ''}</legend>
                      <div className="custom-radio-options">{field.options.map((option) => (
                        <label key={`${field.id}-${option.value}`}>
                          <input type="radio" name={`custom-${field.name}`} value={option.value} checked={answers[field.name] === option.value} onChange={() => update(option.value)} />
                          <span>{option.label}</span>
                        </label>
                      ))}</div>
                      {errors[errorKey] && <small className="field-error">{errors[errorKey]}</small>}
                    </fieldset>
                  }
                  const type = field.type === 'phone' ? 'tel' : field.type
                  return <label className="form-field" key={field.id}><span>{field.label}{field.required ? ' *' : ''}</span><input type={type} value={answers[field.name] || ''} onChange={(event) => update(event.target.value)} aria-invalid={Boolean(errors[errorKey])} />{errors[errorKey] && <small className="field-error">{errors[errorKey]}</small>}</label>
                })}
              </div>
            </div>
          )}

          {guestSettings.isEnabled && (
            <div className="registration-form-section">
              <h2>Guests &amp; Family</h2>
              <label className="check-option">
                <input type="checkbox" checked={bringingGuests} onChange={(changeEvent) => {
                  setBringingGuests(changeEvent.target.checked)
                  if (changeEvent.target.checked && !guests.length) setGuests([{ full_name: '', relationship: '' }])
                  if (!changeEvent.target.checked) setGuests([])
                }} />
                <span>Are you bringing guest(s)?</span>
              </label>
              {bringingGuests && (
                <div className="guest-registration-list">
                  {guests.map((guest, index) => {
                    const selectedRelationship = guestSettings.relationships.find((relationship) => relationship.value === guest.relationship)
                    return (
                      <div className="guest-registration-row" key={index}>
                        <label className="form-field">
                          <span>Guest {index + 1} full name</span>
                          <input value={guest.full_name} onChange={(changeEvent) => setGuests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, full_name: changeEvent.target.value } : item))} />
                          {errors[`guest_name_${index}`] && <small className="field-error">{errors[`guest_name_${index}`]}</small>}
                        </label>
                        <label className="form-field">
                          <span>Relationship</span>
                          <select value={guest.relationship} onChange={(changeEvent) => setGuests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, relationship: changeEvent.target.value } : item))}>
                            <option value="">Select relationship</option>
                            {guestSettings.relationships.map((relationship) => <option value={relationship.value} key={relationship.value}>{relationship.label} — {formatFee(relationship.fee)}</option>)}
                          </select>
                          {errors[`guest_relationship_${index}`] && <small className="field-error">{errors[`guest_relationship_${index}`]}</small>}
                        </label>
                        {selectedRelationship && <small className="guest-row-fee">Guest fee: {formatFee(selectedRelationship.fee)}</small>}
                        <button className="inline-button danger-link" type="button" onClick={() => setGuests((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove guest</button>
                      </div>
                    )
                  })}
                  {errors.guests && <p className="field-error" role="alert">{errors.guests}</p>}
                  <button
                    className="button button-outline button-small"
                    type="button"
                    disabled={guests.length >= guestSettings.maxGuests || guests.length >= guestSettings.remainingCapacity}
                    onClick={() => setGuests((current) => [...current, { full_name: '', relationship: '' }])}
                  >
                    Add guest
                  </button>
                  {guests.length >= guestSettings.remainingCapacity && guestSettings.remainingCapacity === 0 && <small className="field-error">The event guest admission limit has been reached.</small>}
                </div>
              )}
            </div>
          )}

          <button className="button button-primary button-wide auth-submit" type="submit" disabled={submitting || allLookupsLoading || Boolean(formConfigurationError) || !institutions.length || !departments.length}>
            {submitting ? 'Submitting registration…' : 'Confirm registration'} {!submitting && <Icon name="arrow" size={18} />}
          </button>
        </form>

        <aside className="registration-summary-card">
          <span className="registration-label">REGISTRATION SUMMARY</span>
          <h2>{event.title}</h2>
          <div><span>Participant</span><strong>{values.full_name || 'Your name'}</strong></div>
          <div><span>Participant type</span><strong>{values.participant_type || 'Select a type'}</strong></div>
          <div className="summary-fee"><span>Registration fee</span><strong>{participantFee === null ? 'Select participant type' : formatFee(participantFee)}</strong></div>
          {bringingGuests && guests.map((guest, index) => {
            const relationship = guestSettings.relationships.find((item) => item.value === guest.relationship)
            return relationship ? (
              <div key={index}><span>Guest {index + 1} — {relationship.label}</span><strong>{formatFee(relationship.fee)}</strong></div>
            ) : null
          })}
          {bringingGuests && <div><span>Total guest fee</span><strong>{formatFee(guestFeeTotal)}</strong></div>}
          <div className="summary-fee"><span>Total payable</span><strong>{participantFee === null ? 'Select participant type' : formatFee(grandTotal)}</strong></div>
          <p>The database calculates and validates the final fee. Paid event registrations reserve a seat while payment is awaiting review.</p>
          {event.seat_limit !== null && counts === null && <small>Availability is verified by the database when you submit.</small>}
        </aside>
      </div>
    </section>
  )
}

export default EventRegistration
