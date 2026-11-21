import { useEffect, useMemo, useState } from 'react'
import fallbackImage from '../../assets/hero.png'
import StatusBadge from '../../components/StatusBadge.jsx'
import { formatEventDate, formatEventDateTime, formatFee } from '../../lib/eventUtils.js'
import { getPublishedEvents } from '../../services/eventService.js'
import { getMyRegisteredEventDetails, getMyRegistrations } from '../../services/registrationService.js'
import { getMyPaymentSubmissions } from '../../services/paymentService.js'
import { getMyAttendeeTickets, getMyEventTickets } from '../../services/ticketService.js'
import { createTicketQrDataUrl, downloadTicketPdf } from '../../services/ticketPdfService.js'
import { getMyEventDistributionBenefits } from '../../services/distributionService.js'

function TicketQrDisplay({ ticket, eventTitle }) {
  const [visible, setVisible] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return undefined
    let active = true
    createTicketQrDataUrl(ticket.ticket_token)
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
  }, [ticket.ticket_token, visible])

  const toggleVisible = () => {
    if (visible) {
      setVisible(false)
      return
    }
    setQrDataUrl('')
    setError('')
    setLoading(true)
    setVisible(true)
  }

  return (
    <div className="ticket-qr-display">
      <button className="button button-outline button-small" type="button" aria-expanded={visible} onClick={toggleVisible}>
        {visible ? 'Hide ticket QR' : 'Display ticket QR'}
      </button>
      {visible && (
        <div className="ticket-qr-card" aria-live="polite">
          {loading && <span role="status">Preparing ticket QR…</span>}
          {error && <span className="field-error" role="alert">{error}</span>}
          {qrDataUrl && <img src={qrDataUrl} alt={`QR ticket for ${eventTitle}`} />}
          <small>Keep this private ticket credential to yourself.</small>
        </div>
      )}
    </div>
  )
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
                const benefits = benefitsEventId ? benefitsByEvent[String(benefitsEventId)] || [] : []
                const title = event?.title || 'Event details unavailable'
                const hasPublicDetail = event?.slug && event.event_status === 'published'
                const isPaid = Number(registration.fee_amount) > 0
                const eventUnavailable = ['cancelled', 'completed'].includes(event?.event_status)
                const receiptHref = payment?.payment_status === 'approved' && payment.receipt_number
                  ? `/payments/receipt/${registration.id}/${payment.id}`
                  : ''
                return (
                  <article className="my-registration-card" key={registration.id}>
                    <a className="my-registration-image" href={hasPublicDetail ? `/events/${encodeURIComponent(event.slug)}` : undefined} aria-label={hasPublicDetail ? `View ${title}` : title}>
                      <img src={event?.cover_image_url || fallbackImage} alt={`${title} event`} />
                    </a>
                    <div className="my-registration-main">
                      <div className="my-registration-title"><h2>{title}</h2><StatusBadge status={registration.registration_status} />{event?.event_status === 'cancelled' && <StatusBadge status="Event Cancelled" />}</div>
                      <p>{event ? `${formatEventDateTime(event.event_start)} · ${event.venue}` : 'The event is no longer visible under current event access settings.'}</p>
                      <div className="my-registration-meta">
                        <span><small>Participant type</small><strong>{registration.participant_type}</strong></span>
                        <span><small>Registration fee</small><strong>{formatFee(registration.fee_amount)}</strong></span>
                        <span><small>Registered</small><strong>{formatEventDate(registration.registered_at)}</strong></span>
                      </div>
                      <div className="my-payment-status">
                        {payment && <small>Transaction ID: {payment.transaction_id} · Submitted: {formatEventDateTime(payment.submitted_at)}</small>}
                        {!isPaid
                          ? <span className="status-badge status-free">Free Event / No Payment Required</span>
                          : payment?.payment_status === 'approved'
                            ? <><span className="status-badge status-approved">Payment Approved</span>{receiptHref && <a className="text-link" href={receiptHref}>Download payment slip</a>}</>
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
                      <div className="my-ticket-status">
                        <div>
                          <span className="registration-label">EVENT TICKET</span>
                          {ticket?.ticket_status === 'active' || ticket?.ticket_status === 'checked_in'
                            ? <><strong>{ticket.ticket_status === 'checked_in' ? 'Checked in' : 'Ticket ready'}</strong><small>Reference: {ticket.ticket_reference}</small></>
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
                            <TicketQrDisplay ticket={ticket} eventTitle={title} />
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
                      </div>
                      {attendeeTickets.length > 0 && (
                        <div className="my-attendee-tickets">
                          <span className="registration-label">REGISTRATION GROUP TICKETS</span>
                          <div className="my-attendee-ticket-grid">
                            {attendeeTickets.map((attendeeTicket) => (
                              <div className="my-attendee-ticket" key={attendeeTicket.ticket_id}>
                                <strong>{attendeeTicket.attendee_name}</strong>
                                <span>{attendeeTicket.attendee_type === 'guest'
                                  ? `Guest — ${attendeeTicket.relationship}`
                                  : 'Main Participant'}</span>
                                <small>{attendeeTicket.checked_in_at ? `Checked in ${formatEventDateTime(attendeeTicket.checked_in_at)}` : 'Not checked in'}</small>
                                <span className={`status-badge ${attendeeTicket.ticket_status === 'active' ? 'status-approved' : 'status-revoked'}`}>{attendeeTicket.ticket_status}</span>
                                {attendeeTicket.ticket_status === 'active' && attendeeTicket.ticket_token && (
                                  <>
                                    <TicketQrDisplay ticket={attendeeTicket} eventTitle={attendeeTicket.event_title} />
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
                                        event_title: attendeeTicket.event_title,
                                        event_start: event?.event_start,
                                        venue: event?.venue,
                                        event_mode: event?.event_mode,
                                      })}
                                    >
                                      Download ticket PDF
                                    </button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {benefits.length > 0 && (
                        <div className="my-event-benefits">
                          <span className="registration-label">MY EVENT BENEFITS</span>
                          <div className="my-event-benefit-grid">
                            {benefits.map((benefit) => (
                              <div className={`my-event-benefit is-${benefit.status}`} key={benefit.item_id}>
                                <strong>{benefit.item_name}</strong>
                                <span>{benefit.status === 'received' ? 'Received' : 'Not Received'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {hasPublicDetail && <a className="button button-outline button-small" href={`/events/${encodeURIComponent(event.slug)}`}>View event</a>}
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
