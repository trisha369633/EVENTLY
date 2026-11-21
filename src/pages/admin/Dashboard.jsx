import { useEffect, useMemo, useState } from 'react'
import ReportDateFilter from '../../components/admin/ReportDateFilter.jsx'
import { ReportBarList, ReportTrendChart } from '../../components/admin/ReportCharts.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatReportCurrency, formatReportDate, formatReportNumber, getReportDateBounds } from '../../lib/reportUtils.js'
import { getAdminDistributionSummary } from '../../services/distributionService.js'
import { getAdminReportEvents, getAllAdminPaymentReportRows, getReportUnavailableMessage } from '../../services/adminReportService.js'
import { getAdminReportRegistrations } from '../../services/registrationService.js'
import { getTicketVolunteerCandidates } from '../../services/ticketService.js'

const initialDateFilter = { preset: 'last30', from: '', to: '' }
const emptyRows = []
const initialData = {
  events: null,
  registrations: null,
  payments: null,
  approvedPayments: null,
  distribution: null,
  volunteers: null,
}

function isInBounds(value, bounds) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    && (!bounds.start || timestamp >= Date.parse(bounds.start))
    && (!bounds.endExclusive || timestamp < Date.parse(bounds.endExclusive))
}

function latestByRegistration(payments, status) {
  const latest = new Map()
  for (const payment of payments) {
    if (payment.payment_status !== status) continue
    const key = String(payment.registration_id)
    const previous = latest.get(key)
    if (!previous || Date.parse(payment.submitted_at) > Date.parse(previous.submitted_at)) {
      latest.set(key, payment)
    }
  }
  return [...latest.values()]
}

function trendRows(registrations, dateFilter) {
  const monthMode = dateFilter.preset === 'all'
    || (dateFilter.preset === 'custom' && dateFilter.from && dateFilter.to
      && (Date.parse(dateFilter.to) - Date.parse(dateFilter.from)) > 90 * 86400000)
  const counts = new Map()
  for (const registration of registrations) {
    const date = new Date(registration.registered_at)
    if (Number.isNaN(date.getTime())) continue
    const key = monthMode
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({
    label: monthMode ? key.slice(2) : key.slice(5),
    value,
  }))
}

function revenueTrend(payments) {
  const counts = new Map()
  for (const payment of payments) {
    const date = new Date(payment.reviewed_at)
    if (Number.isNaN(date.getTime())) continue
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    counts.set(key, (counts.get(key) || 0) + Number(payment.payment_amount || 0))
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({
    label: key.slice(2),
    value: Math.round(value),
  }))
}

