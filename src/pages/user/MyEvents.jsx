import { useEffect, useMemo, useState } from 'react'
import fallbackImage from '../../assets/hero.png'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatEventDate, formatEventDateTime, formatFee } from '../../lib/eventUtils.js'
import { getPublishedEvents } from '../../services/eventService.js'
import { getMyRegisteredEventDetails, getMyRegistrations } from '../../services/registrationService.js'
import { getMyPaymentSubmissions } from '../../services/paymentService.js'
import { getEventTicketPassMeta, getMyAttendeeTickets, getMyEventTickets } from '../../services/ticketService.js'
import { createTicketQrDataUrl, downloadTicketPdf } from '../../services/ticketPdfService.js'
import { getMyEventDistributionBenefits } from '../../services/distributionService.js'

function ticketIssuer(ticket, passMeta, metadataLoaded) {
  const joinedIssuer = ticket.issuer
    || ticket.issuer_profile
    || ticket.issued_by_profile
    || ticket.profiles
    || ticket.profile
    || (typeof ticket.issued_by === 'object' ? ticket.issued_by : null)
  const issuer = Array.isArray(joinedIssuer) ? joinedIssuer[0] : joinedIssuer
  const metadataIssuer = passMeta?.issuer
    || passMeta?.issuer_profile
    || passMeta?.profile
    || (typeof passMeta?.issued_by === 'object' ? passMeta.issued_by : null)
  const metaIssuer = Array.isArray(metadataIssuer) ? metadataIssuer[0] : metadataIssuer
  const metadataHasIssuer = Boolean(passMeta) && [
    'issuer_name',
    'issuer_full_name',
    'issuer_email',
    'issued_by_email',
    'issued_by',
    'issuer_id',
  ].some((key) => Object.hasOwn(passMeta, key))
  const metadataName = [
    passMeta?.issuer_name,
    passMeta?.issuer_full_name,
    metaIssuer?.full_name,
    metaIssuer?.name,
  ].map((value) => String(value || '').trim()).find(Boolean)
  const ticketName = [
    ticket.issuer_name,
    ticket.issuer_full_name,
    ticket.issued_by_name,
    issuer?.full_name,
    issuer?.name,
  ].map((value) => String(value || '').trim()).find(Boolean)
  const name = (metadataLoaded && metadataHasIssuer ? metadataName : metadataName || ticketName)
  const metadataEmail = [
    passMeta?.issuer_email,
    passMeta?.issued_by_email,
    metaIssuer?.email,
  ].map((value) => String(value || '').trim()).find(Boolean)
  const ticketEmail = [
    ticket.issuer_email,
    ticket.issued_by_email,
    issuer?.email,
  ].map((value) => String(value || '').trim()).find(Boolean)
  const email = metadataLoaded && metadataHasIssuer ? metadataEmail : metadataEmail || ticketEmail
  if (name && name !== 'System / Auto-issued') {
    return { name, email }
  }
  if (email) return { name: email, email: '' }
  if (metadataLoaded) {
    if (!passMeta) return { name: 'Issuer unavailable', email: '' }
    const metaIssuedBy = passMeta.issued_by ?? passMeta.issuer_id
    if (metadataHasIssuer && metaIssuedBy == null) return { name: 'System / Auto-issued', email: '' }
    return { name: 'Issuer unavailable', email: '' }
  }
  return { name: 'Issuer unavailable', email: '' }
}

