import { useEffect, useState } from 'react'
import fallbackImage from '../../assets/hero.png'
import Icon from '../../components/Icon.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { useAuth } from '../../context/useAuth.js'
import { formatEventDateTime, formatFee, getRegistrationAvailability, getStartingFee } from '../../lib/eventUtils.js'
import { getOwnRegisteredEventBySlug, getPublishedEventBySlug, getPublicRegistrationCounts } from '../../services/eventService.js'
import { getRegistrationByEvent } from '../../services/registrationService.js'

function EventDetails({ slug }) {
  const [event, setEvent] = useState(null)
  const [registrationCount, setRegistrationCount] = useState(null)
  const [registration, setRegistration] = useState(null)
  const [registrationUserId, setRegistrationUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  const [imageSource, setImageSource] = useState('')
  const { user, roles, loading: authLoading } = useAuth()

  useEffect(() => {
    if (authLoading) return undefined
    let active = true
    getPublishedEventBySlug(slug)
      .then(async (item) => {
        if (!active) return
        let visibleEvent = item
        if (!visibleEvent && user) {
          try {
            visibleEvent = await getOwnRegisteredEventBySlug(slug)
          } catch {
            visibleEvent = null
          }
        }
        if (!active) return
        setEvent(visibleEvent)
        setImageSource(visibleEvent?.cover_image_url || fallbackImage)
        if (!visibleEvent) return
        if (visibleEvent.status !== 'published') {
          setRegistrationCount(null)
          return
        }
        try {
          const counts = await getPublicRegistrationCounts([visibleEvent.id])
          if (active) setRegistrationCount(counts[String(visibleEvent.id)] ?? 0)
        } catch {
          if (active) setRegistrationCount(null)
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
  }, [slug, user, authLoading])

  useEffect(() => {
    if (authLoading || !user || !event) return undefined
    let active = true
    getRegistrationByEvent(event.id)
      .then((item) => {
        if (active) {
          setRegistration(item)
          setRegistrationError('')
        }
      })
      .catch((loadError) => {
        if (active) setRegistrationError(loadError.message || 'Your registration status could not be checked.')
      })
      .finally(() => {
        if (active) setRegistrationUserId(user.id)
      })
    return () => {
      active = false
    }
  }, [user, authLoading, event])

  const currentRegistration = user?.id === registrationUserId ? registration : null
  const currentRegistrationError = user?.id === registrationUserId ? registrationError : ''
  const registrationLoading = Boolean(user && !authLoading && event && user.id !== registrationUserId)

  if (loading) {
    return <section className="container event-page-state" aria-live="polite"><div className="event-skeleton event-detail-skeleton" /><p>Loading event details…</p></section>
  }
  if (error) {
    return <section className="not-found container" role="alert"><span className="eyebrow">EVENT UNAVAILABLE</span><h1>We couldn’t load this event.</h1><p>{error}</p><a className="button button-outline" href="/events">Explore events</a></section>
  }
  if (!event) {
    return <section className="not-found container"><span className="eyebrow">EVENT NOT FOUND</span><h1>We couldn’t find that event.</h1><p>It may have moved or is no longer available.</p><a className="button button-primary" href="/events">Explore events</a></section>
  }

  const availability = getRegistrationAvailability(event, registrationCount)
  const canRegister = roles.includes('participant')
  const registrationHref = `/events/${encodeURIComponent(event.slug)}/register`

  return (
    <div className="detail-page">
      <section className="detail-cover">
        <img src={imageSource} alt={`${event.title} event`} onError={() => setImageSource(fallbackImage)} />
        <div className="detail-cover-shade" />
        <div className="container detail-cover-content">
          <a className="back-link" href="/events"><span aria-hidden="true">←</span> All events</a>
          <div className="detail-cover-title">
            <span className="category-tag category-tag-light">{event.event_mode}</span>
            <h1>{event.title}</h1>
            <p>{event.department_name ? `${event.department_name} · ` : ''}{event.institution_name}</p>
          </div>
          <StatusBadge status={availability.state} />
        </div>
      </section>

      <div className="container detail-layout">
        <article className="detail-main">
          <div className="detail-intro">
            <div className="detail-meta">
              <span><Icon name="calendar" size={17} />{formatEventDateTime(event.event_start)}</span>
              <span><Icon name="location" size={17} />{event.venue}</span>
            </div>
            <p>{event.short_description}</p>
          </div>
          <section className="detail-section">
            <h2>About the event</h2>
            <p>{event.description}</p>
          </section>
          <section className="detail-section">
            <h2>Event information</h2>
            <dl className="event-info-list">
              <div><dt>University</dt><dd>{event.institution_name}</dd></div>
              {event.department_name && <div><dt>Department</dt><dd>{event.department_name}</dd></div>}
              <div><dt>Mode</dt><dd>{event.event_mode}</dd></div>
              <div><dt>Venue</dt><dd>{event.venue}</dd></div>
              <div><dt>Starts</dt><dd>{formatEventDateTime(event.event_start)}</dd></div>
              <div><dt>Ends</dt><dd>{formatEventDateTime(event.event_end)}</dd></div>
            </dl>
          </section>
          <section className="detail-section">
            <h2>Registration fees</h2>
            <dl className="event-info-list">
              <div><dt>Student</dt><dd>{formatFee(event.student_fee)}</dd></div>
              <div><dt>Teacher</dt><dd>{formatFee(event.teacher_fee)}</dd></div>
              <div><dt>Alumni</dt><dd>{formatFee(event.alumni_fee)}</dd></div>
            </dl>
            <p className="detail-muted">The registration fee depends on participant type. If the selected fee is greater than zero, manual payment follows sign-up.</p>
          </section>
        </article>

        <aside className="registration-card">
          <span className="registration-label">YOUR CAMPUS EXPERIENCE</span>
          <div className="registration-status"><span>Registration</span><StatusBadge status={availability.state} /></div>
          <div className="registration-fee"><small>Starting from</small><strong>{formatFee(getStartingFee(event))}</strong><span>registration fee; manual payment follows for paid registrations</span></div>
          <div className="registration-facts">
            <div><Icon name="calendar" size={17} /><span><small>Event starts</small><strong>{formatEventDateTime(event.event_start)}</strong></span></div>
            <div><Icon name="clock" size={17} /><span><small>Registration deadline</small><strong className="deadline">{formatEventDateTime(event.registration_deadline)}</strong></span></div>
            {event.seat_limit !== null && (
              <div><Icon name="people" size={17} /><span><small>Seat availability</small><strong>{availability.remaining === null ? `${event.seat_limit} seat limit` : `${availability.remaining} of ${event.seat_limit} remaining`}</strong></span></div>
            )}
          </div>
          {event.status === 'published' && event.seat_limit !== null && registrationCount === null && <p className="registration-note">Exact seat counts require the manual count RPC setup. Supabase verifies availability when you register.</p>}
          {registrationLoading ? <p className="inline-notice" role="status">Checking your registration…</p>
            : currentRegistrationError ? <p className="field-error" role="alert">{currentRegistrationError}</p>
              : currentRegistration?.registration_status === 'registered' ? <button className="button button-outline button-wide" type="button" disabled>Already registered</button>
                : currentRegistration?.registration_status === 'cancelled' ? <p className="inline-notice">Your registration was cancelled. Contact the event organizer for help.</p>
                  : availability.closed ? <button className="button button-primary button-wide" type="button" disabled>{availability.state}</button>
                    : !user ? <a className="button button-primary button-wide" href={`/login?next=${encodeURIComponent(registrationHref)}`}>Login to register <Icon name="arrow" size={18} /></a>
                      : canRegister ? <a className="button button-primary button-wide" href={registrationHref}>Register now <Icon name="arrow" size={18} /></a>
                        : <p className="inline-notice">Registration is available to participant accounts.</p>}
        </aside>
      </div>
    </div>
  )
}

export default EventDetails
