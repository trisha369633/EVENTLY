import { useEffect, useState } from 'react'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatEventDate, formatFee, formatEventDateTime } from '../../lib/eventUtils.js'
import { getAdminEventById } from '../../services/eventService.js'
import { getEventRegistrations } from '../../services/registrationService.js'
import { getSupabaseClient } from '../../lib/supabase.js'

async function getLabels(registrations) {
  const client = getSupabaseClient()
  const institutionIds = [...new Set(registrations.map((row) => row.institution_id).filter(Boolean))]
  const departmentIds = [...new Set(registrations.map((row) => row.department_id).filter(Boolean))]
  const [institutionsResult, departmentsResult] = await Promise.all([
    institutionIds.length ? client.from('institutions').select('id, name').in('id', institutionIds) : Promise.resolve({ data: [], error: null }),
    departmentIds.length ? client.from('departments').select('id, name').in('id', departmentIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (institutionsResult.error) throw institutionsResult.error
  if (departmentsResult.error) throw departmentsResult.error
  const institutions = new Map((institutionsResult.data || []).map((item) => [item.id, item.name]))
  const departments = new Map((departmentsResult.data || []).map((item) => [item.id, item.name]))
  return registrations.map((registration) => ({
    ...registration,
    institution_name: institutions.get(registration.institution_id) || '—',
    department_name: departments.get(registration.department_id) || '—',
  }))
}

function EventRegistrations({ eventId }) {
  const [event, setEvent] = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getAdminEventById(eventId), getEventRegistrations(eventId)])
      .then(async ([nextEvent, nextRegistrations]) => {
        if (!active) return
        if (!nextEvent) {
          setError('This event could not be found.')
          return
        }
        setEvent(nextEvent)
        setRegistrations(await getLabels(nextRegistrations))
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Registrations could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [eventId])

  const visibleRegistrations = registrations.filter((item) => filter === 'all' || item.registration_status === filter)

  return (
    <section className="admin-page">
      <a className="back-link admin-back-link" href="/admin/events"><span aria-hidden="true">←</span> Event management</a>
      {loading && <p className="inline-notice" role="status">Loading event registrations…</p>}
      {error && <div className="form-feedback" role="alert">{error}</div>}
      {!loading && event && (
        <>
          <div className="admin-page-heading">
            <div><span className="eyebrow">REGISTRATION OVERVIEW</span><h1>{event.title}</h1><p>{formatEventDateTime(event.event_start)} · {event.venue}</p></div>
            <a className="button button-outline" href={`/admin/events/${event.id}/edit`}>Edit event</a>
          </div>
          <div className="admin-toolbar">
            <div className="admin-filter-tabs" role="group" aria-label="Filter registrations">
              {['all', 'registered', 'cancelled'].map((status) => <button type="button" className={filter === status ? 'active' : ''} key={status} onClick={() => setFilter(status)}>{status === 'all' ? 'All' : status[0].toUpperCase() + status.slice(1)}</button>)}
            </div>
            <span className="admin-total">{visibleRegistrations.length} registration{visibleRegistrations.length === 1 ? '' : 's'}</span>
          </div>
          {visibleRegistrations.length === 0 ? <div className="empty-state"><h2>No registrations yet</h2><p>Registrations will appear here after participants sign up.</p></div> : (
            <div className="admin-table-wrap">
              <table className="admin-table registrations-table">
                <thead><tr><th>Participant</th><th>Type / ID</th><th>University / Department</th><th>Fee</th><th>Status</th><th>Registered</th><th>Additional answers</th></tr></thead>
                <tbody>
                  {visibleRegistrations.map((registration) => (
                    <tr key={registration.id}>
                      <td><strong>{registration.full_name}</strong><small><a href={`mailto:${registration.email}`}>{registration.email}</a></small><small>{registration.phone}</small></td>
                      <td>{registration.participant_type}<small>{registration.identity_number}</small></td>
                      <td>{registration.institution_name}<small>{registration.department_name}</small></td>
                      <td>{formatFee(registration.fee_amount)}</td>
                      <td><StatusBadge status={registration.registration_status} /></td>
                      <td>{formatEventDate(registration.registered_at, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td>{Object.keys(registration.form_answers || {}).length
                        ? <details className="answers-details"><summary>View answers</summary><dl>{Object.entries(registration.form_answers).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</dd></div>)}</dl></details>
                        : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default EventRegistrations
