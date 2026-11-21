import { useEffect, useMemo, useState } from 'react'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatEventDate, formatEventDateTime } from '../../lib/eventUtils.js'
import { getAdminEvents, getAdminRegistrationCounts, updateEventStatus } from '../../services/eventService.js'

const pageSize = 10
const statusOptions = ['all', 'draft', 'published', 'cancelled', 'completed']

function Events() {
  const [events, setEvents] = useState([])
  const [counts, setCounts] = useState({})
  const [statusFilter, setStatusFilter] = useState('all')
  const [institutionFilter, setInstitutionFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState('ascending')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [countError, setCountError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyEvent, setBusyEvent] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    getAdminEvents()
      .then(async (items) => {
        if (!active) return
        setEvents(items)
        try {
          const nextCounts = await getAdminRegistrationCounts(items.map((item) => item.id))
          if (active) setCounts(nextCounts)
        } catch (countLoadError) {
          if (active) setCountError(countLoadError.message || 'Registration totals are not available.')
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Events could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [retry])

  const institutions = useMemo(() => {
    const items = new Map(events.map((event) => [String(event.institution_id), event.institution_name]))
    return [...items].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [events])
  const departments = useMemo(() => {
    const items = new Map(events
      .filter((event) => !institutionFilter || String(event.institution_id) === institutionFilter)
      .filter((event) => event.department_id)
      .map((event) => [String(event.department_id), event.department_name]))
    return [...items].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [events, institutionFilter])

  const filteredEvents = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return events
      .filter((event) => statusFilter === 'all' || event.status === statusFilter)
      .filter((event) => !institutionFilter || String(event.institution_id) === institutionFilter)
      .filter((event) => !departmentFilter || String(event.department_id) === departmentFilter)
      .filter((event) => !normalizedSearch || String(event.title || '').toLocaleLowerCase().includes(normalizedSearch))
      .sort((a, b) => {
        const difference = Date.parse(a.event_start) - Date.parse(b.event_start)
        return sortOrder === 'ascending' ? difference : -difference
      })
  }, [events, statusFilter, institutionFilter, departmentFilter, search, sortOrder])

  const pageCount = Math.ceil(filteredEvents.length / pageSize)
  const pageEvents = filteredEvents.slice(page * pageSize, (page + 1) * pageSize)

  const chooseFilter = (setter, value) => {
    setter(value)
    setPage(0)
  }

  const changeStatus = async () => {
    if (!confirmAction) return
    const { event, status } = confirmAction
    setBusyEvent(String(event.id))
    setError('')
    setSuccess('')
    try {
      await updateEventStatus(event.id, status)
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, status } : item))
      setSuccess(`“${event.title}” is now ${status}.`)
      setConfirmAction(null)
    } catch (updateError) {
      setError(updateError.message || 'The event status could not be updated.')
    } finally {
      setBusyEvent('')
    }
  }

  const promptStatusChange = (event, status) => {
    const action = status === 'published' ? 'publish' : status === 'draft' ? 'return to draft' : 'cancel'
    if (status === 'published') {
      setConfirmAction({ event, status, message: `Publish “${event.title}”? It will become visible on the public events page.` })
    } else {
      setConfirmAction({ event, status, message: `Are you sure you want to ${action} “${event.title}”?` })
    }
  }

  return (
    <section className="admin-page">
      <div className="admin-page-heading">
        <div><span className="eyebrow">EVENT MANAGEMENT</span><h1>Events</h1><p>Create, publish, and manage your campus events.</p></div>
        <a className="button button-primary" href="/admin/events/create">Create event</a>
      </div>
      <div className="admin-toolbar admin-events-toolbar">
        <label className="form-field admin-search-field"><span>Search events</span><input type="search" value={search} onChange={(event) => chooseFilter(setSearch, event.target.value)} placeholder="Search by title" /></label>
        <label className="form-field"><span>University</span><select value={institutionFilter} onChange={(event) => { chooseFilter(setInstitutionFilter, event.target.value); setDepartmentFilter('') }}><option value="">All universities</option>{institutions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Department</span><select value={departmentFilter} onChange={(event) => chooseFilter(setDepartmentFilter, event.target.value)} disabled={!departments.length}><option value="">All departments</option>{departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Event date</span><select value={sortOrder} onChange={(event) => chooseFilter(setSortOrder, event.target.value)}><option value="ascending">Soonest first</option><option value="descending">Latest first</option></select></label>
      </div>
      <div className="admin-toolbar">
        <div className="admin-filter-tabs" role="group" aria-label="Filter events by status">
          {statusOptions.map((status) => (
            <button type="button" className={statusFilter === status ? 'active' : ''} key={status} onClick={() => chooseFilter(setStatusFilter, status)}>
              {status === 'all' ? 'All events' : status[0].toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
        <span className="admin-total">{filteredEvents.length} event{filteredEvents.length === 1 ? '' : 's'}</span>
      </div>
      {error && <div className="form-feedback" role="alert">{error}</div>}
      {success && <p className="inline-notice" role="status">{success}</p>}
      {countError && <p className="inline-notice" role="alert">{countError}</p>}
      {confirmAction && (
        <div className="admin-confirm-banner" role="group" aria-label="Confirm event status change">
          <span>{confirmAction.message}</span>
          <div><button className="button button-primary button-small" type="button" disabled={Boolean(busyEvent)} onClick={() => void changeStatus()}>{busyEvent ? 'Saving…' : 'Confirm'}</button><button className="button button-outline button-small" type="button" onClick={() => setConfirmAction(null)}>Keep event</button></div>
        </div>
      )}
      {loading && <div className="event-skeleton admin-list-skeleton" aria-label="Loading events" aria-busy="true" />}
      {!loading && !error && !filteredEvents.length && (
        <div className="empty-state"><h2>No matching events</h2><p>Try changing the search or filters, or create a new event.</p><a className="button button-outline" href="/admin/events/create">Create event</a></div>
      )}
      {!loading && !error && pageEvents.length > 0 && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Event</th><th>University</th><th>Department</th><th>Event date</th><th>Deadline</th><th>Registrations</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {pageEvents.map((event) => {
                  const count = counts[String(event.id)]
                  return (
                    <tr key={event.id}>
                      <td><strong>{event.title}</strong><small>{event.event_mode}</small></td>
                      <td>{event.institution_name}</td>
                      <td>{event.department_name || '—'}</td>
                      <td>{formatEventDate(event.event_start, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td>{formatEventDateTime(event.registration_deadline)}</td>
                      <td>{count === undefined ? '—' : `${count}${event.seat_limit === null ? '' : ` / ${event.seat_limit}`}`}</td>
                      <td><StatusBadge status={event.status} /></td>
                      <td>
                        <div className="admin-row-actions">
                          <a className="text-link" href={`/admin/events/${event.id}/preview`}>View</a>
                          <a className="text-link" href={`/admin/events/${event.id}/edit`}>Edit</a>
                          {event.status === 'draft' && <button className="inline-button" type="button" disabled={busyEvent === String(event.id)} onClick={() => promptStatusChange(event, 'published')}>Publish</button>}
                          {event.status === 'published' && <>
                            <button className="inline-button" type="button" disabled={busyEvent === String(event.id)} onClick={() => promptStatusChange(event, 'draft')}>Return to draft</button>
                            <button className="inline-button danger-link" type="button" disabled={busyEvent === String(event.id)} onClick={() => promptStatusChange(event, 'cancelled')}>Cancel</button>
                          </>}
                          <a className="text-link" href={`/admin/events/${event.id}/registrations`}>Registrations</a>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && <div className="admin-pagination"><span>Page {page + 1} of {pageCount}</span><div><button className="button button-outline button-small" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
        </>
      )}
      {error && <button className="button button-outline" type="button" onClick={() => { setLoading(true); setError(''); setCountError(''); setRetry((value) => value + 1) }}>Try again</button>}
    </section>
  )
}

export default Events
