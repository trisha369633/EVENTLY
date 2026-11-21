import { useEffect, useMemo, useState } from 'react'
import ReportDateFilter from '../../components/admin/ReportDateFilter.jsx'
import { ReportBarList } from '../../components/admin/ReportCharts.jsx'
import ReportExportButtons from '../../components/admin/ReportExportButtons.jsx'
import { formatReportDate, formatReportNumber, getReportDateBounds } from '../../lib/reportUtils.js'
import { getAdminVolunteerActivityData, getAllAdminDistributionHistory, getReportUnavailableMessage } from '../../services/adminReportService.js'

const initialDateFilter = { preset: 'last30', from: '', to: '' }
const emptyList = []

function isInBounds(value, bounds) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    && (!bounds.start || timestamp >= Date.parse(bounds.start))
    && (!bounds.endExclusive || timestamp < Date.parse(bounds.endExclusive))
}

function Volunteers() {
  const [dateFilter, setDateFilter] = useState(initialDateFilter)
  const [eventFilter, setEventFilter] = useState('')
  const [volunteerFilter, setVolunteerFilter] = useState('')
  const [itemFilter, setItemFilter] = useState('')
  const [assignments, setAssignments] = useState(null)
  const [history, setHistory] = useState(null)
  const [errors, setErrors] = useState({})
  const [loadedKey, setLoadedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const bounds = useMemo(() => getReportDateBounds(dateFilter), [dateFilter])
  const requestKey = String(retry)
  const loading = loadedKey !== requestKey

  useEffect(() => {
    if (bounds.error) return undefined
    let active = true
    Promise.allSettled([
      getAdminVolunteerActivityData(),
      getAllAdminDistributionHistory(),
    ]).then(([assignmentResult, historyResult]) => {
      if (!active) return
      const nextErrors = {}
      setAssignments(assignmentResult.status === 'fulfilled' ? assignmentResult.value : null)
      setHistory(historyResult.status === 'fulfilled' ? historyResult.value : null)
      if (assignmentResult.status === 'rejected') nextErrors.assignments = getReportUnavailableMessage(assignmentResult.reason, 'Volunteer assignments')
      if (historyResult.status === 'rejected') nextErrors.history = getReportUnavailableMessage(historyResult.reason, 'Volunteer distribution activity')
      if (assignmentResult.status === 'fulfilled') {
        nextErrors.distribution = assignmentResult.value.distributionError
        nextErrors.itemAssignments = assignmentResult.value.itemAssignmentError
      }
      setErrors(nextErrors)
    }).finally(() => {
      if (active) setLoadedKey(requestKey)
    })
    return () => {
      active = false
    }
  }, [bounds.error, retry, requestKey])

  const volunteers = assignments?.volunteers || emptyList
  const eventAssignments = assignments?.eventAssignments || emptyList
  const distributionItems = assignments?.distributionItems || emptyList
  const itemAssignments = assignments?.itemAssignments || emptyList
  const volunteerIds = useMemo(() => new Set(volunteers.map((person) => String(person.volunteer_user_id))), [volunteers])
  const activeEventByVolunteer = useMemo(() => {
    const map = new Map()
    for (const event of eventAssignments) {
      for (const assignment of event.assignments) {
        if (!assignment.is_active) continue
        const key = String(assignment.volunteer_user_id)
        const list = map.get(key) || []
        list.push({ eventId: event.eventId, eventTitle: event.eventTitle })
        map.set(key, list)
      }
    }
    return map
  }, [eventAssignments])
  const activeItemsByVolunteer = useMemo(() => {
    const map = new Map()
    for (const item of itemAssignments) {
      for (const assignment of item.assignments) {
        if (!assignment.is_active) continue
        const key = String(assignment.volunteer_user_id)
        const list = map.get(key) || []
        list.push({ itemId: item.itemId, itemName: item.itemName, eventId: item.eventId })
        map.set(key, list)
      }
    }
    return map
  }, [itemAssignments])
  const filteredHistory = useMemo(() => (history || [])
    .filter((row) => row.activity_type === 'distribution' && volunteerIds.has(String(row.actor_user_id)))
    .filter((row) => isInBounds(row.activity_at, bounds))
    .filter((row) => !eventFilter || String(row.event_id) === eventFilter)
    .filter((row) => !volunteerFilter || String(row.actor_user_id) === volunteerFilter)
    .filter((row) => !itemFilter || String(row.item_id) === itemFilter), [
    history,
    volunteerIds,
    bounds,
    eventFilter,
    volunteerFilter,
    itemFilter,
  ])
  const activityByVolunteer = useMemo(() => {
    const totals = new Map()
    for (const row of filteredHistory) {
      const key = String(row.actor_user_id)
      const current = totals.get(key) || { records: 0, netQuantity: 0 }
      current.records += 1
      current.netQuantity += Math.max(0, Number(row.net_quantity) || 0)
      totals.set(key, current)
    }
    return totals
  }, [filteredHistory])
  const volunteerSummaries = volunteers
    .filter((person) => !volunteerFilter || String(person.volunteer_user_id) === volunteerFilter)
    .map((person) => {
      const key = String(person.volunteer_user_id)
      const eventRows = (activeEventByVolunteer.get(key) || []).filter((item) => !eventFilter || item.eventId === eventFilter)
      const itemRows = (activeItemsByVolunteer.get(key) || []).filter((item) => (
        (!eventFilter || item.eventId === eventFilter) && (!itemFilter || item.itemId === itemFilter)
      ))
      const activity = activityByVolunteer.get(key) || { records: 0, netQuantity: 0 }
      return {
        ...person,
        eventRows,
        itemRows,
        distributionCount: activity.records,
        netQuantity: activity.netQuantity,
      }
    })
  const eventActivity = useMemo(() => {
    const totals = new Map()
    for (const row of filteredHistory) {
      const key = String(row.event_id)
      const current = totals.get(key) || { key, label: row.event_title, value: 0 }
      current.value += 1
      totals.set(key, current)
    }
    return [...totals.values()].sort((a, b) => b.value - a.value)
  }, [filteredHistory])
  const itemOptions = useMemo(() => {
    return distributionItems.filter((item) => (
      (!eventFilter || String(item.event_id) === eventFilter)
      && itemAssignments.some((assignment) => assignment.itemId === String(item.item_id)
        && assignment.assignments.some((person) => person.is_active
          && (!volunteerFilter || String(person.volunteer_user_id) === volunteerFilter)))
    ))
  }, [distributionItems, itemAssignments, eventFilter, volunteerFilter])

  const exportRows = filteredHistory.map((row) => ({
    volunteer: row.actor_name,
    event: row.event_title,
    item: row.item_name,
    participant: row.participant_name,
    quantity: row.net_quantity,
    timestamp: formatReportDate(row.activity_at, { dateStyle: 'medium', timeStyle: 'short' }),
  }))
  const exportColumns = [
    { key: 'volunteer', label: 'Volunteer' },
    { key: 'event', label: 'Event' },
    { key: 'item', label: 'Distribution item' },
    { key: 'participant', label: 'Participant' },
    { key: 'quantity', label: 'Net distributed quantity' },
    { key: 'timestamp', label: 'Distribution timestamp' },
  ]

  return (
    <section className="admin-page report-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">VOLUNTEER ACTIVITY</span><h1>Volunteer reports</h1><p>Review event/item assignments and completed Phase 6 distributions. Financial data is not included.</p></div>
        <ReportExportButtons rows={exportRows} columns={exportColumns} fileName="evently-volunteer-activity" disabled={loading || Boolean(bounds.error) || Boolean(errors.history) || !exportRows.length} />
      </header>
      <div className="report-toolbar">
        <ReportDateFilter value={dateFilter} onChange={setDateFilter} />
        <label className="form-field"><span>Volunteer</span><select value={volunteerFilter} onChange={(event) => setVolunteerFilter(event.target.value)}><option value="">All volunteers</option>{volunteers.map((person) => <option value={person.volunteer_user_id} key={person.volunteer_user_id}>{person.volunteer_name}</option>)}</select></label>
        <label className="form-field"><span>Event</span><select value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setItemFilter('') }}><option value="">All events</option>{(assignments?.events || []).map((event) => <option value={event.id} key={event.id}>{event.title}</option>)}</select></label>
        <label className="form-field"><span>Distribution item</span><select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}><option value="">All assigned items</option>{itemOptions.map((item) => <option value={item.item_id} key={item.item_id}>{item.item_name}</option>)}</select></label>
      </div>
      {bounds.error && <p className="form-feedback" role="alert">{bounds.error}</p>}
      {errors.assignments && <p className="form-feedback" role="alert">{errors.assignments}</p>}
      {errors.history && <p className="form-feedback" role="alert">{errors.history}</p>}
      {errors.distribution && <p className="report-limitation-notice">{errors.distribution} Phase 5 event assignments remain available below.</p>}
      {errors.itemAssignments && <p className="inline-notice" role="status">{errors.itemAssignments}</p>}
      {loading ? <div className="event-skeleton admin-list-skeleton" role="status" aria-label="Loading volunteer reports" /> : !bounds.error && assignments && (
        <>
          <div className="admin-stat-grid report-stat-grid">
            <article><span>Volunteers</span><strong>{formatReportNumber(volunteerSummaries.length)}</strong></article>
            <article><span>Active event assignments</span><strong>{formatReportNumber(volunteerSummaries.reduce((sum, person) => sum + person.eventRows.length, 0))}</strong></article>
            <article><span>Item-level assignments</span><strong>{errors.distribution || errors.itemAssignments ? '—' : formatReportNumber(volunteerSummaries.reduce((sum, person) => sum + person.itemRows.length, 0))}</strong></article>
            <article><span>Distribution records in range</span><strong>{errors.history ? '—' : formatReportNumber(filteredHistory.length)}</strong></article>
            <article><span>Net units distributed</span><strong>{errors.history ? '—' : formatReportNumber(filteredHistory.reduce((sum, row) => sum + Number(row.net_quantity || 0), 0))}</strong></article>
          </div>
          {errors.history && <p className="report-limitation-notice">Distribution activity metrics are unavailable until the Phase 6 reporting RPC is installed; assignment counts are still read from the existing Phase 5/6 functions.</p>}
          <div className="report-grid report-grid-two">
            {errors.history
              ? <section className="report-panel"><h2>Event-wise activity unavailable</h2><p>{errors.history}</p></section>
              : <ReportBarList title="Event-wise activity" description="Successful distribution records by event in the selected range." items={eventActivity} valueLabel="records" />}
            <section className="report-panel">
              <div className="report-panel-heading"><h2>Volunteer assignment summary</h2><p>Assignments are current state; activity rows use the selected date range.</p></div>
              {volunteerSummaries.length === 0 ? <p className="report-empty-inline">No volunteers match these filters.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Volunteer</th><th>Assigned events</th><th>Assigned items</th><th>Successful records</th><th>Net units</th></tr></thead><tbody>
                {volunteerSummaries.map((person) => <tr key={person.volunteer_user_id}><td><strong>{person.volunteer_name}</strong><small>{person.volunteer_email}</small></td><td>{person.eventRows.length}<small>{person.eventRows.map((item) => item.eventTitle).join(', ') || 'No active event assignment'}</small></td><td>{errors.distribution || errors.itemAssignments ? '—' : person.itemRows.length}<small>{person.itemRows.map((item) => item.itemName).join(', ') || (errors.distribution || errors.itemAssignments ? 'Unavailable' : 'No active item assignment')}</small></td><td>{errors.history ? '—' : formatReportNumber(person.distributionCount)}</td><td>{errors.history ? '—' : formatReportNumber(person.netQuantity)}</td></tr>)}
              </tbody></table></div>}
            </section>
          </div>
          <section className="report-panel">
            <div className="report-panel-heading"><h2>Recent volunteer activity</h2><p>Distribution rows only; ticket scans and check-ins are not counted as benefits.</p></div>
            {errors.history ? <p className="report-empty-inline">Phase 6 distribution activity is unavailable.</p> : !filteredHistory.length ? <p className="report-empty-inline">No successful distributions match these filters.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Volunteer</th><th>Event / item</th><th>Participant</th><th>Net quantity</th><th>Time</th></tr></thead><tbody>
              {filteredHistory.slice(0, 100).map((row) => <tr key={row.activity_id}><td>{row.actor_name}</td><td><strong>{row.item_name}</strong><small>{row.event_title}</small></td><td>{row.participant_name}</td><td>{row.net_quantity}</td><td>{formatReportDate(row.activity_at, { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>)}
            </tbody></table></div>}
            {filteredHistory.length > 100 && <p className="report-date-note">Showing the latest 100 matching rows; exports include all matching activity.</p>}
          </section>
        </>
      )}
      {!loading && Object.values(errors).some(Boolean) && <button className="button button-outline button-small" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>}
    </section>
  )
}

export default Volunteers
