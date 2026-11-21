import { useEffect, useState } from 'react'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatEventDateTime, formatFee } from '../../lib/eventUtils.js'
import {
  createPaymentProofUrl,
  getAdminPaymentSubmissions,
  getAdminPaymentSummary,
  reviewEventPayment,
} from '../../services/paymentService.js'

const pageSize = 20
const statusFilters = ['all', 'pending', 'approved', 'rejected']

function formatApprovedAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? `৳${amount.toLocaleString('en-BD')}` : '—'
}

function Payments() {
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [result, setResult] = useState({ key: '', payments: [], count: 0, error: '' })
  const [reviewTarget, setReviewTarget] = useState(null)
  const [reviewReason, setReviewReason] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [busyProofId, setBusyProofId] = useState('')
  const [proof, setProof] = useState(null)
  const [success, setSuccess] = useState('')
  const requestKey = `${statusFilter}:${page}:${retry}`
  const loading = result.key !== requestKey

  useEffect(() => {
    let active = true
    getAdminPaymentSummary()
      .then((data) => {
        if (active) {
          setSummary(data)
          setSummaryError('')
        }
      })
      .catch((error) => {
        if (active) setSummaryError(error.message || 'Payment statistics could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [retry])

  useEffect(() => {
    let active = true
    getAdminPaymentSubmissions({
      page,
      pageSize,
      status: statusFilter === 'all' ? '' : statusFilter,
    })
      .then((data) => {
        if (active) setResult({ key: requestKey, ...data, error: '' })
      })
      .catch((error) => {
        if (active) setResult({ key: requestKey, payments: [], count: 0, error: error.message || 'Payment submissions could not be loaded.' })
      })
    return () => {
      active = false
    }
  }, [requestKey, page, statusFilter])

  const openProof = async (payment) => {
    setBusyProofId(String(payment.id))
    setResult((current) => ({ ...current, error: '' }))
    try {
      const url = await createPaymentProofUrl(payment.screenshot_path)
      setProof({ url, payment })
    } catch (error) {
      setResult((current) => ({ ...current, error: error.message || 'The private screenshot could not be opened.' }))
    } finally {
      setBusyProofId('')
    }
  }

  const submitReview = async (event) => {
    event.preventDefault()
    if (!reviewTarget) return
    setReviewing(true)
    setSuccess('')
    setResult((current) => ({ ...current, error: '' }))
    try {
      await reviewEventPayment({
        paymentId: reviewTarget.payment.id,
        decision: reviewTarget.decision,
        rejectionReason: reviewTarget.decision === 'rejected' ? reviewReason : '',
      })
      setSuccess(reviewTarget.decision === 'approved'
        ? 'Payment approved. The verified payment slip is now available to the participant.'
        : 'Payment rejected. The participant can submit corrected proof.')
      setReviewTarget(null)
      setReviewReason('')
      setRetry((value) => value + 1)
    } catch (error) {
      setResult((current) => ({ ...current, error: error.message || 'The payment review could not be saved.' }))
    } finally {
      setReviewing(false)
    }
  }

  const pageCount = Math.ceil(result.count / pageSize)

  return (
    <section className="admin-page">
      <div className="admin-page-heading">
        <div><span className="eyebrow">PAYMENT VERIFICATION</span><h1>Payment management</h1><p>Review participant payment proof. Only database-approved payments receive a receipt.</p></div>
      </div>
      {summaryError && <p className="inline-notice" role="alert">{summaryError}</p>}
      <div className="admin-stat-grid payment-stat-grid">
        <article><span>Total submissions</span><strong>{summary?.total_submissions ?? '—'}</strong></article>
        <article><span>Pending</span><strong>{summary?.pending_count ?? '—'}</strong></article>
        <article><span>Approved</span><strong>{summary?.approved_count ?? '—'}</strong></article>
        <article><span>Rejected</span><strong>{summary?.rejected_count ?? '—'}</strong></article>
        <article><span>Approved amount</span><strong>{summary ? formatApprovedAmount(summary.approved_amount) : '—'}</strong></article>
      </div>

      <div className="admin-toolbar payment-filter-toolbar">
        <div className="admin-filter-tabs" role="group" aria-label="Filter payment submissions by status">
          {statusFilters.map((status) => (
            <button type="button" className={statusFilter === status ? 'active' : ''} key={status} onClick={() => { setStatusFilter(status); setPage(0) }}>
              {status[0].toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
        <span className="admin-total">{loading ? 'Loading payments…' : `${result.count} submission${result.count === 1 ? '' : 's'}`}</span>
      </div>
      {success && <p className="inline-notice" role="status">{success}</p>}
      {!loading && result.error && <div className="form-feedback" role="alert">{result.error}<button className="inline-button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
      {loading && <div className="event-skeleton admin-list-skeleton" aria-label="Loading payments" aria-busy="true" />}
      {!loading && !result.error && result.payments.length === 0 && <div className="empty-state"><h2>No {statusFilter === 'all' ? '' : `${statusFilter} `}payment submissions</h2><p>Payment proof submitted by participants will appear here.</p></div>}

      {reviewTarget && (
        <form className="admin-payment-review" onSubmit={(event) => void submitReview(event)}>
          <h2>{reviewTarget.decision === 'approved' ? 'Confirm payment approval' : 'Reject payment submission'}</h2>
          <p>{reviewTarget.payment.registration?.event?.title || 'Event'} · Registration {reviewTarget.payment.registration_id} · {formatFee(reviewTarget.payment.payment_amount)}</p>
          {reviewTarget.decision === 'rejected' && <label className="form-field"><span>Rejection reason</span><textarea rows="3" maxLength="1000" required value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Explain what needs to be corrected" /></label>}
          {reviewTarget.decision === 'approved' && <p>Approval is permanent. It records your admin account and timestamp, creates a unique receipt number, and enables the participant’s payment slip.</p>}
          <div className="admin-payment-review-actions">
            <button className="button button-primary button-small" type="submit" disabled={reviewing || (reviewTarget.decision === 'rejected' && !reviewReason.trim())}>{reviewing ? 'Saving review…' : `Confirm ${reviewTarget.decision}`}</button>
            <button className="button button-outline button-small" type="button" disabled={reviewing} onClick={() => { setReviewTarget(null); setReviewReason('') }}>Cancel</button>
          </div>
        </form>
      )}

      {!loading && !result.error && result.payments.length > 0 && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table admin-payments-table">
              <thead><tr><th>Registration / event</th><th>Participant</th><th>Type</th><th>Fee</th><th>Payment</th><th>Transaction</th><th>Submitted</th><th>Proof</th><th>Status / action</th></tr></thead>
              <tbody>{result.payments.map((payment) => (
                <tr key={payment.id}>
                  <td><strong>{payment.registration?.event?.title || 'Event unavailable'}</strong><small>Registration #{payment.registration_id}</small></td>
                  <td><strong>{payment.registration?.full_name || 'Participant unavailable'}</strong><small>{payment.registration?.email || '—'}</small><small>{payment.registration?.phone || '—'}</small></td>
                  <td className="capitalize">{payment.registration?.participant_type || '—'}</td>
                  <td>{formatFee(payment.payment_amount)}</td>
                  <td className="capitalize">{payment.payment_method}<small>Sender: {payment.sender_phone || '—'}</small></td>
                  <td>{payment.transaction_id}</td>
                  <td>{formatEventDateTime(payment.submitted_at)}</td>
                  <td><button className="inline-button" type="button" disabled={busyProofId === String(payment.id)} onClick={() => void openProof(payment)}>{busyProofId === String(payment.id) ? 'Opening…' : 'View screenshot'}</button></td>
                  <td>
                    <StatusBadge status={payment.payment_status} />
                    {payment.payment_status === 'pending' && <div className="admin-row-actions payment-review-actions">
                      <button className="inline-button" type="button" onClick={() => setReviewTarget({ payment, decision: 'approved' })}>Approve</button>
                      <button className="inline-button danger-link" type="button" onClick={() => setReviewTarget({ payment, decision: 'rejected' })}>Reject</button>
                    </div>}
                    {payment.payment_status === 'rejected' && <small>{payment.rejection_reason}</small>}
                    {payment.payment_status === 'approved' && <small>{payment.receipt_number}</small>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {pageCount > 1 && <div className="admin-pagination"><span>Page {page + 1} of {pageCount}</span><div><button className="button button-outline button-small" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
        </>
      )}

      {proof && (
        <div className="payment-proof-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setProof(null) }}>
          <section className="payment-proof-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-proof-title">
            <div className="payment-proof-heading"><h2 id="payment-proof-title">Private payment screenshot</h2><button className="inline-button" type="button" onClick={() => setProof(null)}>Close</button></div>
            <p>{proof.payment.registration?.full_name} · Transaction {proof.payment.transaction_id}</p>
            <img src={proof.url} alt={`Payment proof for transaction ${proof.payment.transaction_id}`} />
            <a className="text-link" href={proof.url} target="_blank" rel="noopener noreferrer">Open temporary signed link</a>
          </section>
        </div>
      )}
    </section>
  )
}

export default Payments