import { useEffect, useState } from 'react'
import { useAuth } from '../../context/useAuth.js'
import { formatEventDateTime, formatFee } from '../../lib/eventUtils.js'
import { getMyPaymentContext, submitEventPayment } from '../../services/paymentService.js'

const paymentNumbers = ['01707988228', '01775542556']

function PaymentPage({ registrationId }) {
  const { user } = useAuth()
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [copiedNumber, setCopiedNumber] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bkash')

  useEffect(() => {
    let active = true
    getMyPaymentContext(registrationId)
      .then((result) => {
        if (active) {
          setContext(result)
          if (!result) setError('This registration could not be found for your account.')
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Payment details could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [registrationId])

  const copyNumber = async (number) => {
    setCopiedNumber('')
    try {
      await navigator.clipboard.writeText(number)
      setCopiedNumber(number)
    } catch {
      setSubmitError('Copy was unavailable. Select and copy the payment number manually.')
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const file = formData.get('screenshot')
    if (!(file instanceof File) || !file.size) {
      setSubmitError('Upload a payment screenshot before submitting.')
      return
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      const result = await submitEventPayment({
        userId: user.id,
        registrationId,
        paymentMethod,
        transactionId: String(formData.get('transactionId') || ''),
        senderPhone: String(formData.get('senderPhone') || ''),
        paymentNote: String(formData.get('paymentNote') || ''),
        file,
      })
      const payment = Array.isArray(result) ? result[0] : result
      if (!payment?.id || payment.payment_status !== 'pending') {
        throw new Error('The database did not confirm a pending payment submission.')
      }
      setContext((current) => ({
        ...current,
        payment_id: payment.id,
        payment_status: payment.payment_status,
        payment_method: payment.payment_method,
        transaction_id: payment.transaction_id,
        sender_phone: payment.sender_phone,
        payment_note: payment.payment_note,
        payment_amount: payment.payment_amount,
        screenshot_path: payment.screenshot_path,
        submitted_at: payment.submitted_at,
        rejection_reason: null,
        receipt_number: null,
      }))
      setSubmitted(true)
      form.reset()
      setPaymentMethod('bkash')
    } catch (submitFailure) {
      setSubmitError(submitFailure.message || 'Payment proof could not be submitted. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <section className="container event-page-state" aria-live="polite"><p>Loading payment details…</p></section>
  if (error || !context) {
    return <section className="container payment-page"><div className="form-feedback" role="alert">{error || 'Payment details are unavailable.'}</div><a className="button button-outline" href="/dashboard/my-events">My registrations</a></section>
  }

  const isFree = Number(context.fee_amount) <= 0
  const eventUnavailable = ['cancelled', 'completed'].includes(context.event_status)
  const canSubmit = !isFree && context.registration_status === 'registered'
    && !eventUnavailable
    && !['pending', 'approved'].includes(context.payment_status)
  const receiptHref = context.payment_id
    ? `/payments/receipt/${context.registration_id}/${context.payment_id}`
    : ''

  return (
    <section className="container payment-page">
      <a className="back-link" href="/dashboard/my-events"><span aria-hidden="true">←</span> My registrations</a>
      <div className="payment-page-heading">
        <span className="eyebrow">MANUAL PAYMENT</span>
        <h1>Complete your event payment</h1>
        <p>Make the transfer outside Evently, then submit your transaction details for verification.</p>
      </div>
      <div className="payment-layout">
        <main className="payment-main">
          {canSubmit && <section className="payment-instructions">
            <h2>Send Money to an Evently payment number</h2>
            <p>Send the exact registration fee shown below. Enter your own transaction ID and upload a screenshot of the completed payment.</p>
            <div className="payment-number-list">
              {paymentNumbers.map((number) => (
                <div className="payment-number" key={number}>
                  <strong>{number}</strong>
                  <button className="button button-outline button-small" type="button" onClick={() => void copyNumber(number)}>{copiedNumber === number ? 'Copied' : 'Copy number'}</button>
                </div>
              ))}
            </div>
            <p className="payment-safety-note">Evently does not claim that these numbers belong to a specific payment provider. Choose the method you used below.</p>
          </section>}

          {isFree && <div className="inline-notice" role="status">This is a free event. No payment submission is required.</div>}
          {context.registration_status !== 'registered' && !isFree && <div className="inline-notice" role="status">This registration is not active, so payment submission is unavailable.</div>}
          {eventUnavailable && !isFree && <div className="inline-notice" role="status">This event is {context.event_status}. Payment submissions are unavailable.</div>}
          {context.payment_status === 'pending' && (
            <div className="payment-status-panel" role="status">
              <span className="status-badge status-pending">Payment Pending</span>
              <p>Your payment proof was submitted and is awaiting admin verification.</p>
              <p>Transaction ID: <strong>{context.transaction_id}</strong></p>
            </div>
          )}
          {context.payment_status === 'approved' && (
            <div className="payment-status-panel" role="status">
              <span className="status-badge status-approved">Payment Approved</span>
              <p>Your payment has been verified.</p>
              {receiptHref && <a className="button button-primary" href={receiptHref}>Download / print payment slip</a>}
            </div>
          )}
          {context.payment_status === 'rejected' && (
            <div className="payment-rejection" role="alert">
              <strong>Payment proof needs correction</strong>
              <p>{context.rejection_reason || 'Please review your payment details and submit corrected proof.'}</p>
              <p>You may resubmit using the same transaction ID if the rejection was for an unreadable or incomplete screenshot.</p>
            </div>
          )}
          {submitted && <div className="inline-notice" role="status">Payment Submitted Successfully. Your payment is awaiting admin verification.</div>}
          {submitError && <div className="form-feedback" role="alert">{submitError}</div>}

          {canSubmit && (
            <form className="payment-submission-form" onSubmit={(event) => void handleSubmit(event)}>
              <h2>{context.payment_status === 'rejected' ? 'Resubmit payment proof' : 'Submit payment proof'}</h2>
              <label className="form-field">
                <span>Payment method</span>
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} required>
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                  <option value="rocket">Rocket</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="form-field">
                <span>Transaction ID</span>
                <input name="transactionId" required maxLength="128" autoComplete="off" />
              </label>
              <label className="form-field">
                <span>Sender phone number <small className="optional-hint">(optional)</small></span>
                <input name="senderPhone" type="tel" maxLength="40" autoComplete="tel" />
              </label>
              <label className="form-field">
                <span>Payment screenshot</span>
                <input name="screenshot" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required />
                <small className="admin-muted">JPG, PNG, or WEBP; maximum 5 MB. This file is private to you and authorized admins.</small>
              </label>
              <label className="form-field">
                <span>Additional note <small className="optional-hint">(optional)</small></span>
                <textarea name="paymentNote" rows="3" maxLength="1000" />
              </label>
              <button className="button button-primary" type="submit" disabled={submitting}>
                {submitting ? 'Submitting proof…' : 'Submit payment'}
              </button>
            </form>
          )}
        </main>

        <aside className="payment-summary">
          <span className="registration-label">REGISTRATION SUMMARY</span>
          <h2>{context.event_title}</h2>
          <dl>
            <div><dt>Participant</dt><dd>{context.participant_name}</dd></div>
            <div><dt>Registration ID</dt><dd>{context.registration_id}</dd></div>
            <div><dt>Participant type</dt><dd className="capitalize">{context.participant_type}</dd></div>
            <div><dt>Event date</dt><dd>{formatEventDateTime(context.event_start)}</dd></div>
            <div><dt>Registration deadline</dt><dd>{formatEventDateTime(context.registration_deadline)}</dd></div>
            <div className="payment-total"><dt>Exact registration fee</dt><dd>{formatFee(context.fee_amount)}</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  )
}

export default PaymentPage
