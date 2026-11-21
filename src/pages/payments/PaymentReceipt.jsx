import { useEffect, useState } from 'react'
import { Brand } from '../../components/Navbar.jsx'
import { formatEventDateTime, formatFee } from '../../lib/eventUtils.js'
import { getMyPaymentContext } from '../../services/paymentService.js'

function PaymentReceipt({ registrationId, paymentId }) {
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getMyPaymentContext(registrationId)
      .then((result) => {
        if (!active) return
        if (!result || result.payment_id !== paymentId || result.payment_status !== 'approved' || !result.receipt_number) {
          setError('An approved payment slip is not available for this registration.')
          return
        }
        setContext(result)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'The payment slip could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [registrationId, paymentId])

  if (loading) return <section className="container event-page-state" aria-live="polite"><p>Verifying payment approval…</p></section>
  if (error || !context) return <section className="container payment-page"><div className="form-feedback" role="alert">{error || 'The payment slip is unavailable.'}</div><a className="button button-outline" href="/dashboard/my-events">My registrations</a></section>

  return (
    <section className="container receipt-page">
      <div className="receipt-actions no-print">
        <a className="back-link" href="/dashboard/my-events">← My registrations</a>
        <button className="button button-primary" type="button" onClick={() => window.print()}>Download / print payment slip</button>
      </div>
      <article className="payment-receipt">
        <header className="receipt-brand">
          <div className="receipt-brand-lockup"><Brand /></div>
          <span className="receipt-tagline">Every Event. One Platform.</span>
          <span className="receipt-approved">PAYMENT APPROVED</span>
        </header>
        <div className="receipt-title"><span className="eyebrow">OFFICIAL PAYMENT SLIP</span><h1>{context.event_title}</h1></div>
        <dl className="receipt-details">
          <div><dt>Receipt number</dt><dd>{context.receipt_number}</dd></div>
          <div><dt>Registration ID</dt><dd>{context.registration_id}</dd></div>
          <div><dt>Participant</dt><dd>{context.participant_name}</dd></div>
          <div><dt>Email</dt><dd>{context.email}</dd></div>
          <div><dt>Phone</dt><dd>{context.phone}</dd></div>
          <div><dt>Participant type</dt><dd className="capitalize">{context.participant_type}</dd></div>
          <div><dt>Institution</dt><dd>{context.institution_name || '—'}</dd></div>
          <div><dt>Department</dt><dd>{context.department_name || '—'}</dd></div>
          <div><dt>Payment method</dt><dd className="capitalize">{context.payment_method}</dd></div>
          <div><dt>Transaction ID</dt><dd>{context.transaction_id}</dd></div>
          <div><dt>Event date</dt><dd>{formatEventDateTime(context.event_start)}</dd></div>
          <div><dt>Payment date</dt><dd>{formatEventDateTime(context.submitted_at)}</dd></div>
          <div><dt>Verification date</dt><dd>{formatEventDateTime(context.reviewed_at)}</dd></div>
          <div><dt>Verified by</dt><dd>{context.reviewer_name || context.reviewed_by || 'Not available'}</dd></div>
        </dl>
        <div className="receipt-total"><span>Paid amount</span><strong>{formatFee(context.payment_amount)}</strong></div>
        <footer className="receipt-footer">
          <span>Status: APPROVED</span>
          <span>Generated from Evently’s verified payment record.</span>
        </footer>
      </article>
    </section>
  )
}

export default PaymentReceipt
