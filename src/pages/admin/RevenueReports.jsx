import { useEffect, useMemo, useState } from 'react'
import ReportDateFilter from '../../components/admin/ReportDateFilter.jsx'
import { ReportBarList } from '../../components/admin/ReportCharts.jsx'
import ReportExportButtons from '../../components/admin/ReportExportButtons.jsx'
import { formatReportCurrency, formatReportDate, formatReportNumber, getReportDateBounds } from '../../lib/reportUtils.js'
import { getAdminReportEvents, getAllAdminPaymentReportRows, getReportUnavailableMessage } from '../../services/adminReportService.js'

const initialDateFilter = { preset: 'last30', from: '', to: '' }

function latestByRegistration(rows) {
  const latest = new Map()
  for (const row of rows) {
    const key = String(row.registration_id)
    const current = latest.get(key)
    if (!current || Date.parse(row.submitted_at) > Date.parse(current.submitted_at)) latest.set(key, row)
  }
  return [...latest.values()]
}

function RevenueReports() {
  const [dateFilter, setDateFilter] = useState(initialDateFilter)
  const [eventId, setEventId] = useState('')
  const [events, setEvents] = useState([])
  const [eventsError, setEventsError] = useState('')
  const [data, setData] = useState({ approvals: null, currentAttempts: null })
  const [reportError, setReportError] = useState('')
  const [loadedKey, setLoadedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const bounds = useMemo(() => getReportDateBounds(dateFilter), [dateFilter])
  const requestKey = JSON.stringify([bounds.start, bounds.endExclusive, eventId, retry])
  const loading = loadedKey !== requestKey
  const error = loadedKey === requestKey ? reportError : ''

  useEffect(() => {
    let active = true
    getAdminReportEvents()
      .then((items) => {
        if (active) setEvents(items)
      })
      .catch((loadError) => {
        if (active) setEventsError(getReportUnavailableMessage(loadError, 'Event filters'))
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (bounds.error) return undefined
    let active = true
    Promise.all([
      getAllAdminPaymentReportRows({
        status: 'approved',
        eventId,
        ...bounds,
        dateField: 'reviewed_at',
      }),
      getAllAdminPaymentReportRows({
        eventId,
        ...bounds,
        dateField: 'submitted_at',
      }),
    ]).then(([approvals, currentAttempts]) => {
      if (active) {
        setData({ approvals, currentAttempts })
        setReportError('')
      }
    }).catch((loadError) => {
      if (active) {
        setData({ approvals: null, currentAttempts: null })
        setReportError(getReportUnavailableMessage(loadError, 'Revenue reports'))
      }
    }).finally(() => {
      if (active) setLoadedKey(requestKey)
    })
    return () => {
      active = false
    }
  }, [bounds, eventId, retry, requestKey])

  const approvedPayments = useMemo(() => {
    const byRegistration = new Map()
    for (const payment of data.approvals || []) {
      const key = String(payment.registration_id)
      const current = byRegistration.get(key)
      if (!current || Date.parse(payment.reviewed_at) > Date.parse(current.reviewed_at)) {
        byRegistration.set(key, payment)
      }
    }
    return [...byRegistration.values()]
  }, [data.approvals])
  const latestAttempts = useMemo(() => latestByRegistration(data.currentAttempts || []), [data.currentAttempts])
  const pendingPayments = latestAttempts.filter((payment) => payment.payment_status === 'pending')
  const rejectedPayments = latestAttempts.filter((payment) => payment.payment_status === 'rejected')
  const totalRevenue = approvedPayments.reduce((sum, payment) => sum + Number(payment.payment_amount || 0), 0)
  const pendingAmount = pendingPayments.reduce((sum, payment) => sum + Number(payment.payment_amount || 0), 0)
  const rejectedAmount = rejectedPayments.reduce((sum, payment) => sum + Number(payment.payment_amount || 0), 0)

  const eventRevenue = useMemo(() => {
    const totals = new Map()
    for (const payment of approvedPayments) {
      const event = payment.registration?.event
      const key = String(event?.id || payment.registration?.event_id || 'unknown')
      const current = totals.get(key) || { key, label: event?.title || 'Event unavailable', value: 0 }
      current.value += Number(payment.payment_amount || 0)
      totals.set(key, current)
    }
    return [...totals.values()].sort((a, b) => b.value - a.value)
  }, [approvedPayments])
  const typeRevenue = useMemo(() => {
    const totals = new Map()
    for (const payment of approvedPayments) {
      const type = payment.registration?.participant_type || 'unknown'
      totals.set(type, (totals.get(type) || 0) + Number(payment.payment_amount || 0))
    }
    return ['student', 'teacher', 'alumni'].map((type) => ({
      key: type,
      label: `${type[0].toUpperCase()}${type.slice(1)}`,
      value: totals.get(type) || 0,
    }))
  }, [approvedPayments])
  const monthlyRevenue = useMemo(() => {
    const totals = new Map()
    for (const payment of approvedPayments) {
      const date = new Date(payment.reviewed_at)
      if (Number.isNaN(date.getTime())) continue
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      totals.set(key, (totals.get(key) || 0) + Number(payment.payment_amount || 0))
    }
    return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({
      key,
      label: key,
      value,
    }))
  }, [approvedPayments])

  const exportRows = [
    ...approvedPayments.map((payment) => ({
      event: payment.registration?.event?.title || 'Event unavailable',
      participant: payment.registration?.full_name || 'Participant unavailable',
      type: payment.registration?.participant_type || '—',
      transaction: payment.transaction_id,
      status: 'approved',
      amount: formatReportCurrency(payment.payment_amount),
      collectedRevenue: formatReportCurrency(payment.payment_amount),
      date: formatReportDate(payment.reviewed_at, { dateStyle: 'medium', timeStyle: 'short' }),
    })),
    ...pendingPayments.map((payment) => ({
      event: payment.registration?.event?.title || 'Event unavailable',
      participant: payment.registration?.full_name || 'Participant unavailable',
      type: payment.registration?.participant_type || '—',
      transaction: payment.transaction_id,
      status: 'pending',
      amount: formatReportCurrency(payment.payment_amount),
      collectedRevenue: formatReportCurrency(0),
      date: formatReportDate(payment.submitted_at, { dateStyle: 'medium', timeStyle: 'short' }),
    })),
    ...rejectedPayments.map((payment) => ({
      event: payment.registration?.event?.title || 'Event unavailable',
      participant: payment.registration?.full_name || 'Participant unavailable',
      type: payment.registration?.participant_type || '—',
      transaction: payment.transaction_id,
      status: 'rejected',
      amount: formatReportCurrency(payment.payment_amount),
      collectedRevenue: formatReportCurrency(0),
      date: formatReportDate(payment.submitted_at, { dateStyle: 'medium', timeStyle: 'short' }),
    })),
  ]
  const exportColumns = [
    { key: 'event', label: 'Event' },
    { key: 'participant', label: 'Participant' },
    { key: 'type', label: 'Participant type' },
    { key: 'transaction', label: 'Transaction ID' },
    { key: 'status', label: 'Payment status' },
    { key: 'amount', label: 'Submission amount' },
    { key: 'collectedRevenue', label: 'Collected revenue' },
    { key: 'date', label: 'Approved/submitted date' },
  ]

  return (
    <section className="admin-page report-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">REVENUE REPORTS</span><h1>Revenue overview</h1><p>Collected revenue is based only on approved Phase 4 payment records.</p></div>
        <ReportExportButtons rows={exportRows} columns={exportColumns} fileName="evently-revenue-report" disabled={loading || Boolean(bounds.error) || Boolean(error) || !exportRows.length} />
      </header>
      <div className="report-toolbar">
        <ReportDateFilter value={dateFilter} onChange={setDateFilter} />
        <label className="form-field"><span>Event</span><select value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">All events</option>{events.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      </div>
      <p className="report-date-note">Revenue is grouped by verification date. Pending and rejected amounts use the latest submission per registration in the selected submission-date range, so rejected retries are not added repeatedly.</p>
      {eventsError && <p className="inline-notice" role="status">{eventsError}</p>}
      {bounds.error && <p className="form-feedback" role="alert">{bounds.error}</p>}
      {error && <p className="form-feedback" role="alert">{error}<button className="inline-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      {loading ? <div className="event-skeleton admin-list-skeleton" role="status" aria-label="Loading revenue reports" /> : !bounds.error && data.approvals && data.currentAttempts && (
        <>
          <div className="admin-stat-grid report-stat-grid">
            <article><span>Total approved revenue</span><strong>{formatReportCurrency(totalRevenue)}</strong></article>
            <article><span>Approved payment records</span><strong>{formatReportNumber(approvedPayments.length)}</strong></article>
            <article><span>Pending amount</span><strong>{formatReportCurrency(pendingAmount)}</strong></article>
            <article><span>Rejected amount</span><strong>{formatReportCurrency(rejectedAmount)}</strong></article>
          </div>
          <div className="report-grid report-grid-two">
            <ReportBarList title="Event-wise approved revenue" items={eventRevenue} valueLabel="" formatValue={formatReportCurrency} />
            <ReportBarList title="Participant-type revenue" items={typeRevenue} valueLabel="" formatValue={formatReportCurrency} />
            <ReportBarList title="Monthly approved revenue" items={monthlyRevenue} valueLabel="" formatValue={formatReportCurrency} />
          </div>
          <section className="report-panel">
            <div className="report-panel-heading"><h2>Revenue reconciliation</h2><p>Each row is one payment record. Only approved rows contribute to collected revenue.</p></div>
            {!exportRows.length ? <p className="report-empty-inline">No payment records match this range.</p> : (
              <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event / participant</th><th>Type</th><th>Transaction</th><th>Status</th><th>Amount</th><th>Collected revenue</th><th>Date</th></tr></thead><tbody>
                {exportRows.slice(0, 100).map((row, index) => <tr key={`${row.transaction}-${index}`}><td><strong>{row.event}</strong><small>{row.participant}</small></td><td className="capitalize">{row.type}</td><td>{row.transaction}</td><td className="capitalize">{row.status}</td><td>{row.amount}</td><td>{row.collectedRevenue}</td><td>{row.date}</td></tr>)}
              </tbody></table></div>
            )}
            {exportRows.length > 100 && <p className="report-date-note">Showing the first 100 rows; Excel and CSV include all matching unique records.</p>}
          </section>
        </>
      )}
    </section>
  )
}

export default RevenueReports
