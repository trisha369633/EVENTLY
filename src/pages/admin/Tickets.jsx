import { useEffect, useState } from 'react'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import {
  getAdminTicketRecords,
  getAdminTicketSummary,
  getTicketScannerEvents,
  revokeEventTicket,
} from '../../services/ticketService.js'

const pageSize = 20
const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'revoked', label: 'Revoked' },
]

function attendeeTypeLabel(value) {
  const type = String(value || 'participant').trim().replaceAll('_', ' ')
  return type ? `${type[0].toUpperCase()}${type.slice(1).toLowerCase()}` : 'Participant'
}

function activeTicketCount(summary) {
  if (!summary) return '—'
  if (summary.active_tickets != null) return summary.active_tickets
  if (summary.active_count != null) return summary.active_count
  if (summary.checked_in_count != null || summary.not_checked_in_count != null) {
    return Number(summary.checked_in_count || 0) + Number(summary.not_checked_in_count || 0)
  }
  if (summary.total_tickets != null && summary.revoked_count != null) {
    return Math.max(0, Number(summary.total_tickets) - Number(summary.revoked_count))
  }
  return '—'
}

function Tickets() {
  const [events, setEvents] = useState([])
  const [eventLoadError, setEventLoadError] = useState('')
  const [eventId, setEventId] = useState('')
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

  useEffect(() => {
    let active = true
    getTicketScannerEvents()
      .then((eventResult) => {
        if (!active) return
        setEvents(eventResult)
        setEventLoadError('')
      })
      .catch((error) => {
        if (active) setEventLoadError(error.message || 'Events could not be loaded.')
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
    getAdminTicketRecords({
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

  const refresh = () => {
    setSuccess('')
    setRetry((value) => value + 1)
  }

  const updateFilter = (setter, value) => {
    setter(value)
    setPage(0)
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
        <div><span className="eyebrow">ENTRY & ACCESS</span><h1>Ticket Management</h1><p>Review issued tickets and entry counts.</p></div>
        <a className="button button-outline" href="/admin/ticket-scanner">Open ticket scanner</a>
      </div>

      {summaryError && <p className="form-feedback" role="alert">{summaryError}</p>}
      <div className="admin-stat-grid ticket-stat-grid">
        <article><span>Tickets issued</span><strong>{summary?.total_tickets ?? '—'}</strong></article>
        <article><span>Active tickets</span><strong>{activeTicketCount(summary)}</strong></article>
        <article><span>Revoked</span><strong>{summary?.revoked_count ?? '—'}</strong></article>
      </div>

      {success && <p className="inline-notice" role="status">{success}</p>}
      {actionError && <p className="form-feedback" role="alert">{actionError}</p>}
      {eventLoadError && <p className="form-feedback" role="alert">{eventLoadError}</p>}

      <section className="ticket-list-section">
        <div className="ticket-section-heading"><div><span className="eyebrow">ISSUED TICKETS</span><h2>Ticket records</h2></div></div>
        <div className="admin-registration-filters ticket-admin-filters">
          <label className="form-field"><span>Search event or participant</span><input type="search" value={search} onChange={(event) => updateFilter(setSearch, event.target.value)} placeholder="Event, name, email, or reference" /></label>
          <label className="form-field"><span>Event</span><select value={eventId} onChange={(event) => updateFilter(setEventId, event.target.value)}><option value="">All events</option>{events.map((event) => <option value={event.event_id} key={event.event_id}>{event.event_title}</option>)}</select></label>
          <label className="form-field"><span>Ticket status</span><select value={status} onChange={(event) => updateFilter(setStatus, event.target.value)}>{statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        </div>
        <div className="admin-toolbar"><span className="admin-total">{loading ? 'Loading tickets…' : `${result.tickets.length} ticket${result.tickets.length === 1 ? '' : 's'}`}</span><button className="inline-button" type="button" onClick={refresh}>Refresh</button></div>
        {!loading && result.error && <p className="form-feedback" role="alert">{result.error}<button className="inline-button" type="button" onClick={refresh}>Try again</button></p>}
        {loading && <div className="event-skeleton admin-list-skeleton" aria-label="Loading tickets" aria-busy="true" />}
        {!loading && !result.error && result.tickets.length === 0 && <div className="empty-state"><h2>No tickets found</h2><p>Eligible registration tickets will appear here after ticket setup is applied.</p></div>}
        {!loading && !result.error && result.tickets.length > 0 && (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table ticket-admin-table">
                <thead><tr><th>TICKET / EVENT</th><th>PARTICIPANT</th><th>TYPE</th><th>ISSUED</th><th>ISSUED BY</th><th>REMOVE TICKET</th></tr></thead>
                <tbody>{result.tickets.map((ticket) => (
                  <tr key={ticket.ticket_id}>
                    <td><strong>{ticket.ticket_reference}</strong><small>{ticket.event_title}</small>{ticket.ticket_status === 'revoked' && <span className="ticket-status-badge is-revoked">Revoked</span>}</td>
                    <td><strong>{ticket.attendee_name || ticket.participant_name || '—'}</strong>{(ticket.participant_email || ticket.attendee_email) && <small>{ticket.participant_email || ticket.attendee_email}</small>}</td>
                    <td>{attendeeTypeLabel(ticket.attendee_type)}</td>
                    <td>{formatEventDateTime(ticket.issued_at)}</td>
                    <td>{ticket.issuer_name
                      ? <><strong>{ticket.issuer_name}</strong>{ticket.issuer_email && <small>{ticket.issuer_email}</small>}</>
                      : ticket.issuer_email || (ticket.issued_by ? 'Issuer unavailable' : 'System / Auto-issued')}</td>
                    <td>{ticket.ticket_status !== 'revoked'
                      ? <button className="inline-button danger-link" type="button" disabled={busyTicketId === String(ticket.ticket_id)} onClick={() => void handleRevokeTicket(ticket)}>{busyTicketId === String(ticket.ticket_id) ? 'Removing…' : 'Remove ticket'}</button>
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