function Dashboard() {
  const [dateFilter, setDateFilter] = useState(initialDateFilter)
  const [data, setData] = useState(initialData)
  const [errors, setErrors] = useState({})
  const [loadedKey, setLoadedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const bounds = useMemo(() => getReportDateBounds(dateFilter), [dateFilter])
  const requestKey = JSON.stringify([bounds.start, bounds.endExclusive, retry])
  const loading = loadedKey !== requestKey

  useEffect(() => {
    if (bounds.error) return undefined
    let active = true
    const jobs = [
      ['events', getAdminReportEvents()],
      ['registrations', getAdminReportRegistrations(bounds)],
      ['payments', getAllAdminPaymentReportRows({ ...bounds, dateField: 'submitted_at' })],
      ['approvedPayments', getAllAdminPaymentReportRows({ status: 'approved', ...bounds, dateField: 'reviewed_at' })],
      ['distribution', getAdminDistributionSummary()],
      ['volunteers', getTicketVolunteerCandidates()],
    ]

    Promise.all(jobs.map(async ([key, promise]) => {
      try {
        return [key, { value: await promise, error: '' }]
      } catch (error) {
        return [key, { value: null, error: error.message || `${key} could not be loaded.` }]
      }
    })).then((results) => {
      if (!active) return
      setData(Object.fromEntries(results.map(([key, result]) => [key, result.value])))
      setErrors(Object.fromEntries(results.filter(([, result]) => result.error).map(([key, result]) => [
        key,
        getReportUnavailableMessage(new Error(result.error), key === 'distribution' ? 'Benefit statistics' : key === 'volunteers' ? 'Volunteer count' : key),
      ])))
    }).finally(() => {
      if (active) setLoadedKey(requestKey)
    })
    return () => {
      active = false
    }
  }, [bounds, retry, requestKey])

  const registrations = data.registrations || emptyRows
  const activeRegistrations = useMemo(() => registrations.filter(
    (row) => row.registration_status === 'registered',
  ), [registrations])
  const payments = data.payments || []
  const events = useMemo(() => (data.events || []).filter(
    (event) => isInBounds(event.created_at, bounds),
  ), [data.events, bounds])
  const publishedEvents = events.filter((event) => event.status === 'published').length
  const distinctParticipants = new Set(activeRegistrations.map((row) => row.user_id)).size
  const approvedRevenuePayments = useMemo(() => {
    const byRegistration = new Map()
    for (const payment of data.approvedPayments || []) {
      const key = String(payment.registration_id)
      const current = byRegistration.get(key)
      if (!current || Date.parse(payment.reviewed_at) > Date.parse(current.reviewed_at)) {
        byRegistration.set(key, payment)
      }
    }
    return [...byRegistration.values()]
  }, [data.approvedPayments])
  const revenue = approvedRevenuePayments.reduce((sum, payment) => sum + Number(payment.payment_amount || 0), 0)
  const pendingPayments = latestByRegistration(payments, 'pending')
  const rejectedPayments = latestByRegistration(payments, 'rejected')
  const paymentBreakdown = ['pending', 'approved', 'rejected'].map((status) => ({
    key: status,
    label: status[0].toUpperCase() + status.slice(1),
    value: payments.filter((payment) => payment.payment_status === status).length,
  }))
  const eventRegistrations = useMemo(() => {
    const counts = new Map()
    for (const registration of registrations) {
      const event = registration.event
      if (!event) continue
      const key = String(event.id)
      const item = counts.get(key) || { key, label: event.title, value: 0 }
      item.value += 1
      counts.set(key, item)
    }
    return [...counts.values()].sort((a, b) => b.value - a.value).slice(0, 8)
  }, [registrations])
  const registrationTrend = useMemo(() => trendRows(activeRegistrations, dateFilter), [activeRegistrations, dateFilter])
  const revenueTrendRows = useMemo(() => revenueTrend(approvedRevenuePayments), [approvedRevenuePayments])
  const recentRegistrations = [...registrations].sort(
    (a, b) => Date.parse(b.registered_at) - Date.parse(a.registered_at),
  ).slice(0, 5)
  const recentPayments = [...payments].sort(
    (a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at),
  ).slice(0, 5)

  const stats = [
    { label: 'Participants with registrations', value: errors.registrations ? '—' : formatReportNumber(distinctParticipants) },
    { label: 'Total registrations', value: errors.registrations ? '—' : formatReportNumber(registrations.length) },
    { label: 'Total events', value: errors.events ? '—' : formatReportNumber(events.length) },
    { label: 'Published events', value: errors.events ? '—' : formatReportNumber(publishedEvents) },
    { label: 'Pending payments', value: errors.payments ? '—' : formatReportNumber(payments.filter((payment) => payment.payment_status === 'pending').length) },
    { label: 'Approved payments', value: errors.payments ? '—' : formatReportNumber(payments.filter((payment) => payment.payment_status === 'approved').length) },
    { label: 'Rejected payments', value: errors.payments ? '—' : formatReportNumber(payments.filter((payment) => payment.payment_status === 'rejected').length) },
    { label: 'Collected revenue', value: errors.approvedPayments ? '—' : formatReportCurrency(revenue) },
    { label: 'Pending benefit pairs', value: errors.distribution ? '—' : formatReportNumber(data.distribution?.pending_participant_distributions) },
    { label: 'Volunteers', value: errors.volunteers ? '—' : formatReportNumber(data.volunteers?.length || 0) },
  ]

  return (
    <section className="admin-page report-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">ADMIN OVERVIEW</span><h1>Reporting center</h1><p>Event, registration, payment, and operations activity from your Supabase project.</p></div>
        <a className="button button-primary" href="/admin/events/create">Create event</a>
      </header>
      <div className="report-toolbar">
        <ReportDateFilter value={dateFilter} onChange={setDateFilter} />
        <span className="report-date-note">Date-bounded activity uses registration, event creation, payment submission, or payment approval time as appropriate.</span>
      </div>
      {bounds.error && <p className="form-feedback" role="alert">{bounds.error}</p>}
      {loading && <div className="event-skeleton admin-list-skeleton" role="status" aria-label="Loading reports" />}
      {!loading && !bounds.error && (
        <>
          <div className="admin-stat-grid report-stat-grid">
            {stats.map((stat) => <article key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></article>)}
          </div>
          {(errors.events || errors.registrations || errors.payments || errors.approvedPayments) && (
            <div className="report-source-notices" role="status">
              {Object.entries(errors).filter(([key]) => ['events', 'registrations', 'payments', 'approvedPayments'].includes(key)).map(([key, message]) => <p key={key}>{message}</p>)}
            </div>
          )}
          {(errors.distribution || errors.volunteers) && <p className="report-date-note">Current-state metrics are not date-bounded. {errors.distribution || ''} {errors.volunteers || ''}</p>}
          <div className="report-grid report-grid-two">
            {errors.registrations
              ? <section className="report-panel"><h2>Registration trends unavailable</h2><p>{errors.registrations}</p></section>
              : <ReportTrendChart title="Registration trends" description="Active registrations grouped by day or month." items={registrationTrend} />}
            {errors.registrations
              ? <section className="report-panel"><h2>Event comparison unavailable</h2><p>{errors.registrations}</p></section>
              : <ReportBarList title="Event-wise registrations" description="Top events in the selected range." items={eventRegistrations} />}
            {errors.payments
              ? <section className="report-panel"><h2>Payment breakdown unavailable</h2><p>{errors.payments}</p></section>
              : <ReportBarList title="Payment status breakdown" description="Submission attempts by submission date." items={paymentBreakdown} valueLabel="submissions" />}
            {errors.approvedPayments
              ? <section className="report-panel"><h2>Revenue overview unavailable</h2><p>{errors.approvedPayments}</p></section>
              : <ReportBarList title="Monthly approved revenue" description="Unique approved payment records by verification month." items={revenueTrendRows} valueLabel="BDT" />}
          </div>
          <div className="report-grid report-grid-two">
            <section className="report-panel">
              <div className="report-panel-heading"><h2>Recent registrations</h2><a className="text-link" href="/admin/reports/registrations">Registration analytics</a></div>
              {errors.registrations ? <p>{errors.registrations}</p> : recentRegistrations.length === 0 ? <p className="report-empty-inline">No registrations in this range.</p> : (
                <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event</th><th>Participant type</th><th>Registered</th><th>Status</th></tr></thead><tbody>
                  {recentRegistrations.map((row) => <tr key={row.id}><td>{row.event?.title || 'Event unavailable'}</td><td className="capitalize">{row.participant_type}</td><td>{formatReportDate(row.registered_at, { dateStyle: 'medium', timeStyle: 'short' })}</td><td><StatusBadge status={row.registration_status} /></td></tr>)}
                </tbody></table></div>
              )}
            </section>
            <section className="report-panel">
              <div className="report-panel-heading"><h2>Recent payment activity</h2><a className="text-link" href="/admin/reports/payments">Payment reports</a></div>
              {errors.payments ? <p>{errors.payments}</p> : recentPayments.length === 0 ? <p className="report-empty-inline">No payment submissions in this range.</p> : (
                <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event / participant</th><th>Amount</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
                  {recentPayments.map((payment) => <tr key={payment.id}><td><strong>{payment.registration?.event?.title || 'Event unavailable'}</strong><small>{payment.registration?.full_name || 'Participant unavailable'}</small></td><td>{formatReportCurrency(payment.payment_amount)}</td><td>{formatReportDate(payment.submitted_at, { dateStyle: 'medium', timeStyle: 'short' })}</td><td><StatusBadge status={payment.payment_status} /></td></tr>)}
                </tbody></table></div>
              )}
            </section>
          </div>
          <div className="report-metric-footnotes">
            <p>Participant count is distinct accounts with active registrations in this range; it does not count accounts without event registration history.</p>
            <p>Pending benefit pairs and volunteer count are current-state values from Phase 6 and Phase 5, respectively, and are not date-filtered.</p>
          </div>
        </>
      )}
      {!loading && !bounds.error && Object.values(errors).some(Boolean) && <button className="button button-outline button-small" type="button" onClick={() => setRetry((value) => value + 1)}>Retry report data</button>}
      <span className="sr-only" aria-live="polite">{formatReportNumber(rejectedPayments.length)} rejected and {formatReportNumber(pendingPayments.length)} pending latest payment records in range.</span>
    </section>
  )
}

export default Dashboard
