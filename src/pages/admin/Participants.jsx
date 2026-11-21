import { useEffect, useMemo, useState } from 'react'
import ReportDateFilter from '../../components/admin/ReportDateFilter.jsx'
import ReportExportButtons from '../../components/admin/ReportExportButtons.jsx'
import { formatReportDate, formatReportNumber, getReportDateBounds } from '../../lib/reportUtils.js'
import { getAdminReportEvents, getAllAdminPaymentReportRows, getReportUnavailableMessage } from '../../services/adminReportService.js'
import { getAdminEventTickets } from '../../services/ticketService.js'
import { getAdminReportRegistrations } from '../../services/registrationService.js'

const pageSize = 20
const initialDateFilter = { preset: 'all', from: '', to: '' }
const emptyRows = []

function groupParticipants(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const key = String(row.user_id)
    if (!key || key === 'null') continue
    const participant = grouped.get(key) || {
      userId: key,
      fullName: row.full_name || 'Name unavailable',
      email: row.email || '—',
      phone: row.phone || '—',
      participantType: row.participant_type || '—',
      institutionName: row.institution_name || '—',
      departmentName: row.department_name || '—',
      registrations: [],
    }
    participant.registrations.push(row)
    if (Date.parse(row.registered_at) > Date.parse(participant.registrations[0].registered_at)) {
      participant.fullName = row.full_name || participant.fullName
      participant.email = row.email || participant.email
      participant.phone = row.phone || participant.phone
      participant.participantType = row.participant_type || participant.participantType
      participant.institutionName = row.institution_name || participant.institutionName
      participant.departmentName = row.department_name || participant.departmentName
    }
    grouped.set(key, participant)
  }
  return [...grouped.values()].sort((a, b) => Date.parse(b.registrations[0].registered_at) - Date.parse(a.registrations[0].registered_at))
}

function participantExportRows(participants) {
  return participants.map((participant) => ({
    name: participant.fullName,
    email: participant.email,
    phone: participant.phone,
    type: participant.participantType,
    institution: participant.institutionName,
    department: participant.departmentName,
    registrations: participant.registrations.length,
    events: [...new Set(participant.registrations.map((row) => row.event?.title).filter(Boolean))].join('; '),
    latestStatus: participant.registrations[0]?.registration_status || '—',
  }))
}

const exportColumns = [
  { key: 'name', label: 'Participant' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'type', label: 'Participant type' },
  { key: 'institution', label: 'Institution' },
  { key: 'department', label: 'Department' },
  { key: 'registrations', label: 'Matching registrations' },
  { key: 'events', label: 'Events' },
  { key: 'latestStatus', label: 'Latest registration status' },
]

