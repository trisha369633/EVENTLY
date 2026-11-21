import { useEffect, useState } from 'react'
import EventForm from '../../components/admin/EventForm.jsx'
import { getAdminEventById } from '../../services/eventService.js'

function EditEvent({ eventId }) {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(() => (
    new URLSearchParams(window.location.search).get('created') === '1' ? 'Event created successfully.' : ''
  ))

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
        if (active) setError(loadError.message || 'Event details could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [eventId])

  return (
    <section className="admin-page">
      <a className="back-link admin-back-link" href="/admin/events"><span aria-hidden="true">←</span> Event management</a>
      {loading && <p className="inline-notice" role="status">Loading event…</p>}
      {error && <div className="form-feedback" role="alert">{error}</div>}
      {event && <>
        <div className="admin-page-heading"><div><span className="eyebrow">EDIT EVENT</span><h1>{event.title}</h1><p>Changes are saved directly to the existing events table.</p></div><a className="button button-outline" href={`/admin/events/${event.id}/preview`}>Preview</a></div>
        {success && <p className="inline-notice" role="status">{success}</p>}
        <EventForm key={event.id} event={event} onSaved={() => setSuccess('Event changes saved successfully.')} />
      </>}
    </section>
  )
}

export default EditEvent
