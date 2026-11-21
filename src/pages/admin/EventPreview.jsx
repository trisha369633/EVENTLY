import { useEffect, useState } from 'react'
import fallbackImage from '../../assets/hero.png'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatEventDateTime, formatFee, getStartingFee } from '../../lib/eventUtils.js'
import { getAdminEventById } from '../../services/eventService.js'

function EventPreview({ eventId }) {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getAdminEventById(eventId)
      .then((item) => {
        if (active) {
          setEvent(item)
          if (!item) setError('This event could not be found.')
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Event preview could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [eventId])

  if (loading) return <section className="admin-page"><p className="inline-notice" role="status">Loading event preview…</p></section>
  if (error) return <section className="admin-page"><div className="form-feedback" role="alert">{error}</div><a className="button button-outline" href="/admin/events">Back to events</a></section>

  return (
    <section className="admin-page">
      <a className="back-link admin-back-link" href="/admin/events"><span aria-hidden="true">←</span> Event management</a>
      <div className="admin-page-heading"><div><span className="eyebrow">EVENT PREVIEW</span><h1>{event.title}</h1><p>Admin preview · public visibility depends on the event status.</p></div><div className="admin-preview-actions"><StatusBadge status={event.status} /><a className="button button-outline" href={`/admin/events/${event.id}/edit`}>Edit event</a></div></div>
      <article className="event-preview-card">
        <img src={event.cover_image_url || fallbackImage} alt={`${event.title} event`} onError={(imageEvent) => { imageEvent.currentTarget.src = fallbackImage }} />
        <div className="event-preview-content">
          <span className="eyebrow">{event.event_mode} · {event.institution_name}{event.department_name ? ` · ${event.department_name}` : ''}</span>
          <h2>{event.title}</h2>
          <p className="event-preview-short">{event.short_description}</p>
          <p>{event.description}</p>
          <dl className="event-info-list">
            <div><dt>Venue</dt><dd>{event.venue}</dd></div>
            <div><dt>Starts</dt><dd>{formatEventDateTime(event.event_start)}</dd></div>
            <div><dt>Ends</dt><dd>{formatEventDateTime(event.event_end)}</dd></div>
            <div><dt>Registration deadline</dt><dd>{formatEventDateTime(event.registration_deadline)}</dd></div>
            <div><dt>Starting fee</dt><dd>{formatFee(getStartingFee(event))}</dd></div>
            <div><dt>Seat limit</dt><dd>{event.seat_limit === null ? 'Unlimited' : event.seat_limit}</dd></div>
          </dl>
          {Array.isArray(event.custom_form_fields) && event.custom_form_fields.length > 0 && <div><h3>Additional registration fields</h3><ul>{event.custom_form_fields.map((field, index) => <li key={field.id || field.name || index}>{field.label || field.title} · {field.type}{field.required ? ' · required' : ''}</li>)}</ul></div>}
        </div>
      </article>
    </section>
  )
}

export default EventPreview
