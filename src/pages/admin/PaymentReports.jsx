import { useEffect, useMemo, useState } from 'react'
import ReportDateFilter from '../../components/admin/ReportDateFilter.jsx'
import ReportExportButtons from '../../components/admin/ReportExportButtons.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatReportCurrency, formatReportDate, formatReportNumber, getReportDateBounds } from '../../lib/reportUtils.js'
import { getAdminReportEvents, getAllAdminPaymentReportRows, getReportUnavailableMessage } from '../../services/adminReportService.js'
import { getAdminPaymentReportPage } from '../../services/paymentService.js'

const pageSize = 25
const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]
const initialDateFilter = { preset: 'last30', from: '', to: '' }

function PaymentReports() {
  const [dateFilter, setDateFilter] = useState(initialDateFilter)
  const [events, setEvents] = useState([])
  const [eventsError, setEventsError] = useState('')
  const [eventId, setEventId] = useState('')
  const [status, setStatus] = useState('')
  const [participantSearch, setParticipantSearch] = useState('')
  const [transactionSearch, setTransactionSearch] = useState('')
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState({ key: '', payments: [], count: 0, error: '' })
  const bounds = useMemo(() => getReportDateBounds(dateFilter), [dateFilter])
  const queryFilters = useMemo(() => ({
    status,
    eventId,
    participantSearch,
    transactionSearch,
    ...bounds,
  }), [status, eventId, participantSearch, transactionSearch, bounds])
  const queryKey = JSON.stringify([queryFilters, page, retry])
  const loading = result.key !== queryKey

  useEffect(() => {
    let active = true
    getAdminReportEvents()
      .then((items) => {
        if (active) {
          setEvents(items)
          setEventsError('')
        }
      })
      .catch((error) => {
        if (active) setEventsError(getReportUnavailableMessage(error, 'Event filters'))
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (bounds.error) return undefined
    let active = true
    getAdminPaymentReportPage({ ...queryFilters, page, pageSize, dateField: 'submitted_at' })
      .then((data) => {
        if (active) setResult({ key: queryKey, ...data, error: '' })
      })
      .catch((error) => {
        if (active) setResult({
          key: queryKey,
          payments: [],
          count: 0,
          error: getReportUnavailableMessage(error, 'Payment reports'),
        })
      })
    return () => {
      active = false
    }
  }, [bounds.error, page, queryFilters, queryKey])

  const updateFilter = (setter) => (value) => {
    setter(value)
    setPage(0)
  }
  const exportRows = useMemo(() => result.payments.map((payment) => ({
    transactionId: payment.transaction_id,
    event: payment.registration?.event?.title || 'Event unavailable',
    participant: payment.registration?.full_name || 'Participant unavailable',
    email: payment.registration?.email || '—',
    phone: payment.registration?.phone || '—',
    participantType: payment.registration?.participant_type || '—',
    institution: payment.registration?.institution_name || '—',
    department: payment.registration?.department_name || '—',
    amount: formatReportCurrency(payment.payment_amount),
    submittedAt: formatReportDate(payment.submitted_at, { dateStyle: 'medium', timeStyle: 'short' }),
    reviewedAt: formatReportDate(payment.reviewed_at, { dateStyle: 'medium', timeStyle: 'short' }),
    status: payment.payment_status,
  })), [result.payments])
  const exportColumns = [
    { key: 'transactionId', label: 'Transaction ID' },
    { key: 'event', label: 'Event' },
    { key: 'participant', label: 'Participant' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'participantType', label: 'Participant type' },
    { key: 'institution', label: 'Institution' },
    { key: 'department', label: 'Department' },
    { key: 'amount', label: 'Amount' },
    { key: 'submittedAt', label: 'Submitted at' },
    { key: 'reviewedAt', label: 'Verified at' },
    { key: 'status', label: 'Payment status' },
  ]
  const loadExportRows = async () => {
    const payments = await getAllAdminPaymentReportRows({ ...queryFilters, dateField: 'submitted_at' })
    return payments.map((payment) => ({
      transactionId: payment.transaction_id,
      event: payment.registration?.event?.title || 'Event unavailable',
      participant: payment.registration?.full_name || 'Participant unavailable',
      email: payment.registration?.email || '—',
      phone: payment.registration?.phone || '—',
      participantType: payment.registration?.participant_type || '—',
      institution: payment.registration?.institution_name || '—',
      department: payment.registration?.department_name || '—',
      amount: formatReportCurrency(payment.payment_amount),
      submittedAt: formatReportDate(payment.submitted_at, { dateStyle: 'medium', timeStyle: 'short' }),
      reviewedAt: formatReportDate(payment.reviewed_at, { dateStyle: 'medium', timeStyle: 'short' }),
      status: payment.payment_status,
    }))
  }
  const pageCount = Math.ceil(result.count / pageSize)

  return (
    <section className="admin-page report-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">PAYMENT REPORTS</span><h1>Payment submissions</h1><p>Read-only reports from Phase 4 payment records. Use Payment Management for the existing approval workflow.</p></div>
        <ReportExportButtons rows={exportRows} loadRows={loadExportRows} columns={exportColumns} fileName="evently-payment-report" disabled={loading || Boolean(result.error) || result.count === 0} />
      </header>
      <div className="report-toolbar">
        <ReportDateFilter value={dateFilter} onChange={updateFilter(setDateFilter)} />
        <label className="form-field"><span>Event</span><select value={eventId} onChange={(event) => updateFilter(setEventId)(event.target.value)}><option value="">All events</option>{events.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <label className="form-field"><span>Payment status</span><select value={status} onChange={(event) => updateFilter(setStatus)(event.target.value)}>{statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label className="form-field"><span>Participant</span><input type="search" value={participantSearch} onChange={(event) => updateFilter(setParticipantSearch)(event.target.value)} placeholder="Name, email, or phone" /></label>
        <label className="form-field"><span>Transaction ID</span><input type="search" value={transactionSearch} onChange={(event) => updateFilter(setTransactionSearch)(event.target.value)} placeholder="Search transaction ID" /></label>
      </div>
      {eventsError && <p className="inline-notice" role="status">{eventsError}</p>}
      {bounds.error && <p className="form-feedback" role="alert">{bounds.error}</p>}
      <div className="admin-toolbar"><span className="admin-total">{loading ? 'Loading payment records…' : `${formatReportNumber(result.count)} submissions`}</span><span className="report-date-note">Date range uses submission time.</span></div>
      {!loading && result.error && <p className="form-feedback" role="alert">{result.error}<button className="inline-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      {loading && <div className="event-skeleton admin-list-skeleton" role="status" aria-label="Loading payment reports" />}
      {!loading && !result.error && result.payments.length === 0 && <div className="empty-state"><h2>No payment submissions found</h2><p>There are no records matching the selected filters. This is a real zero for the available Phase 4 table.</p></div>}
      {!loading && !result.error && result.payments.length > 0 && (
        <>
          <div className="report-stat-strip">
            {statusOptions.slice(1).map((option) => <article key={option.value}><span>{option.label}</span><strong>{formatReportNumber(result.payments.filter((payment) => payment.payment_status === option.value).length)}<small>on this page</small></strong></article>)}
          </div>
          <div className="admin-table-wrap"><table className="admin-table report-payment-table"><thead><tr><th>Transaction / event</th><th>Participant</th><th>Type / institution</th><th>Amount</th><th>Submitted</th><th>Verified</th><th>Status</th></tr></thead><tbody>
            {result.payments.map((payment) => <tr key={payment.id}>
              <td><strong>{payment.transaction_id}</strong><small>{payment.registration?.event?.title || 'Event unavailable'}</small></td>
              <td><strong>{payment.registration?.full_name || 'Participant unavailable'}</strong><small>{payment.registration?.email || '—'}</small><small>{payment.registration?.phone || '—'}</small></td>
              <td className="capitalize">{payment.registration?.participant_type || '—'}<small>{payment.registration?.institution_name || '—'} · {payment.registration?.department_name || '—'}</small></td>
              <td>{formatReportCurrency(payment.payment_amount)}</td>
              <td>{formatReportDate(payment.submitted_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td>{formatReportDate(payment.reviewed_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td><StatusBadge status={payment.payment_status} />{payment.rejection_reason && <small>{payment.rejection_reason}</small>}</td>
            </tr>)}
          </tbody></table></div>
          {pageCount > 1 && <div className="admin-pagination"><span>Page {page + 1} of {pageCount}</span><div><button className="button button-outline button-small" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
        </>
      )}
    </section>
  )
}

export default PaymentReports
