import { useEffect, useState } from 'react'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatEventDateTime, formatFee } from '../../lib/eventUtils.js'
import { getAdminEvents } from '../../services/eventService.js'
import { getAdminRegistrations } from '../../services/registrationService.js'

const pageSize = 20

function AllRegistrations() {
  const [events, setEvents] = useState([])
  const [eventsError, setEventsError] = useState('')
  const [search, setSearch] = useState('')
  const [eventId, setEventId] = useState('')
  const [participantType, setParticipantType] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [result, setResult] = useState({ key: '', registrations: [], count: 0, error: '' })
  const requestKey = JSON.stringify([page, search, eventId, participantType, status])
  const loading = result.key !== requestKey

  useEffect(() => {
    let active = true
    getAdminEvents()
      .then((items) => {
        if (active) setEvents(items)
      })
      .catch((error) => {
        if (active) setEventsError(error.message || 'Event filters could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    getAdminRegistrations({ page, pageSize, search, eventId, participantType, status })
      .then((response) => {
        if (active) setResult({ key: requestKey, ...response, error: '' })
      })
      .catch((error) => {
        if (active) setResult({ key: requestKey, registrations: [], count: 0, error: error.message || 'Registrations could not be loaded.' })
      })
    return () => {
      active = false
    }
  }, [requestKey, page, search, eventId, participantType, status])

  const updateFilter = (setter, value) => {
    setter(value)
    setPage(0)
  }
  const pageCount = Math.ceil(result.count / pageSize)
  const registrations = loading ? [] : result.registrations

  return (
    <section className="admin-page">
      <div className="admin-page-heading">
        <div><span className="eyebrow">PARTICIPANT RECORDS</span><h1>All registrations</h1><p>Search authorized registration records across events.</p></div>
      </div>
      {eventsError && <p className="inline-notice" role="alert">{eventsError}</p>}
      <div className="admin-registration-filters">
        <label className="form-field"><span>Search participant</span><input type="search" value={search} onChange={(changeEvent) => updateFilter(setSearch, changeEvent.target.value)} placeholder="Name, email, phone, or ID" /></label>
        <label className="form-field"><span>Event</span><select value={eventId} onChange={(changeEvent) => updateFilter(setEventId, changeEvent.target.value)}><option value="">All events</option>{events.map((event) => <option value={event.id} key={event.id}>{event.title}</option>)}</select></label>
        <label className="form-field"><span>Participant type</span><select value={participantType} onChange={(changeEvent) => updateFilter(setParticipantType, changeEvent.target.value)}><option value="">All types</option><option value="student">Student</option><option value="teacher">Teacher</option><option value="alumni">Alumni</option></select></label>
        <label className="form-field"><span>Status</span><select value={status} onChange={(changeEvent) => updateFilter(setStatus, changeEvent.target.value)}><option value="">All statuses</option><option value="registered">Registered</option><option value="cancelled">Cancelled</option></select></label>
      </div>
      <div className="admin-toolbar"><span className="admin-total">{loading ? 'Loading registrations…' : `${result.count} registration${result.count === 1 ? '' : 's'}`}</span></div>
      {!loading && result.error && <div className="form-feedback" role="alert">{result.error}</div>}
      {loading && <div className="event-skeleton admin-list-skeleton" aria-label="Loading registrations" aria-busy="true" />}
      {!loading && !result.error && registrations.length === 0 && <div className="empty-state"><h2>No registrations found</h2><p>Try changing the search or filters.</p></div>}
      {!loading && !result.error && registrations.length > 0 && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table registrations-table all-registrations-table">
              <thead><tr><th>Participant</th><th>Type / identity</th><th>University</th><th>Department</th><th>Event</th><th>Registration date</th><th>Fee snapshot</th><th>Status</th></tr></thead>
              <tbody>{registrations.map((registration) => (
                <tr key={registration.id}>
                  <td><strong>{registration.full_name}</strong><small><a href={`mailto:${registration.email}`}>{registration.email}</a></small><small>{registration.phone}</small></td>
                  <td><span className="capitalize">{registration.participant_type}</span><small>{registration.identity_number || '—'}</small></td>
                  <td>{registration.institution_name}</td>
                  <td>{registration.department_name}</td>
                  <td>{registration.event?.title || 'Event unavailable'}</td>
                  <td>{formatEventDateTime(registration.registered_at)}</td>
                  <td>{formatFee(registration.fee_amount)}</td>
                  <td><StatusBadge status={registration.registration_status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {pageCount > 1 && <div className="admin-pagination"><span>Page {page + 1} of {pageCount}</span><div><button className="button button-outline button-small" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
        </>
      )}
    </section>
  )
}

export default AllRegistrations