function TicketQrDisplay({ ticket, eventTitle, attendeeType, eventDetails, participantName, guestOf }) {
  const [visible, setVisible] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [passMeta, setPassMeta] = useState(null)
  const [metadataLoaded, setMetadataLoaded] = useState(false)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [metadataError, setMetadataError] = useState('')
  const isGuest = attendeeType === 'guest'
  const qrColor = isGuest ? '#162e52' : '#133a27'
  const issuer = ticketIssuer(ticket, passMeta, metadataLoaded)
  const issuedAt = passMeta?.issued_at || ticket.issued_at
  const ticketId = ticket.id ?? ticket.ticket_id
  const eventMode = String(ticket.event_mode || eventDetails?.event_mode || '').toLowerCase()
  const venue = ticket.venue || eventDetails?.venue
  const venueMode = eventMode === 'online'
    ? venue || 'Online event'
    : [venue, eventMode && eventMode !== 'offline' ? eventMode : ''].filter(Boolean).join(' · ') || 'Venue to be announced'
  const attendeeName = ticket.attendee_name || ticket.participant_name || participantName || 'Attendee'
  const attendeeTypeLabel = isGuest
    ? `GUEST • ${ticket.relationship || 'GUEST'}`
    : ticket.participant_type || 'PARTICIPANT'
  const ticketStatus = ticket.ticket_status === 'revoked' ? 'REVOKED' : 'ACTIVE'
  const title = ticket.event_title || eventTitle || 'Event'

  useEffect(() => {
    if (!visible) return undefined
    let active = true
    createTicketQrDataUrl(ticket.ticket_token, qrColor)
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl)
      })
      .catch((qrError) => {
        if (active) setError(qrError.message || 'The ticket QR code could not be displayed.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [ticket.ticket_token, visible, qrColor])

  useEffect(() => {
    if (!visible) return undefined
    if (!ticketId) return undefined
    let active = true
    getEventTicketPassMeta(ticketId)
      .then((meta) => {
        if (!active) return
        setPassMeta(meta)
        setMetadataLoaded(true)
      })
      .catch((metaError) => {
        if (!active) return
        setPassMeta(null)
        setMetadataError(metaError.message || 'Ticket issue details could not be loaded.')
      })
      .finally(() => {
        if (active) setMetadataLoading(false)
      })
    return () => {
      active = false
    }
  }, [ticketId, visible])

  const toggleVisible = () => {
    if (visible) {
      setVisible(false)
      return
    }
    setQrDataUrl('')
    setError('')
    setPassMeta(null)
    setMetadataLoaded(false)
    setMetadataLoading(Boolean(ticketId))
    setMetadataError(ticketId ? '' : 'Ticket issue details are unavailable.')
    setLoading(true)
    setVisible(true)
  }

  return (
    <div className="ticket-qr-display">
      <button className="button button-outline button-small" type="button" aria-expanded={visible} onClick={toggleVisible}>
        {visible ? 'Hide ticket' : 'View ticket'}
      </button>
      {visible && (
        <article className={`boarding-pass ${isGuest ? 'boarding-pass--guest' : 'boarding-pass--participant'}`} aria-live="polite">
          <header className="boarding-pass-header">
            <div className="boarding-pass-brand"><span className="boarding-pass-mark">E</span><strong>EVENTLY</strong></div>
            <span className="boarding-pass-badge">{isGuest ? 'GUEST PASS' : 'PARTICIPANT PASS'}</span>
          </header>
          <div className="boarding-pass-layout">
            <section className="boarding-pass-info">
              <span className="boarding-pass-field-label">EVENT</span>
              <h2>{title}</h2>
              <dl className="boarding-pass-details">
                <div><dt>DATE &amp; TIME</dt><dd>{formatEventDateTime(ticket.event_start || eventDetails?.event_start)}</dd></div>
                <div><dt>VENUE / MODE</dt><dd>{venueMode}</dd></div>
                <div><dt>PARTICIPANT</dt><dd>{attendeeName}</dd></div>
                <div><dt>TYPE</dt><dd className="boarding-pass-type">{attendeeTypeLabel}</dd></div>
                {isGuest && <div className="boarding-pass-guest-of"><dt>GUEST OF</dt><dd>{guestOf || passMeta?.main_participant_name || ticket.guest_of || '—'}</dd></div>}
                <div><dt>TICKET REFERENCE</dt><dd>{ticket.ticket_reference || '—'}</dd></div>
                <div><dt>ISSUED</dt><dd>{issuedAt ? formatEventDateTime(issuedAt) : 'Issue time unavailable'}</dd></div>
                <div><dt>ISSUED BY</dt><dd>{issuer.name}{issuer.email && <small>{issuer.email}</small>}</dd></div>
                <div><dt>STATUS</dt><dd><span className={`boarding-pass-status ${ticketStatus === 'REVOKED' ? 'is-revoked' : ''}`}>{ticketStatus}</span></dd></div>
              </dl>
              {metadataLoading && <small role="status">Loading ticket issue details…</small>}
              {metadataError && <small className="field-error" role="status">{metadataError}</small>}
            </section>
            <aside className="boarding-pass-qr-panel">
              <div className="boarding-pass-qr">
                {loading && <span role="status">Preparing ticket QR…</span>}
                {error && <span className="field-error" role="alert">{error}</span>}
                {qrDataUrl && <img src={qrDataUrl} alt={`QR ticket for ${title}`} />}
              </div>
              <strong className="boarding-pass-valid">VALID</strong>
              <p>Present this QR code at event day.</p>
              <small>The QR contains a private ticket credential. Do not share it.</small>
            </aside>
          </div>
        </article>
      )}
    </div>
  )
}

function getBenefitItemId(benefit) {
  return String(benefit.distribution_item_id ?? benefit.item_id ?? '')
}

function isBenefitReceived(benefit) {
  return String(benefit.status || '').toLowerCase() === 'received'
    || Number(benefit.quantity_received) > 0
}

function getBenefitDisplayStatus(benefits) {
  if (benefits.some(isBenefitReceived)) return 'received'
  if (benefits.some((benefit) => (
    String(benefit.status || '').toLowerCase() === 'not_applicable'
    || (benefit.attendee_type === 'guest' && benefit.guest_eligible === false)
  ))) return 'not_applicable'
  return 'not_received'
}

function MyEvents({ compact = false }) {
  const [registrations, setRegistrations] = useState([])
  const [eventsByRegistration, setEventsByRegistration] = useState({})
  const [paymentByRegistration, setPaymentByRegistration] = useState({})
  const [ticketByRegistration, setTicketByRegistration] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailsWarning, setDetailsWarning] = useState('')
  const [paymentWarning, setPaymentWarning] = useState('')
  const [ticketWarning, setTicketWarning] = useState('')
  const [ticketDownloadError, setTicketDownloadError] = useState('')
  const [downloadingTicketId, setDownloadingTicketId] = useState('')
  const [retry, setRetry] = useState(0)
  const [benefitsByEvent, setBenefitsByEvent] = useState({})
  const [attendeeTicketsByRegistration, setAttendeeTicketsByRegistration] = useState({})
  const [selectedRegistrationId, setSelectedRegistrationId] = useState('')

  useEffect(() => {
    let active = true
    getMyRegistrations()
      .then(async (items) => {
        if (!active) return
        setRegistrations(items)
        const [detailsResult, publicEventsResult, paymentResult, ticketResult, benefitsResult, attendeeTicketsResult] = await Promise.allSettled([
          getMyRegisteredEventDetails(),
          getPublishedEvents(),
          getMyPaymentSubmissions(items.map((registration) => registration.id)),
          getMyEventTickets(),
          getMyEventDistributionBenefits(),
          getMyAttendeeTickets(),
        ])
        if (!active) return
        const eventMap = {}
        const privateDetailsUnavailable = detailsResult.status === 'rejected'
        if (!privateDetailsUnavailable) {
          detailsResult.value.forEach((detail) => { eventMap[String(detail.registration_id)] = detail })
        }
        if (publicEventsResult.status === 'fulfilled') {
          const byId = new Map(publicEventsResult.value.map((event) => [String(event.id), event]))
          items.forEach((registration) => {
            if (!eventMap[String(registration.id)] && byId.has(String(registration.event_id))) {
              const event = byId.get(String(registration.event_id))
              eventMap[String(registration.id)] = {
                registration_id: registration.id,
                event_id: event.id,
                title: event.title,
                slug: event.slug,
                cover_image_url: event.cover_image_url,
                event_start: event.event_start,
                venue: event.venue,
                event_mode: event.event_mode,
                event_status: event.status,
              }
            }
          })
        } else if (items.length && privateDetailsUnavailable) {
          setDetailsWarning('Event details could not be loaded. Your registration records are still available.')
        }
        if (privateDetailsUnavailable && items.some((item) => !eventMap[String(item.id)])) {
          setDetailsWarning('Some event details are hidden by current RLS settings. Apply the self-scoped event-details RPC from the manual SQL file to show details for cancelled or completed events.')
        }
        setEventsByRegistration(eventMap)
        if (paymentResult.status === 'fulfilled') {
          const paymentMap = {}
          paymentResult.value.forEach((payment) => {
            if (!paymentMap[String(payment.registration_id)]) paymentMap[String(payment.registration_id)] = payment
          })
          setPaymentByRegistration(paymentMap)
          setPaymentWarning('')
        } else {
          setPaymentWarning('Payment statuses could not be loaded. Your registration records are still available.')
        }
        if (ticketResult.status === 'fulfilled') {
          setTicketByRegistration(Object.fromEntries(
            ticketResult.value.map((ticket) => [String(ticket.registration_id), ticket]),
          ))
          setTicketWarning('')
        } else {
          setTicketWarning('Ticket setup is unavailable. Apply the Phase 4 and Phase 5 Supabase migrations, then refresh.')
        }
        if (benefitsResult.status === 'fulfilled') {
          const benefitMap = {}
          benefitsResult.value.forEach((benefit) => {
            const eventKey = String(benefit.event_id)
            benefitMap[eventKey] = [...(benefitMap[eventKey] || []), benefit]
          })
          setBenefitsByEvent(benefitMap)
        }
        if (attendeeTicketsResult.status === 'fulfilled') {
          const ticketMap = {}
          attendeeTicketsResult.value.forEach((attendeeTicket) => {
            const key = String(attendeeTicket.registration_id)
            ticketMap[key] = [...(ticketMap[key] || []), attendeeTicket]
          })
          setAttendeeTicketsByRegistration(ticketMap)
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Your registrations could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [retry])

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') setRetry((value) => value + 1)
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [])

  useEffect(() => {
    if (!selectedRegistrationId) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSelectedRegistrationId('')
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [selectedRegistrationId])

  const [now] = useState(() => Date.now())
  const metrics = useMemo(() => {
    const active = registrations.filter((item) => item.registration_status === 'registered')
    return {
      total: active.length,
      upcoming: active.filter((item) => {
        const event = eventsByRegistration[String(item.id)]
        return event?.event_start && Date.parse(event.event_start) > now
      }).length,
      past: active.filter((item) => {
        const event = eventsByRegistration[String(item.id)]
        return event?.event_start && Date.parse(event.event_start) <= now
      }).length,
      cancelled: registrations.filter((item) => item.registration_status === 'cancelled').length,
    }
  }, [registrations, eventsByRegistration, now])
  const visibleRegistrations = compact ? registrations.slice(0, 3) : registrations
  const downloadTicket = async (ticket) => {
    setDownloadingTicketId(String(ticket.registration_id))
    setTicketDownloadError('')
    try {
      await downloadTicketPdf(ticket)
    } catch (downloadError) {
      setTicketDownloadError(downloadError.message || 'The ticket PDF could not be created.')
    } finally {
      setDownloadingTicketId('')
    }
  }

  return (
    <section className={`container user-events-page${compact ? ' user-events-compact' : ''}`}>
      {!compact && <div className="user-page-heading"><div><span className="eyebrow">YOUR CAMPUS LIFE</span><h1>My registrations</h1><p>Your event sign-ups and registration details in one place.</p></div><a className="button button-outline" href="/events">Explore events</a></div>}
      {loading ? <div className="event-skeleton admin-list-skeleton" aria-label="Loading registrations" aria-busy="true" /> : error ? (
        <div className="empty-state" role="alert"><h2>Registrations couldn’t load</h2><p>{error}</p><button className="button button-outline" type="button" onClick={() => { setLoading(true); setError(''); setDetailsWarning(''); setRetry((value) => value + 1) }}>Try again</button></div>
      ) : (
        <>
          <div className="user-stat-grid">
            <article><span>Total registered</span><strong>{metrics.total}</strong></article>
            <article><span>Upcoming events</span><strong>{metrics.upcoming}</strong></article>
            <article><span>Past events</span><strong>{metrics.past}</strong></article>
            <article><span>Cancelled registrations</span><strong>{metrics.cancelled}</strong></article>
          </div>
          {detailsWarning && <p className="inline-notice" role="status">{detailsWarning}</p>}
          {paymentWarning && <p className="inline-notice" role="status">{paymentWarning}</p>}
          {ticketWarning && <p className="inline-notice" role="status">{ticketWarning}</p>}
          {ticketDownloadError && <p className="form-feedback" role="alert">{ticketDownloadError}</p>}
          {!visibleRegistrations.length ? <div className="empty-state"><h2>No registrations yet</h2><p>When you register for a published event, it will appear here.</p><a className="button button-primary" href="/events">Explore events</a></div> : (
            <div className="my-registration-list">
              {visibleRegistrations.map((registration) => {
                const event = eventsByRegistration[String(registration.id)]
                const payment = paymentByRegistration[String(registration.id)]
                const ticket = ticketByRegistration[String(registration.id)]
                const attendeeTickets = attendeeTicketsByRegistration[String(registration.id)] || []
                const benefitsEventId = event?.event_id || event?.id
                const benefits = (benefitsEventId
                  ? (benefitsByEvent[String(benefitsEventId)] || [])
                  : []
                ).filter((benefit) => String(benefit.registration_id) === String(registration.id))
                const benefitsByAttendee = benefits.reduce((groups, benefit) => {
                  const key = String(benefit.attendee_id || benefit.attendee_type || 'participant')
                  groups[key] = groups[key] || []
                  groups[key].push(benefit)
                  return groups
                }, {})
                const title = event?.title || 'Event details unavailable'
                const hasPublicDetail = event?.slug && event.event_status === 'published'
                const isPaid = Number(registration.fee_amount) > 0
                const paymentApproved = !isPaid || payment?.payment_status === 'approved'
                const canViewRegistration = registration.registration_status === 'registered' && paymentApproved
                const eventUnavailable = ['cancelled', 'completed'].includes(event?.event_status)
                const attendeeHasMainTicket = attendeeTickets.some((item) => item.attendee_type === 'participant')
                const summaryStatus = registration.registration_status !== 'registered'
                  ? 'Cancelled'
                  : !isPaid || payment?.payment_status === 'approved'
                    ? 'Approved'
                    : payment?.payment_status === 'rejected'
                      ? 'Rejected'
                      : 'Pending'
                const receiptHref = payment?.payment_status === 'approved' && payment.receipt_number
                  ? `/payments/receipt/${registration.id}/${payment.id}`
                  : ''
                return (
                  <article className="my-registration-card" key={registration.id}>
                    <a className="my-registration-image" href={hasPublicDetail ? `/events/${encodeURIComponent(event.slug)}` : undefined} aria-label={hasPublicDetail ? `View ${title}` : title}>
                      <img src={event?.cover_image_url || fallbackImage} alt={`${title} event`} />
                    </a>
                    <div className="my-registration-summary">
                      <div className="my-registration-title"><h2>{title}</h2></div>
                      <p>{event ? `${formatEventDateTime(event.event_start)} · ${event.venue}` : 'The event is no longer visible under current event access settings.'}</p>
                    </div>
                    <div className="my-registration-action">
                      <span className={`registration-summary-status is-${summaryStatus.toLowerCase()}`}>{summaryStatus}</span>
                      {canViewRegistration
                        ? <button className="button button-primary button-small" type="button" onClick={() => setSelectedRegistrationId(String(registration.id))}>View</button>
                        : registration.registration_status === 'registered' && isPaid && payment?.payment_status === 'rejected' && !eventUnavailable
                          ? <a className="button button-outline button-small" href={`/payments/${registration.id}`}>Resubmit</a>
                          : registration.registration_status === 'registered' && isPaid && payment?.payment_status !== 'approved' && !eventUnavailable
                            ? <a className="button button-outline button-small" href={`/payments/${registration.id}`}>Complete payment</a>
                            : null}
                    </div>
                    {selectedRegistrationId === String(registration.id) && (
                      <div className="registration-details-backdrop" onMouseDown={(mouseEvent) => {
                        if (mouseEvent.target === mouseEvent.currentTarget) setSelectedRegistrationId('')
                      }}>
                        <section className="registration-details-dialog" role="dialog" aria-modal="true" aria-labelledby={`registration-dialog-title-${registration.id}`}>
                          <header className="registration-details-header">
                            <span id={`registration-dialog-title-${registration.id}`}>Registration details</span>
                            <button className="registration-details-close" type="button" onClick={() => setSelectedRegistrationId('')} aria-label="Close event details">×</button>
                          </header>
                          <div className="registration-details-content">
                    <div className="my-registration-main">
                      <span className="registration-label">REGISTRATION & PAYMENT</span>
                      <div className="my-registration-title"><h2>{title}</h2><StatusBadge status={registration.registration_status} />{event?.event_status === 'cancelled' && <StatusBadge status="Event Cancelled" />}</div>
                      <p>{event ? `${formatEventDateTime(event.event_start)} · ${event.venue}` : 'The event is no longer visible under current event access settings.'}</p>
                      <div className="my-registration-meta">
                        <span><small>Participant type</small><strong>{registration.participant_type}</strong></span>
                        <span><small>Registration fee</small><strong>{formatFee(registration.fee_amount)}</strong></span>
                        <span><small>Registered</small><strong>{formatEventDate(registration.registered_at)}</strong></span>
                      </div>
                      <div className="my-payment-status">
                        {payment?.transaction_id && <small>Transaction ID: {payment.transaction_id}</small>}
                        {payment?.submitted_at && <small>Submitted: {formatEventDateTime(payment.submitted_at)}</small>}
                        {!isPaid
                          ? <span className="status-badge status-free">Free Event / No Payment Required</span>
                          : payment?.payment_status === 'approved'
                            ? <><span className="status-badge status-approved">Payment Approved</span>{receiptHref && <a className="button button-primary button-small payment-slip-download" href={receiptHref}>Download payment slip</a>}</>
                            : payment?.payment_status === 'pending'
                              ? <><span className="status-badge status-pending">Payment Pending</span><a className="text-link" href={`/payments/${registration.id}`}>View payment status</a></>
                              : payment?.payment_status === 'rejected'
                                ? <><span className="status-badge status-rejected">Payment Rejected</span><small>{payment.rejection_reason}</small>{eventUnavailable ? <small>Payment is unavailable because this event is {event.event_status}.</small> : <a className="button button-outline button-small" href={`/payments/${registration.id}`}>Resubmit payment</a>}</>
                                : registration.registration_status === 'registered'
                                  ? eventUnavailable
                                    ? <span className="status-badge status-cancelled">Payment unavailable · Event {event.event_status}</span>
                                    : <><span className="status-badge status-payment-required">Payment Required</span><a className="button button-primary button-small" href={`/payments/${registration.id}`}>Submit payment</a></>
                                  : <span className="status-badge status-cancelled">Payment unavailable</span>}
                      </div>
                      {!attendeeHasMainTicket && <div className="my-ticket-status">
                        <div>
                          <span className="registration-label">EVENT TICKET</span>
                          {ticket?.ticket_status === 'active' || ticket?.ticket_status === 'checked_in'
                            ? <><strong>Ticket ready</strong><small>Reference: {ticket.ticket_reference}</small></>
                            : ticket?.ticket_status === 'revoked'
                              ? <><strong>Ticket revoked</strong><small>Contact the event organizer if you believe this is incorrect.</small></>
                              : ticket?.ticket_status === 'not_eligible' || registration.registration_status !== 'registered'
                                ? <><strong>Ticket unavailable</strong><small>This registration is not eligible for entry.</small></>
                                : isPaid && ticket?.payment_status === 'pending'
                                  ? <><strong>Ticket pending</strong><small>Your payment is awaiting verification. Your ticket will be available after approval.</small></>
                                  : isPaid && ticket?.payment_status === 'rejected'
                                    ? <><strong>Ticket unavailable</strong><small>Your payment was not approved. Please follow the payment instructions.</small></>
                                    : isPaid && ticket?.payment_status !== 'approved'
                                      ? <><strong>Payment required</strong><small>Complete payment before your ticket can be issued.</small></>
                                      : <><strong>Ticket is being prepared</strong><small>Refresh this page in a moment to check availability.</small></>}
                        </div>
                        {(ticket?.ticket_status === 'active' || ticket?.ticket_status === 'checked_in') && ticket.ticket_token && (
                          <div className="my-ticket-actions">
                            <TicketQrDisplay ticket={ticket} eventTitle={title} attendeeType="participant" eventDetails={event} participantName={registration.full_name} />
                            <button
                              className="button button-outline button-small"
                              type="button"
                              disabled={downloadingTicketId === String(ticket.registration_id)}
                              onClick={() => void downloadTicket(ticket)}
                            >
                              {downloadingTicketId === String(ticket.registration_id) ? 'Preparing PDF…' : 'Download ticket PDF'}
                            </button>
                          </div>
                        )}
                      </div>}
                      {attendeeTickets.length > 0 && (
                        <div className="my-attendee-tickets">
                          <span className="registration-label">REGISTRATION GROUP TICKETS</span>
                          <div className="my-attendee-ticket-grid">
                            {attendeeTickets.map((attendeeTicket) => (
                              <div className="my-attendee-ticket" key={attendeeTicket.ticket_id}>
                                <div className="attendee-ticket-identity">
                                  <strong>{attendeeTicket.attendee_name}</strong>
                                  <span>{attendeeTicket.attendee_type === 'guest'
                                    ? `Guest — ${attendeeTicket.relationship}`
                                    : 'Main Participant'}</span>
                                  <small>Ticket reference: {attendeeTicket.ticket_reference}</small>
                                </div>
                                <div className="attendee-ticket-meta">
                                  <span className={`status-badge ${attendeeTicket.ticket_status === 'revoked' ? 'status-revoked' : 'status-approved'}`}>
                                    {attendeeTicket.ticket_status === 'revoked' ? 'revoked' : 'active'}
                                  </span>
                                </div>
                                {attendeeTicket.ticket_status === 'active' && attendeeTicket.ticket_token && (
                                  <div className="attendee-ticket-actions">
                                    <TicketQrDisplay
                                      ticket={attendeeTicket}
                                      eventTitle={attendeeTicket.event_title}
                                      attendeeType={attendeeTicket.attendee_type}
                                      eventDetails={event}
                                      participantName={attendeeTicket.attendee_name}
                                      guestOf={registration.full_name || attendeeTicket.guest_of}
                                    />
                                    <button
                                      className="button button-outline button-small"
                                      type="button"
                                      disabled={downloadingTicketId === String(attendeeTicket.ticket_id)}
                                      onClick={() => void downloadTicket({
                                        ticket_token: attendeeTicket.ticket_token,
                                        ticket_reference: attendeeTicket.ticket_reference,
                                        attendee_name: attendeeTicket.attendee_name,
                                        attendee_type: attendeeTicket.attendee_type,
                                        relationship: attendeeTicket.relationship,
                                        participant_type: attendeeTicket.attendee_type,
                                        issued_by: attendeeTicket.issued_by,
                                        issuer_name: attendeeTicket.issuer_name,
                                        issuer_email: attendeeTicket.issuer_email,
                                        event_title: attendeeTicket.event_title,
                                        event_start: event?.event_start,
                                        venue: event?.venue,
                                        event_mode: event?.event_mode,
                                      })}
                                    >
                                      Download ticket PDF
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {benefits.length > 0 && (
                        <div className="my-event-benefits">
                          <span className="registration-label">MY EVENT BENEFITS</span>
                          {Object.entries(benefitsByAttendee).map(([attendeeId, attendeeBenefits]) => (
                            <div className="my-attendee-benefits" key={attendeeId}>
                              <div className="attendee-benefits-heading">
                                <div>
                                  <strong>{attendeeBenefits[0].attendee_name}</strong>
                                  <small>{attendeeBenefits[0].attendee_type === 'guest'
                                    ? `Guest — ${attendeeBenefits[0].relationship}`
                                    : 'Main Participant'}</small>
                                </div>
                                {attendeeBenefits[0].attendee_type === 'guest' && <span className="attendee-type-badge">Guest</span>}
                              </div>
                              <div className="attendee-benefit-meta">
                                {attendeeBenefits[0].ticket_reference && <small>Ticket reference: {attendeeBenefits[0].ticket_reference}</small>}
                              </div>
                              <div className="my-event-benefit-grid">
                                {[...new Map(attendeeBenefits.map((benefit) => [
                                  getBenefitItemId(benefit),
                                  benefit,
                                ])).values()].map((benefit) => {
                                  const itemId = getBenefitItemId(benefit)
                                  const matchingBenefits = benefits.filter((row) => (
                                    String(row.attendee_id || row.attendee_type || 'participant') === attendeeId
                                    && getBenefitItemId(row) === itemId
                                  ))
                                  const status = getBenefitDisplayStatus(matchingBenefits)
                                  return (
                                    <div className={`my-event-benefit is-${status}`} key={itemId}>
                                      <strong>{benefit.item_name}</strong>
                                      <span className={`benefit-status is-${status}`}>
                                        {status === 'received' ? 'Received' : status === 'not_applicable' ? 'Not Applicable' : 'Not Received'}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                            {hasPublicDetail && <a className="button button-outline button-small" href={`/events/${encodeURIComponent(event.slug)}`}>View event page</a>}
                          </div>
                        </section>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
          {compact && registrations.length > 3 && <a className="text-link user-view-all" href="/dashboard/my-events">View all registrations</a>}
          {compact && registrations.length === 0 && <a className="button button-outline" href="/events">Explore events</a>}
        </>
      )}
    </section>
  )
}

export default MyEvents