function Participants() {
  const [dateFilter, setDateFilter] = useState(initialDateFilter)
  const [events, setEvents] = useState([])
  const [result, setResult] = useState({ key: '', rows: null, error: '' })
  const [eventError, setEventError] = useState('')
  const [search, setSearch] = useState('')
  const [eventId, setEventId] = useState('')
  const [institutionId, setInstitutionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [participantType, setParticipantType] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [detail, setDetail] = useState({ userId: '', registrations: [], payments: [], tickets: [], paymentError: '', ticketError: '', loading: false })
  const bounds = useMemo(() => getReportDateBounds(dateFilter), [dateFilter])
  const requestKey = JSON.stringify([
    bounds.start,
    bounds.endExclusive,
    eventId,
    institutionId,
    departmentId,
    participantType,
    status,
    search,
    retry,
  ])
  const loading = !bounds.error && result.key !== requestKey
  const rows = result.key === requestKey ? result.rows : null
  const loadError = result.key === requestKey ? result.error : ''

  useEffect(() => {
    let active = true
    getAdminReportEvents()
      .then((items) => {
        if (active) setEvents(items)
      })
      .catch((error) => {
        if (active) setEventError(getReportUnavailableMessage(error, 'Event filters'))
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (bounds.error) return undefined
    let active = true
    getAdminReportRegistrations({
      ...bounds,
      eventId,
      institutionId,
      departmentId,
      participantType,
      status,
      search,
    }, { includeParticipantData: true })
      .then((data) => {
        if (active) setResult({ key: requestKey, rows: data, error: '' })
      })
      .catch((error) => {
        if (active) setResult({
          key: requestKey,
          rows: null,
          error: getReportUnavailableMessage(error, 'Participant search'),
        })
      })
    return () => {
      active = false
    }
  }, [bounds, eventId, institutionId, departmentId, participantType, status, search, retry, requestKey])

  const participants = useMemo(() => groupParticipants(rows || emptyRows), [rows])
  const institutionOptions = useMemo(() => [...new Map((rows || emptyRows)
    .filter((row) => row.institution_id)
    .map((row) => [String(row.institution_id), row.institution_name])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name)), [rows])
  const departmentOptions = useMemo(() => [...new Map((rows || emptyRows)
    .filter((row) => row.department_id && (!institutionId || String(row.institution_id) === institutionId))
    .map((row) => [String(row.department_id), row.department_name])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name)), [rows, institutionId])
  const pageCount = Math.ceil(participants.length / pageSize)
  const visibleParticipants = participants.slice(page * pageSize, (page + 1) * pageSize)

  const updateFilter = (setter) => (value) => {
    setter(value)
    setPage(0)
  }
  const openParticipant = async (participant) => {
    setSelectedUserId(participant.userId)
    setDetail({
      userId: participant.userId,
      registrations: [],
      payments: [],
      tickets: [],
      paymentError: '',
      ticketError: '',
      loading: true,
    })
    let registrations
    try {
      registrations = await getAdminReportRegistrations(
        { userId: participant.userId },
        { includeParticipantData: true },
      )
    } catch (error) {
      setDetail((current) => current.userId === participant.userId ? {
        ...current,
        loading: false,
        paymentError: error.message || 'Participant history could not be loaded.',
      } : current)
      return
    }
    const [paymentResult, ticketResult] = await Promise.allSettled([
      getAllAdminPaymentReportRows({ registrationIds: registrations.map((row) => row.id) }),
      getAdminEventTickets({
        search: registrations[0]?.email || participant.email,
        limit: 100,
        offset: 0,
      }),
    ])
    const paymentError = paymentResult.status === 'rejected'
      ? getReportUnavailableMessage(paymentResult.reason, 'Payment history')
      : ''
    const payments = paymentResult.status === 'fulfilled' ? paymentResult.value : []
    const email = registrations[0]?.email || participant.email
    const ticketError = ticketResult.status === 'rejected'
      ? getReportUnavailableMessage(ticketResult.reason, 'Ticket status')
      : ''
    const tickets = ticketResult.status === 'fulfilled'
      ? ticketResult.value.tickets.filter((ticket) => String(ticket.participant_email).toLowerCase() === String(email).toLowerCase())
      : []
    setDetail((current) => current.userId === participant.userId ? {
      userId: participant.userId,
      registrations,
      payments,
      tickets,
      paymentError,
      ticketError,
      loading: false,
    } : current)
  }

  const detailParticipant = detail.userId === selectedUserId
    ? groupParticipants(detail.registrations)[0]
    : null
  const detailPaymentByRegistration = new Map()
  for (const payment of [...detail.payments].sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))) {
    if (!detailPaymentByRegistration.has(String(payment.registration_id))) {
      detailPaymentByRegistration.set(String(payment.registration_id), payment)
    }
  }
  const detailTicketByEvent = new Map(detail.tickets.map((ticket) => [String(ticket.event_id), ticket]))

  const exportRows = participantExportRows(participants)

  return (
    <section className="admin-page report-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">PARTICIPANT MANAGEMENT</span><h1>Participant search</h1><p>Search registered participants and review their Evently registration, payment, and ticket history.</p></div>
        <ReportExportButtons rows={exportRows} columns={exportColumns} fileName="evently-participant-list" disabled={!rows || Boolean(bounds.error) || Boolean(loadError)} />
      </header>
      <div className="report-toolbar">
        <ReportDateFilter value={dateFilter} onChange={updateFilter(setDateFilter)} />
        <label className="form-field"><span>Search participant</span><input type="search" value={search} onChange={(event) => updateFilter(setSearch)(event.target.value)} placeholder="Name, email, phone, or student/employee ID" /></label>
        <label className="form-field"><span>Event</span><select value={eventId} onChange={(event) => updateFilter(setEventId)(event.target.value)}><option value="">All events</option>{events.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <label className="form-field"><span>Institution</span><select value={institutionId} onChange={(event) => { updateFilter(setInstitutionId)(event.target.value); setDepartmentId('') }}><option value="">All institutions</option>{institutionOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Department</span><select value={departmentId} onChange={(event) => updateFilter(setDepartmentId)(event.target.value)}><option value="">All departments</option>{departmentOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Participant type</span><select value={participantType} onChange={(event) => updateFilter(setParticipantType)(event.target.value)}><option value="">All types</option><option value="student">Student</option><option value="teacher">Teacher</option><option value="alumni">Alumni</option></select></label>
        <label className="form-field"><span>Registration status</span><select value={status} onChange={(event) => updateFilter(setStatus)(event.target.value)}><option value="">All statuses</option><option value="registered">Active</option><option value="cancelled">Cancelled</option></select></label>
      </div>
      {eventError && <p className="inline-notice" role="status">{eventError}</p>}
      {bounds.error && <p className="form-feedback" role="alert">{bounds.error}</p>}
      <div className="admin-toolbar"><span className="admin-total">{bounds.error ? 'Date range unavailable' : loading ? 'Searching participants…' : `${formatReportNumber(participants.length)} participants with matching registrations`}</span></div>
      {loadError && <p className="form-feedback" role="alert">{loadError}<button className="inline-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      {loading && <div className="event-skeleton admin-list-skeleton" role="status" aria-label="Searching participants" />}
      {rows && !bounds.error && !loadError && !participants.length && <div className="empty-state"><h2>No participants found</h2><p>No registered participants match these filters. Accounts without registration history are not included in this report.</p></div>}
      {rows && !bounds.error && !loadError && participants.length > 0 && (
        <>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Participant</th><th>Contact</th><th>Type</th><th>Institution / department</th><th>Registrations</th><th>Latest registration</th><th>Profile</th></tr></thead><tbody>
            {visibleParticipants.map((participant) => <tr key={participant.userId}>
              <td><strong>{participant.fullName}</strong></td>
              <td>{participant.email}<small>{participant.phone}</small></td>
              <td className="capitalize">{participant.participantType}</td>
              <td>{participant.institutionName}<small>{participant.departmentName}</small></td>
              <td>{formatReportNumber(participant.registrations.length)}</td>
              <td>{formatReportDate(participant.registrations[0]?.registered_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td><button className="inline-button" type="button" onClick={() => void openParticipant(participant)}>View profile</button></td>
            </tr>)}
          </tbody></table></div>
          {pageCount > 1 && <div className="admin-pagination"><span>Page {page + 1} of {pageCount}</span><div><button className="button button-outline button-small" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
        </>
      )}
      {selectedUserId && (
        <div className="report-dialog-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedUserId('') }}>
          <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="participant-profile-title">
            <header><div><span className="eyebrow">PARTICIPANT PROFILE</span><h2 id="participant-profile-title">{detailParticipant?.fullName || 'Registration history'}</h2></div><button className="inline-button" type="button" onClick={() => setSelectedUserId('')}>Close</button></header>
            {detail.loading ? <p role="status">Loading registration, payment, and ticket history…</p> : (
              <>
                {detailParticipant && <dl className="participant-profile-details"><div><dt>Email</dt><dd>{detailParticipant.email}</dd></div><div><dt>Phone</dt><dd>{detailParticipant.phone || '—'}</dd></div><div><dt>Participant type</dt><dd className="capitalize">{detailParticipant.participantType}</dd></div><div><dt>Institution</dt><dd>{detailParticipant.institutionName}</dd></div><div><dt>Department</dt><dd>{detailParticipant.departmentName}</dd></div></dl>}
                {detail.paymentError && <p className="inline-notice" role="status">{detail.paymentError}</p>}
                {detail.ticketError && <p className="inline-notice" role="status">{detail.ticketError}</p>}
                <h3>Registration history</h3>
                {!detail.registrations.length ? <p>No registration history is available.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event</th><th>Registered</th><th>Registration</th><th>Payment</th><th>Ticket</th></tr></thead><tbody>
                  {detail.registrations.map((registration) => {
                    const payment = detailPaymentByRegistration.get(String(registration.id))
                    const ticket = detailTicketByEvent.get(String(registration.event_id))
                    return <tr key={registration.id}><td>{registration.event?.title || 'Event unavailable'}</td><td>{formatReportDate(registration.registered_at, { dateStyle: 'medium', timeStyle: 'short' })}</td><td className="capitalize">{registration.registration_status}</td><td className="capitalize">{payment?.payment_status || (detail.paymentError ? 'unavailable' : Number(registration.fee_amount) > 0 ? 'not submitted' : 'not required')}</td><td className="capitalize">{ticket?.ticket_status || (detail.ticketError ? 'unavailable' : 'not issued')}</td></tr>
                  })}
                </tbody></table></div>}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

export default Participants
