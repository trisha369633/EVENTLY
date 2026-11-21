import { useEffect, useState } from 'react'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import { getTicketScannerEvents } from '../../services/ticketService.js'
import {
  assignEventTicketVolunteer,
  getAdminEventTickets,
  getAdminTicketSummary,
  getEventTicketAssignments,
  getTicketVolunteerCandidates,
  revokeEventTicket,
  revokeEventTicketVolunteer,
} from '../../services/ticketService.js'

const pageSize = 20
const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Not checked in' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'revoked', label: 'Revoked' },
]

function ticketStatusLabel(status) {
  return status === 'checked_in' ? 'Checked in' : status === 'active' ? 'Not checked in' : 'Revoked'
}

function Tickets() {
  const [events, setEvents] = useState([])
  const [volunteers, setVolunteers] = useState([])
  const [volunteersLoading, setVolunteersLoading] = useState(true)
  const [eventLoadError, setEventLoadError] = useState('')
  const [volunteerLoadError, setVolunteerLoadError] = useState('')
  const [eventId, setEventId] = useState('')
  const [assignmentEventId, setAssignmentEventId] = useState('')
  const [assignmentVolunteerId, setAssignmentVolunteerId] = useState('')
  const [assignmentResult, setAssignmentResult] = useState({ eventId: '', assignments: [], error: '' })
  const [assignmentActionError, setAssignmentActionError] = useState('')
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [assignmentRetry, setAssignmentRetry] = useState(0)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [result, setResult] = useState({ key: '', tickets: [], count: 0, error: '' })
  const [actionError, setActionError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyTicketId, setBusyTicketId] = useState('')
  const queryKey = JSON.stringify([eventId, status, search, page, retry])
  const loading = result.key !== queryKey
  const assignmentLoading = Boolean(assignmentEventId && assignmentResult.eventId !== assignmentEventId)
  const assignments = assignmentResult.eventId === assignmentEventId ? assignmentResult.assignments : []
  const assignmentError = assignmentResult.eventId === assignmentEventId ? assignmentResult.error : ''

  useEffect(() => {
    let active = true
    Promise.allSettled([getTicketScannerEvents(), getTicketVolunteerCandidates()])
      .then(([eventResult, volunteerResult]) => {
        if (!active) return
        if (eventResult.status === 'fulfilled') {
          setEvents(eventResult.value)
          setEventLoadError('')
          if (eventResult.value.length) {
            setAssignmentEventId((current) => current || String(eventResult.value[0].event_id))
          }
        } else {
          setEventLoadError(eventResult.reason.message || 'Events could not be loaded.')
        }
        if (volunteerResult.status === 'fulfilled') {
          setVolunteers(volunteerResult.value)
          setVolunteerLoadError('')
        } else {
          setVolunteerLoadError(volunteerResult.reason.message || 'Volunteer accounts could not be loaded.')
        }
        setVolunteersLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    getAdminTicketSummary(eventId)
      .then((data) => {
        if (active) {
          setSummary(data)
          setSummaryError('')
        }
      })
      .catch((error) => {
        if (active) setSummaryError(error.message || 'Ticket statistics could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [eventId, retry])

  useEffect(() => {
    let active = true
    getAdminEventTickets({
      eventId,
      status,
      search,
      limit: pageSize,
      offset: page * pageSize,
    })
      .then((data) => {
        if (active) setResult({ key: queryKey, ...data, error: '' })
      })
      .catch((error) => {
        if (active) setResult({ key: queryKey, tickets: [], count: 0, error: error.message || 'Tickets could not be loaded.' })
      })
    return () => {
      active = false
    }
  }, [queryKey, eventId, status, search, page])

  useEffect(() => {
    if (!assignmentEventId) return undefined
    let active = true
    getEventTicketAssignments(assignmentEventId)
      .then((data) => {
        if (active) {
          setAssignmentResult({ eventId: assignmentEventId, assignments: data, error: '' })
        }
      })
      .catch((error) => {
        if (active) setAssignmentResult({
          eventId: assignmentEventId,
          assignments: [],
          error: error.message || 'Event assignments could not be loaded.',
        })
      })
    return () => {
      active = false
    }
  }, [assignmentEventId, assignmentRetry])

  const refresh = () => {
    setSuccess('')
    setRetry((value) => value + 1)
  }

  const updateFilter = (setter, value) => {
    setter(value)
    setPage(0)
  }

  const handleAssign = async (event) => {
    event.preventDefault()
    if (!assignmentEventId || !assignmentVolunteerId) return
    setAssignmentBusy(true)
    setAssignmentActionError('')
    setSuccess('')
    try {
      await assignEventTicketVolunteer({
        eventId: assignmentEventId,
        volunteerUserId: assignmentVolunteerId,
      })
      setSuccess('Volunteer assigned to this event. Ticket-scanning access is now event-scoped.')
      setAssignmentVolunteerId('')
      setAssignmentRetry((value) => value + 1)
    } catch (error) {
      setAssignmentActionError(error.message || 'The volunteer could not be assigned.')
    } finally {
      setAssignmentBusy(false)
    }
  }

  const handleUnassign = async (volunteer) => {
    if (!window.confirm(`Remove ${volunteer.volunteer_name} from this event’s ticket staff?`)) return
    setAssignmentBusy(true)
    setAssignmentActionError('')
    setSuccess('')
    try {
      await revokeEventTicketVolunteer({
        eventId: assignmentEventId,
        volunteerUserId: volunteer.volunteer_user_id,
      })
      setSuccess('Volunteer ticket-scanning access was removed for this event.')
      setAssignmentRetry((value) => value + 1)
    } catch (error) {
      setAssignmentActionError(error.message || 'The event assignment could not be removed.')
    } finally {
      setAssignmentBusy(false)
    }
  }

  const handleRevokeTicket = async (ticket) => {
    if (!window.confirm(`Revoke ticket ${ticket.ticket_reference}? This cannot be undone.`)) return
    setBusyTicketId(String(ticket.ticket_id))
    setActionError('')
    setSuccess('')
    try {
      await revokeEventTicket(ticket.ticket_id)
      setSuccess(`Ticket ${ticket.ticket_reference} was revoked.`)
      setRetry((value) => value + 1)
    } catch (error) {
      setActionError(error.message || 'The ticket could not be revoked.')
    } finally {
      setBusyTicketId('')
    }
  }

  const pageCount = Math.ceil(result.count / pageSize)

  return (
    <section className="admin-page">
      <div className="admin-page-heading">
        <div><span className="eyebrow">ENTRY & ACCESS</span><h1>Ticket management</h1><p>Review issued tickets, entry counts, and event-scoped volunteer access.</p></div>
        <a className="button button-outline" href="/admin/ticket-scanner">Open ticket scanner</a>
      </div>

      {summaryError && <p className="form-feedback" role="alert">{summaryError}</p>}
      <div className="admin-stat-grid ticket-stat-grid">
        <article><span>Tickets issued</span><strong>{summary?.total_tickets ?? '—'}</strong></article>
        <article><span>Checked in</span><strong>{summary?.checked_in_count ?? '—'}</strong></article>
        <article><span>Not checked in</span><strong>{summary?.not_checked_in_count ?? '—'}</strong></article>
        <article><span>Revoked</span><strong>{summary?.revoked_count ?? '—'}</strong></article>
      </div>

      {success && <p className="inline-notice" role="status">{success}</p>}
      {actionError && <p className="form-feedback" role="alert">{actionError}</p>}
      {eventLoadError && <p className="form-feedback" role="alert">{eventLoadError}</p>}
      <section className="ticket-assignment-panel">
        <div className="ticket-section-heading"><div><span className="eyebrow">EVENT-SCOPED ACCESS</span><h2>Volunteer assignments</h2><p>Volunteers can scan tickets only for events assigned by a Super Admin.</p></div></div>
        <label className="form-field ticket-event-select">
          <span>Event</span>
          <select value={assignmentEventId} onChange={(event) => setAssignmentEventId(event.target.value)} disabled={!events.length}>
            {!events.length && <option value="">No events available</option>}
            {events.map((event) => <option value={event.event_id} key={event.event_id}>{event.event_title}</option>)}
          </select>
        </label>
        {volunteerLoadError && <p className="form-feedback" role="alert">{volunteerLoadError}</p>}
        {assignmentError && <p className="form-feedback" role="alert">{assignmentError}</p>}
        {assignmentActionError && <p className="form-feedback" role="alert">{assignmentActionError}</p>}
        <form className="ticket-assignment-form" onSubmit={(event) => void handleAssign(event)}>
          <label className="form-field">
            <span>Volunteer account</span>
            <select value={assignmentVolunteerId} onChange={(event) => setAssignmentVolunteerId(event.target.value)} required>
              <option value="">{volunteersLoading ? 'Loading volunteer accounts…' : 'Select a volunteer'}</option>
              {volunteers.map((volunteer) => <option value={volunteer.volunteer_user_id} key={volunteer.volunteer_user_id}>{volunteer.volunteer_name} · {volunteer.volunteer_email}</option>)}
            </select>
          </label>
          <button className="button button-primary button-small" type="submit" disabled={assignmentBusy || volunteersLoading || !assignmentEventId || !volunteers.length}>
            {assignmentBusy ? 'Saving…' : 'Assign volunteer'}
          </button>
        </form>
        {!assignmentLoading && !assignmentError && !assignmentActionError && assignments.length === 0 && assignmentEventId && <p className="admin-muted">No volunteers are assigned to this event.</p>}
        {assignmentLoading && <p className="admin-muted" role="status">Loading event assignments…</p>}
        {assignments.length > 0 && <div className="ticket-assignment-list">
          {assignments.map((volunteer) => (
            <div className="ticket-assignment-row" key={volunteer.volunteer_user_id}>
              <div><strong>{volunteer.volunteer_name}</strong><small>{volunteer.volunteer_email}</small></div>
              <span className={`ticket-status-badge ${volunteer.is_active ? 'is-active' : 'is-revoked'}`}>{volunteer.is_active ? 'Active' : 'Removed'}</span>
              {volunteer.is_active && <button className="inline-button danger-link" type="button" disabled={assignmentBusy} onClick={() => void handleUnassign(volunteer)}>Remove access</button>}
            </div>
          ))}
        </div>}
      </section>

      <section className="ticket-list-section">
        <div className="ticket-section-heading"><div><span className="eyebrow">ISSUED TICKETS</span><h2>Ticket records</h2></div></div>
        <div className="admin-registration-filters ticket-admin-filters">
          <label className="form-field"><span>Search event or participant</span><input type="search" value={search} onChange={(event) => updateFilter(setSearch, event.target.value)} placeholder="Event, name, email, or reference" /></label>
          <label className="form-field"><span>Event</span><select value={eventId} onChange={(event) => updateFilter(setEventId, event.target.value)}><option value="">All events</option>{events.map((event) => <option value={event.event_id} key={event.event_id}>{event.event_title}</option>)}</select></label>
          <label className="form-field"><span>Ticket status</span><select value={status} onChange={(event) => updateFilter(setStatus, event.target.value)}>{statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        </div>
        <div className="admin-toolbar"><span className="admin-total">{loading ? 'Loading tickets…' : `${result.count} ticket${result.count === 1 ? '' : 's'}`}</span><button className="inline-button" type="button" onClick={refresh}>Refresh</button></div>
        {!loading && result.error && <p className="form-feedback" role="alert">{result.error}<button className="inline-button" type="button" onClick={refresh}>Try again</button></p>}
        {loading && <div className="event-skeleton admin-list-skeleton" aria-label="Loading tickets" aria-busy="true" />}
        {!loading && !result.error && result.tickets.length === 0 && <div className="empty-state"><h2>No tickets found</h2><p>Eligible registration tickets will appear here after ticket setup is applied.</p></div>}
        {!loading && !result.error && result.tickets.length > 0 && (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table ticket-admin-table">
                <thead><tr><th>Ticket / event</th><th>Participant</th><th>Type</th><th>Issued</th><th>Check-in</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{result.tickets.map((ticket) => (
                  <tr key={ticket.ticket_id}>
                    <td><strong>{ticket.ticket_reference}</strong><small>{ticket.event_title}</small></td>
                    <td><strong>{ticket.participant_name}</strong><small>{ticket.participant_email}</small></td>
                    <td className="capitalize">{ticket.participant_type}</td>
                    <td>{formatEventDateTime(ticket.issued_at)}</td>
                    <td>{ticket.checked_in_at ? <><strong>{formatEventDateTime(ticket.checked_in_at)}</strong><small>{ticket.checked_in_by_name || 'Staff account'}</small></> : '—'}</td>
                    <td><span className={`ticket-status-badge is-${ticket.ticket_status}`}>{ticketStatusLabel(ticket.ticket_status)}</span></td>
                    <td>{ticket.ticket_status === 'active' && !ticket.checked_in_at
                      ? <button className="inline-button danger-link" type="button" disabled={busyTicketId === String(ticket.ticket_id)} onClick={() => void handleRevokeTicket(ticket)}>{busyTicketId === String(ticket.ticket_id) ? 'Revoking…' : 'Revoke'}</button>
                      : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {pageCount > 1 && <div className="admin-pagination"><span>Page {page + 1} of {pageCount}</span><div><button className="button button-outline button-small" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
          </>
        )}
      </section>
    </section>
  )
}

export default Tickets
