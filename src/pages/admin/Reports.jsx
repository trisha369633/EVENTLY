import { useEffect, useMemo, useState } from 'react'
import ReportDateFilter from '../../components/admin/ReportDateFilter.jsx'
import { ReportBarList, ReportTrendChart } from '../../components/admin/ReportCharts.jsx'
import ReportExportButtons from '../../components/admin/ReportExportButtons.jsx'
import { formatReportDate, formatReportNumber, getReportDateBounds } from '../../lib/reportUtils.js'
import { getAdminRegistrationCounts } from '../../services/eventService.js'
import { getAdminReportEvents } from '../../services/adminReportService.js'
import { getAdminReportRegistrations } from '../../services/registrationService.js'
import { listInstitutions } from '../../services/profileService.js'

const initialDateFilter = { preset: 'last30', from: '', to: '' }
const participantTypes = ['student', 'teacher', 'alumni']

function Reports() {
  const [dateFilter, setDateFilter] = useState(initialDateFilter)
  const [eventFilter, setEventFilter] = useState('')
  const [institutionFilter, setInstitutionFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [participantTypeFilter, setParticipantTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [registrations, setRegistrations] = useState(null)
  const [events, setEvents] = useState(null)
  const [institutions, setInstitutions] = useState([])
  const [capacityCounts, setCapacityCounts] = useState({})
  const [errors, setErrors] = useState({})
  const [loadedKey, setLoadedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const bounds = useMemo(() => getReportDateBounds(dateFilter), [dateFilter])
  const requestKey = JSON.stringify([bounds.start, bounds.endExclusive, retry])
  const loading = loadedKey !== requestKey

  useEffect(() => {
    if (bounds.error) return undefined
    let active = true
    Promise.allSettled([
      getAdminReportRegistrations(bounds),
      getAdminReportEvents(),
      listInstitutions(),
    ]).then(async ([registrationResult, eventResult, institutionResult]) => {
      if (!active) return
      const nextErrors = {}
      const nextRegistrations = registrationResult.status === 'fulfilled' ? registrationResult.value : null
      const nextEvents = eventResult.status === 'fulfilled' ? eventResult.value : null
      const nextInstitutions = institutionResult.status === 'fulfilled' ? institutionResult.value : []
      if (registrationResult.status === 'rejected') nextErrors.registrations = registrationResult.reason?.message || 'Registration analytics could not be loaded.'
      if (eventResult.status === 'rejected') nextErrors.events = eventResult.reason?.message || 'Event filters could not be loaded.'
      if (institutionResult.status === 'rejected') nextErrors.institutions = institutionResult.reason?.message || 'Institution filters could not be loaded.'
      setRegistrations(nextRegistrations)
      setEvents(nextEvents)
      setInstitutions(nextInstitutions)

      if (nextEvents) {
        try {
          const counts = await getAdminRegistrationCounts(nextEvents.map((event) => event.id))
          if (active) setCapacityCounts(counts)
        } catch (error) {
          nextErrors.capacity = error.message || 'Capacity totals could not be loaded.'
        }
      }
      if (active) setErrors(nextErrors)
    }).finally(() => {
      if (active) setLoadedKey(requestKey)
    })
    return () => {
      active = false
    }
  }, [bounds, retry, requestKey])

  const institutionOptions = useMemo(() => {
    const options = new Map(institutions.map((item) => [String(item.id), item.name]))
    for (const row of registrations || []) {
      if (row.institution_id) options.set(String(row.institution_id), row.institution_name)
    }
    return [...options].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [institutions, registrations])
  const departmentOptions = useMemo(() => {
    const options = new Map()
    for (const row of registrations || []) {
      if (row.department_id && (!institutionFilter || String(row.institution_id) === institutionFilter)) {
        options.set(String(row.department_id), row.department_name)
      }
    }
    return [...options].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [registrations, institutionFilter])

  const filteredRows = useMemo(() => (registrations || [])
    .filter((row) => !eventFilter || String(row.event_id) === eventFilter)
    .filter((row) => !institutionFilter || String(row.institution_id) === institutionFilter)
    .filter((row) => !departmentFilter || String(row.department_id) === departmentFilter)
    .filter((row) => !participantTypeFilter || row.participant_type === participantTypeFilter)
    .filter((row) => !statusFilter || row.registration_status === statusFilter), [
    registrations,
    eventFilter,
    institutionFilter,
    departmentFilter,
    participantTypeFilter,
    statusFilter,
  ])
  const activeRows = filteredRows.filter((row) => row.registration_status === 'registered')
  const cancelledRows = filteredRows.filter((row) => row.registration_status === 'cancelled')
  const byType = participantTypes.map((type) => ({
    key: type,
    label: type[0].toUpperCase() + type.slice(1),
    value: filteredRows.filter((row) => row.participant_type === type).length,
  }))
  const byEvent = useMemo(() => {
    const counts = new Map()
    for (const row of filteredRows) {
      const key = String(row.event_id)
      const item = counts.get(key) || { key, label: row.event?.title || 'Event unavailable', value: 0 }
      item.value += 1
      counts.set(key, item)
    }
    return [...counts.values()].sort((a, b) => b.value - a.value)
  }, [filteredRows])
  const byInstitution = useMemo(() => {
    const counts = new Map()
    for (const row of filteredRows) {
      const key = String(row.institution_id || 'unknown')
      const item = counts.get(key) || { key, label: row.institution_name || 'Unknown institution', value: 0 }
      item.value += 1
      counts.set(key, item)
    }
    return [...counts.values()].sort((a, b) => b.value - a.value)
  }, [filteredRows])
  const byDepartment = useMemo(() => {
    const counts = new Map()
    for (const row of filteredRows) {
      const key = String(row.department_id || 'unknown')
      const item = counts.get(key) || { key, label: row.department_name || 'No department recorded', value: 0 }
      item.value += 1
      counts.set(key, item)
    }
    return [...counts.values()].sort((a, b) => b.value - a.value)
  }, [filteredRows])
  const trend = useMemo(() => {
    const counts = new Map()
    for (const row of filteredRows) {
      const date = new Date(row.registered_at)
      if (Number.isNaN(date.getTime())) continue
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ label: key.slice(5), value }))
  }, [filteredRows])
  const seatRows = useMemo(() => {
    const counts = new Map()
    for (const row of filteredRows) counts.set(String(row.event_id), (counts.get(String(row.event_id)) || 0) + 1)
    return (events || [])
      .filter((event) => !eventFilter || String(event.id) === eventFilter)
      .map((event) => {
        const registered = Number(capacityCounts[String(event.id)] ?? 0)
        const limit = event.seat_limit === null ? null : Number(event.seat_limit)
        return {
          event,
          rangeRegistrations: counts.get(String(event.id)) || 0,
          registered,
          limit,
          remaining: limit === null ? null : Math.max(0, limit - registered),
        }
      })
      .sort((a, b) => b.rangeRegistrations - a.rangeRegistrations)
  }, [events, eventFilter, capacityCounts, filteredRows])

  const exportRows = filteredRows.map((row) => ({
    event: row.event?.title || 'Event unavailable',
    participantType: row.participant_type,
    institution: row.institution_name,
    department: row.department_name,
    status: row.registration_status,
    registeredAt: formatReportDate(row.registered_at, { dateStyle: 'medium', timeStyle: 'short' }),
  }))
  const exportColumns = [
    { key: 'event', label: 'Event' },
    { key: 'participantType', label: 'Participant type' },
    { key: 'institution', label: 'Institution' },
    { key: 'department', label: 'Department' },
    { key: 'status', label: 'Registration status' },
    { key: 'registeredAt', label: 'Registered at' },
  ]

  return (
    <section className="admin-page report-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">REGISTRATION ANALYTICS</span><h1>Registration reports</h1><p>Analyze actual registrations across events, institutions, departments, and participant types.</p></div>
        <ReportExportButtons rows={exportRows} columns={exportColumns} fileName="evently-registration-report" disabled={loading || Boolean(bounds.error) || Boolean(errors.registrations)} />
      </header>
      <div className="report-toolbar">
        <ReportDateFilter value={dateFilter} onChange={setDateFilter} />
        <label className="form-field"><span>Event</span><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="">All events</option>{(events || []).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <label className="form-field"><span>Institution</span><select value={institutionFilter} onChange={(event) => { setInstitutionFilter(event.target.value); setDepartmentFilter('') }}><option value="">All institutions</option>{institutionOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Department</span><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="">All departments</option>{departmentOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Participant type</span><select value={participantTypeFilter} onChange={(event) => setParticipantTypeFilter(event.target.value)}><option value="">All types</option>{participantTypes.map((type) => <option value={type} key={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
        <label className="form-field"><span>Registration status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="registered">Active</option><option value="cancelled">Cancelled</option></select></label>
      </div>
      {errors.registrations && <p className="form-feedback" role="alert">{errors.registrations}<button className="inline-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      {errors.events && <p className="inline-notice" role="status">{errors.events}</p>}
      {errors.institutions && <p className="inline-notice" role="status">{errors.institutions}</p>}
      {bounds.error && <p className="form-feedback" role="alert">{bounds.error}</p>}
      {loading ? <div className="event-skeleton admin-list-skeleton" role="status" aria-label="Loading registration analytics" /> : registrations && !bounds.error && !errors.registrations && (
        <>
          <div className="admin-stat-grid report-stat-grid">
            <article><span>Total registrations</span><strong>{formatReportNumber(filteredRows.length)}</strong></article>
            <article><span>Active</span><strong>{formatReportNumber(activeRows.length)}</strong></article>
            <article><span>Cancelled</span><strong>{formatReportNumber(cancelledRows.length)}</strong></article>
            <article><span>Distinct participants</span><strong>{formatReportNumber(new Set(filteredRows.map((row) => row.user_id)).size)}</strong></article>
          </div>
          <div className="report-grid report-grid-two">
            <ReportTrendChart title="Registration trends" description="Registrations grouped by day within the selected filters." items={trend} />
            <ReportBarList title="Participant type breakdown" items={byType} valueLabel="registrations" />
            <ReportBarList title="Event-wise count" items={byEvent.slice(0, 10)} valueLabel="registrations" />
            <ReportBarList title="Institution-wise count" items={byInstitution.slice(0, 10)} valueLabel="registrations" />
            <ReportBarList title="Department-wise count" items={byDepartment.slice(0, 10)} valueLabel="registrations" />
          </div>
          <section className="report-panel">
            <div className="report-panel-heading"><h2>Capacity and remaining seats</h2><p>Capacity uses current registered totals; the range count shows registrations matching the selected filters.</p></div>
            {errors.capacity && <p className="inline-notice" role="status">{errors.capacity}</p>}
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event</th><th>Range registrations</th><th>Current registered</th><th>Seat limit</th><th>Remaining seats</th></tr></thead><tbody>
              {seatRows.map(({ event, rangeRegistrations, registered, limit, remaining }) => <tr key={event.id}><td>{event.title}</td><td>{formatReportNumber(rangeRegistrations)}</td><td>{errors.capacity ? '—' : formatReportNumber(registered)}</td><td>{limit === null ? 'Unlimited' : formatReportNumber(limit)}</td><td>{errors.capacity || remaining === null ? '—' : formatReportNumber(remaining)}</td></tr>)}
              {!seatRows.length && <tr><td colSpan="5">No events match these filters.</td></tr>}
            </tbody></table></div>
          </section>
          <section className="report-panel">
            <div className="report-panel-heading"><h2>Filtered registration records</h2><p>Export includes only the rows matching the selected filters.</p></div>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event</th><th>Institution / department</th><th>Participant type</th><th>Registered</th><th>Status</th></tr></thead><tbody>
              {filteredRows.slice(0, 50).map((row) => <tr key={row.id}><td>{row.event?.title || 'Event unavailable'}</td><td>{row.institution_name}<small>{row.department_name}</small></td><td className="capitalize">{row.participant_type}</td><td>{formatReportDate(row.registered_at, { dateStyle: 'medium', timeStyle: 'short' })}</td><td className="capitalize">{row.registration_status}</td></tr>)}
              {!filteredRows.length && <tr><td colSpan="5">No registrations match these filters.</td></tr>}
            </tbody></table></div>
            {filteredRows.length > 50 && <p className="report-date-note">Showing the first 50 in the page; exports include all {filteredRows.length.toLocaleString()} matching records.</p>}
          </section>
        </>
      )}
    </section>
  )
}

export default Reports
