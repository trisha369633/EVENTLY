import { useEffect, useMemo, useState } from 'react'
import ReportDateFilter from '../../components/admin/ReportDateFilter.jsx'
import ReportExportButtons from '../../components/admin/ReportExportButtons.jsx'
import { formatReportDate, formatReportNumber, getReportDateBounds } from '../../lib/reportUtils.js'
import {
  getAdminReportEvents,
  getAllAdminDistributionHistory,
  getAllAdminParticipantBenefitStatus,
  getReportUnavailableMessage,
} from '../../services/adminReportService.js'
import { getAdminDistributionItems, getAdminDistributionSummary } from '../../services/distributionService.js'
import { getTicketVolunteerCandidates } from '../../services/ticketService.js'

const initialDateFilter = { preset: 'last30', from: '', to: '' }

function isInBounds(value, bounds) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    && (!bounds.start || timestamp >= Date.parse(bounds.start))
    && (!bounds.endExclusive || timestamp < Date.parse(bounds.endExclusive))
}

function normalizeBenefitRow(row) {
  const allowed = Number(row.allowed_quantity ?? row.allowed ?? row.max_per_participant ?? 0)
  const received = Number(row.received_quantity ?? row.distributed_quantity ?? row.quantity_received ?? 0)
  const remaining = Number(row.remaining_quantity ?? row.remaining ?? Math.max(allowed - received, 0))
  const normalizedStatus = String(row.status || '').toLowerCase()
  return {
    participantName: row.participant_name || row.full_name || row.registration_name || 'Unknown participant',
    email: row.email || row.participant_email || '',
    participantType: row.participant_type || row.registration_participant_type || '',
    eventTitle: row.event_title || row.event_name || '',
    itemName: row.item_name || row.distribution_item_name || '',
    allowedQuantity: Number.isFinite(allowed) ? allowed : 0,
    receivedQuantity: Number.isFinite(received) ? received : 0,
    remainingQuantity: Number.isFinite(remaining) ? Math.max(remaining, 0) : 0,
    status: ['pending', 'partial', 'completed'].includes(normalizedStatus)
      ? normalizedStatus
      : remainingQuantityStatus(allowed, received),
  }
}

function remainingQuantityStatus(allowed, received) {
  if (received <= 0) return 'pending'
  if (allowed > 0 && received >= allowed) return 'completed'
  return 'partial'
}

