import EventForm from '../../components/admin/EventForm.jsx'
import { navigate } from '../../lib/navigation.js'

function CreateEvent() {
  return (
    <section className="admin-page">
      <a className="back-link admin-back-link" href="/admin/events"><span aria-hidden="true">←</span> Event management</a>
      <div className="admin-page-heading"><div><span className="eyebrow">NEW EVENT</span><h1>Create an event</h1><p>Build and publish a campus event. Drafts remain hidden from public listings.</p></div></div>
      <EventForm onSaved={(event) => navigate(`/admin/events/${event.id}/edit?created=1`, { replace: true })} />
    </section>
  )
}

export default CreateEvent