function Benefits() {
  const [dateFilter, setDateFilter] = useState(initialDateFilter)
  const [events, setEvents] = useState([])
  const [volunteers, setVolunteers] = useState([])
  const [eventId, setEventId] = useState('')
  const [itemId, setItemId] = useState('')
  const [volunteerId, setVolunteerId] = useState('')
  const [historyStatus, setHistoryStatus] = useState('')
  const [benefitStatus, setBenefitStatus] = useState('all')
  const [data, setData] = useState({ summary: null, items: null, history: null, benefits: null })
  const [errors, setErrors] = useState({})
  const [loadedKey, setLoadedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const bounds = useMemo(() => getReportDateBounds(dateFilter), [dateFilter])
  const requestKey = JSON.stringify([eventId, itemId, volunteerId, historyStatus, benefitStatus, retry])
  const loading = loadedKey !== requestKey

  useEffect(() => {
    let active = true
    Promise.allSettled([getAdminReportEvents(), getTicketVolunteerCandidates()])
      .then(([eventResult, volunteerResult]) => {
        if (!active) return
        if (eventResult.status === 'fulfilled') setEvents(eventResult.value)
        else setErrors((current) => ({ ...current, events: getReportUnavailableMessage(eventResult.reason, 'Event filters') }))
        if (volunteerResult.status === 'fulfilled') setVolunteers(volunteerResult.value)
        else setErrors((current) => ({ ...current, volunteers: getReportUnavailableMessage(volunteerResult.reason, 'Volunteer filters') }))
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (bounds.error) return undefined
    let active = true
    Promise.allSettled([
      getAdminDistributionSummary(eventId),
      getAdminDistributionItems(eventId),
      getAllAdminDistributionHistory({
        eventId,
        itemId,
        volunteerUserId: volunteerId,
        status: historyStatus === 'correction' ? 'corrected' : historyStatus === 'distribution' ? 'distributed' : '',
      }),
      getAllAdminParticipantBenefitStatus({
        eventId,
        itemId,
        status: benefitStatus,
      }),
    ]).then(([summaryResult, itemResult, historyResult, benefitResult]) => {
      if (!active) return
      const nextErrors = {}
      setData({
        summary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
        items: itemResult.status === 'fulfilled' ? itemResult.value : null,
        history: historyResult.status === 'fulfilled' ? historyResult.value : null,
        benefits: benefitResult.status === 'fulfilled' ? benefitResult.value : null,
      })
      if (summaryResult.status === 'rejected') nextErrors.summary = getReportUnavailableMessage(summaryResult.reason, 'Phase 6 benefit summary')
      if (itemResult.status === 'rejected') nextErrors.items = getReportUnavailableMessage(itemResult.reason, 'Phase 6 distribution inventory')
      if (historyResult.status === 'rejected') nextErrors.history = getReportUnavailableMessage(historyResult.reason, 'Phase 6 distribution history')
      if (benefitResult.status === 'rejected') nextErrors.benefits = getReportUnavailableMessage(benefitResult.reason, 'Participant benefit status')
      setErrors((current) => ({
        ...current,
        summary: nextErrors.summary,
        items: nextErrors.items,
        history: nextErrors.history,
        benefits: nextErrors.benefits,
      }))
    }).finally(() => {
      if (active) setLoadedKey(requestKey)
    })
    return () => {
      active = false
    }
  }, [bounds.error, eventId, itemId, volunteerId, historyStatus, benefitStatus, retry, requestKey])

  const items = data.items || []
  const visibleItems = items.filter((item) => (!itemId || String(item.item_id) === itemId))
  const history = (data.history || [])
    .filter((row) => isInBounds(row.activity_at, bounds))
    .filter((row) => !historyStatus || row.activity_type === historyStatus)
  const benefitRows = (data.benefits || []).map((row) => {
    const normalized = normalizeBenefitRow(row)
    if (!normalized.eventTitle) {
      const matchingEvent = events.find((event) => String(event.id) === String(row.event_id))
      normalized.eventTitle = matchingEvent?.title || ''
    }
    if (!normalized.itemName) {
      const matchingItem = items.find((item) => String(item.item_id) === String(row.distribution_item_id || row.item_id))
      normalized.itemName = matchingItem?.item_name || ''
    }
    return normalized
  })
  const pendingPairs = Number(data.summary?.pending_participant_distributions || 0)
  const exportRows = benefitRows.map((row) => ({
    participant: row.participantName,
    email: row.email,
    participantType: row.participantType,
    event: row.eventTitle,
    item: row.itemName,
    allowedQuantity: row.allowedQuantity,
    receivedQuantity: row.receivedQuantity,
    remainingQuantity: row.remainingQuantity,
    status: row.status,
  }))
  const exportColumns = [
    { key: 'participant', label: 'Participant' },
    { key: 'email', label: 'Email' },
    { key: 'participantType', label: 'Participant type' },
    { key: 'event', label: 'Event' },
    { key: 'item', label: 'Distribution item' },
    { key: 'allowedQuantity', label: 'Allowed quantity' },
    { key: 'receivedQuantity', label: 'Received quantity' },
    { key: 'remainingQuantity', label: 'Remaining quantity' },
    { key: 'status', label: 'Status' },
  ]

  return (
    <section className="admin-page report-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">BENEFIT DISTRIBUTION</span><h1>Pending benefit reports</h1><p>Participant eligibility, received quantities, remaining balances, and distribution audit history.</p></div>
        <ReportExportButtons rows={exportRows} columns={exportColumns} fileName="evently-participant-benefit-status" disabled={loading || Boolean(bounds.error) || Boolean(errors.benefits) || !exportRows.length} />
      </header>
      <div className="report-toolbar">
        <ReportDateFilter value={dateFilter} onChange={setDateFilter} />
        <label className="form-field"><span>Event</span><select value={eventId} onChange={(event) => { setEventId(event.target.value); setItemId('') }}><option value="">All events</option>{events.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <label className="form-field"><span>Distribution item</span><select value={itemId} onChange={(event) => setItemId(event.target.value)}><option value="">All items</option>{items.filter((item) => !eventId || String(item.event_id) === eventId).map((item) => <option value={item.item_id} key={item.item_id}>{item.item_name}</option>)}</select></label>
        <label className="form-field"><span>Volunteer</span><select value={volunteerId} onChange={(event) => setVolunteerId(event.target.value)}><option value="">All volunteers</option>{volunteers.map((item) => <option value={item.volunteer_user_id} key={item.volunteer_user_id}>{item.volunteer_name}</option>)}</select></label>
        <label className="form-field"><span>Benefit status</span><select value={benefitStatus} onChange={(event) => setBenefitStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="partial">Partial</option><option value="completed">Completed</option></select></label>
        <label className="form-field"><span>History status</span><select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}><option value="">All activity</option><option value="distribution">Distributed</option><option value="correction">Corrected</option></select></label>
      </div>
      {bounds.error && <p className="form-feedback" role="alert">{bounds.error}</p>}
      {errors.summary && <p className="form-feedback" role="alert">{errors.summary}</p>}
      {errors.items && <p className="form-feedback" role="alert">{errors.items}</p>}
      {errors.history && <p className="form-feedback" role="alert">{errors.history}</p>}
      {errors.benefits && <p className="form-feedback" role="alert">{errors.benefits}</p>}
      {loading ? <div className="event-skeleton admin-list-skeleton" role="status" aria-label="Loading benefit reports" /> : !bounds.error && data.summary && data.items && data.history && data.benefits && (
        <>
          <div className="admin-stat-grid report-stat-grid">
            <article><span>Pending eligible participant/item pairs</span><strong>{formatReportNumber(pendingPairs)}</strong><small>Current snapshot; not date-bounded</small></article>
            <article><span>Configured items</span><strong>{formatReportNumber(data.summary.total_items)}</strong></article>
            <article><span>Total inventory</span><strong>{formatReportNumber(data.summary.total_inventory)}</strong></article>
            <article><span>Net distributed</span><strong>{formatReportNumber(data.summary.total_distributed)}</strong></article>
            <article><span>Remaining inventory</span><strong>{formatReportNumber(data.summary.remaining_inventory)}</strong></article>
            <article><span>Recorded distribution entries</span><strong>{formatReportNumber(history.filter((row) => row.activity_type === 'distribution').length)}</strong><small>Within selected activity range</small></article>
          </div>
          <section className="report-panel">
            <div className="report-panel-heading">
              <h2>Participant benefit status</h2>
              <p>Eligible participant-item balances returned by the Super Admin benefit status RPC.</p>
            </div>
            {!benefitRows.length ? (
              <p className="report-empty-inline">No participant benefit records match these filters.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Participant name</th>
                      <th>Email / type</th>
                      <th>Event</th>
                      <th>Distribution item</th>
                      <th>Allowed quantity</th>
                      <th>Received quantity</th>
                      <th>Remaining quantity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benefitRows.map((row, index) => (
                      <tr key={`${row.participantName}-${row.eventTitle}-${row.itemName}-${index}`}>
                        <td><strong>{row.participantName}</strong></td>
                        <td>{row.email || '—'}<small className="capitalize">{row.participantType || 'Participant type unavailable'}</small></td>
                        <td>{row.eventTitle || '—'}</td>
                        <td>{row.itemName || '—'}</td>
                        <td>{formatReportNumber(row.allowedQuantity)}</td>
                        <td>{formatReportNumber(row.receivedQuantity)}</td>
                        <td>{formatReportNumber(row.remainingQuantity)}</td>
                        <td><span className={`status-badge status-${row.status}`}>{row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="report-panel">
            <div className="report-panel-heading"><h2>Item-wise distribution progress</h2><p>Current inventory and distribution totals come from Phase 6 RPCs.</p></div>
            {!visibleItems.length ? <p className="report-empty-inline">No distribution items are configured for these filters.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event / item</th><th>Allocated</th><th>Distributed</th><th>Remaining</th><th>Assigned volunteers</th><th>State</th></tr></thead><tbody>
              {visibleItems.map((item) => <tr key={item.item_id}><td><strong>{item.item_name}</strong><small>{item.event_title}</small></td><td>{formatReportNumber(item.total_quantity)}</td><td>{formatReportNumber(item.quantity_distributed)}</td><td>{formatReportNumber(item.remaining_inventory)}</td><td>{formatReportNumber(item.active_volunteer_count)}</td><td>{item.is_active ? 'Active' : 'Inactive'}</td></tr>)}
            </tbody></table></div>}
          </section>
          <section className="report-panel">
            <div className="report-panel-heading"><h2>Distribution history</h2><p>Date range applies to actual distribution and correction timestamps.</p></div>
            {!history.length ? <p className="report-empty-inline">No distribution activity matches these filters.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Activity</th><th>Event / item</th><th>Participant</th><th>Quantity</th><th>Current net</th><th>Volunteer / staff</th><th>When</th></tr></thead><tbody>
              {history.slice(0, 100).map((row) => <tr key={`${row.activity_type}-${row.activity_id}`}><td className="capitalize">{row.activity_type}</td><td><strong>{row.item_name}</strong><small>{row.event_title}</small></td><td><strong>{row.participant_name}</strong><small className="capitalize">{row.participant_type}</small></td><td>{row.quantity > 0 ? `+${row.quantity}` : row.quantity}</td><td>{row.net_quantity}</td><td>{row.actor_name}</td><td>{formatReportDate(row.activity_at, { dateStyle: 'medium', timeStyle: 'short' })}{row.reason && <small>{row.reason}</small>}</td></tr>)}
            </tbody></table></div>}
            {history.length > 100 && <p className="report-date-note">Showing the first 100 rows; exports include all matching history rows.</p>}
          </section>
        </>
      )}
      {!loading && errors.summary && /Phase 6|migration|RPC/i.test(errors.summary) && <p className="report-limitation-notice">Run the Phase 6 migration manually after Phase 4 and Phase 5 before using benefit reports.</p>}
      {!loading && Object.values(errors).some(Boolean) && <button className="button button-outline button-small" type="button" onClick={() => setRetry((value) => value + 1)}>Retry report data</button>}
    </section>
  )
}

export default Benefits
