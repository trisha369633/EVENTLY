import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { useAuth } from '../../context/useAuth.js'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import {
  getMyDistributionItems,
  recordContinuousAttendeeDistribution,
} from '../../services/distributionService.js'
import {
  checkInAttendeeTicket,
  checkInEventTicket,
  getTicketScannerEvents,
  validateAttendeeTicket,
} from '../../services/ticketService.js'

function TicketScanner({ workflow = 'entry' }) {
  const { roles } = useAuth()
  const videoRef = useRef(null)
  const scanInFlight = useRef(false)
  const scannerControls = useRef(null)
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [token, setToken] = useState('')
  const [result, setResult] = useState(null)
  const [distributionError, setDistributionError] = useState('')
  const [distributionSuccess, setDistributionSuccess] = useState('')
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraLoading, setCameraLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [assignedItems, setAssignedItems] = useState([])
  const [selectedItemIds, setSelectedItemIds] = useState([])
  const [continuousResult, setContinuousResult] = useState([])
  const [continuousSessionActive, setContinuousSessionActive] = useState(false)
  const isSuperAdmin = roles.includes('super_admin')
  const isDistributionMode = workflow === 'distribution'

  const validateTicket = useCallback(async (value) => {
    if (!eventId) {
      setError('Choose an event before scanning a ticket.')
      return
    }
    setChecking(true)
    setError('')
    setDistributionError('')
    setDistributionSuccess('')
    setResult(null)
    try {
      if (isDistributionMode) {
        const privateToken = String(value || '').trim()
        if (!continuousSessionActive || selectedItemIds.length === 0) {
          throw new Error('Select assigned items and start scanning before scanning a participant.')
        }
        setContinuousResult([])
        const resolvedTicket = await validateAttendeeTicket({ eventId, token: privateToken })
        const rows = await recordContinuousAttendeeDistribution({
          eventId,
          token: privateToken,
          itemIds: selectedItemIds,
        })
        setToken('')
        const firstItem = rows.find((row) => row.attendee_name)
        const invalid = rows.every((row) => row.item_status === 'invalid_ticket')
        setResult({
          result_code: invalid ? 'INVALID_TICKET' : rows.some((row) => row.item_status === 'distributed') ? 'DISTRIBUTION_COMPLETE' : 'ALREADY_RECEIVED',
          result_message: invalid
            ? 'This ticket is invalid, revoked, cancelled, or not eligible.'
            : 'Selected item statuses were confirmed by the database.',
          event_title: firstItem?.event_title || events.find((event) => String(event.event_id) === eventId)?.event_title,
          participant_name: firstItem?.attendee_name || 'Unknown attendee',
          participant_type: firstItem?.attendee_type,
          relationship: firstItem?.relationship,
          main_participant_name: firstItem?.main_participant_name,
          ticket_reference: resolvedTicket?.ticket_reference,
        })
        setContinuousResult(rows)
        setDistributionError('')
        return
      }

      try {
        const attendeeResult = await checkInAttendeeTicket({ eventId, token: value })
        setResult(attendeeResult ? {
          result_code: attendeeResult.result_code,
          result_message: attendeeResult.result_message,
          event_title: attendeeResult.event_title,
          participant_name: attendeeResult.attendee_name,
          participant_type: attendeeResult.attendee_type,
          relationship: attendeeResult.relationship,
          main_participant_name: attendeeResult.main_participant_name,
          ticket_reference: attendeeResult.ticket_reference,
          checked_in_at: attendeeResult.checked_in_at,
        } : await checkInEventTicket({ eventId, token: value }))
      } catch {
        setResult(await checkInEventTicket({ eventId, token: value }))
      }
      setToken('')
    } catch (validationError) {
      setError(validationError.message || 'The ticket could not be validated.')
    } finally {
      setChecking(false)
    }
  }, [eventId, events, isDistributionMode, continuousSessionActive, selectedItemIds])

  useEffect(() => {
    let active = true
    getTicketScannerEvents()
      .then((items) => {
        if (!active) return
        setEvents(items)
        if (items.length) {
          const requestedEventId = new URLSearchParams(window.location.search).get('event_id')
          const requestedEvent = items.find((item) => String(item.event_id) === requestedEventId)
          setEventId(String(requestedEvent?.event_id || items[0].event_id))
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Authorized event assignments could not be loaded.')
      })
      .finally(() => {
        if (active) setLoadingEvents(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isDistributionMode || !eventId) {
      return undefined
    }
    let active = true
    getMyDistributionItems()
      .then((items) => {
        if (!active) return
        setAssignedItems(items.filter((item) => String(item.event_id) === String(eventId)))
      })
      .catch((loadError) => {
        if (active) setDistributionError(loadError.message || 'Assigned items could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [eventId, isDistributionMode])

  useEffect(() => {
    if (!cameraActive || !videoRef.current || !eventId) return undefined
    let active = true
    const reader = new BrowserQRCodeReader()
    reader.decodeFromVideoDevice(undefined, videoRef.current, (decoded) => {
      if (!decoded || scanInFlight.current) return
      scanInFlight.current = true
      setCameraActive(false)
      setCameraLoading(false)
      setToken(decoded.getText())
      void validateTicket(decoded.getText()).finally(() => {
        scanInFlight.current = false
      })
    }).then((controls) => {
      scannerControls.current = controls
      if (active) setCameraLoading(false)
      else controls.stop()
    }).catch((cameraFailure) => {
      if (active) {
        setCameraError(cameraFailure.message || 'Camera access is unavailable. Use manual token entry instead.')
        setCameraActive(false)
        setCameraLoading(false)
      }
    })
    return () => {
      active = false
      scannerControls.current?.stop()
      scannerControls.current = null
    }
  }, [cameraActive, eventId, validateTicket])

  const handleManualSubmit = (event) => {
    event.preventDefault()
    if (!token.trim()) {
      setError('Enter the ticket token or scan its QR code.')
      return
    }
    void validateTicket(token)
  }

  const startCamera = () => {
    setResult(null)
    setDistributionSuccess('')
    setDistributionError('')
    setError('')
    setCameraError('')
    setCameraLoading(true)
    setCameraActive(true)
  }

  const stopCamera = () => {
    scannerControls.current?.stop()
    setCameraActive(false)
    setCameraLoading(false)
  }

  const toggleSelectedItem = (itemId) => {
    if (continuousSessionActive) return
    setSelectedItemIds((current) => (
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    ))
  }

  const startContinuousSession = () => {
    if (!selectedItemIds.length) {
      setDistributionError('Select at least one assigned item before starting scanning.')
      return
    }
    setContinuousSessionActive(true)
    setContinuousResult([])
    setDistributionError('')
    setDistributionSuccess('Scanning session started.')
  }

  const endContinuousSession = () => {
    setContinuousSessionActive(false)
    setSelectedItemIds([])
    setContinuousResult([])
    setResult(null)
    setDistributionSuccess('')
    stopCamera()
  }

  const changeSelectedItems = () => {
    setContinuousSessionActive(false)
    setContinuousResult([])
    setResult(null)
    setDistributionSuccess('')
  }

  const activeEvent = events.find((event) => String(event.event_id) === eventId)
  const statusClass = result?.result_code?.toLowerCase().replace('_', '-') || ''
  return (
    <section className="container ticket-scanner-page">
      <div className="ticket-scanner-heading">
        <div>
          <a className="back-link" href={isSuperAdmin ? '/admin/tickets' : '/volunteer'}>← {isSuperAdmin ? 'Ticket management' : 'Volunteer workspace'}</a>
          <span className="eyebrow">{isDistributionMode ? 'ITEM DISTRIBUTION' : 'EVENT ENTRY'}</span>
          <h1>{isDistributionMode ? 'Item distribution' : 'Ticket scanner'}</h1>
          <p>{isDistributionMode
            ? 'Scan an eligible ticket to review only the items assigned to you. Distribution does not check the participant in.'
            : 'Scan a ticket to run the existing Phase 5 validation and check-in. Item distribution is handled separately.'}</p>
        </div>
        {isSuperAdmin && <a className="button button-outline" href="/admin">Admin overview</a>}
      </div>

      {error && <div className="form-feedback" role="alert">{error}</div>}
      <div className="ticket-scanner-layout">
        <section className="ticket-scanner-panel">
          <label className="form-field">
            <span>Event</span>
            <select value={eventId} onChange={(event) => { setEventId(event.target.value); setResult(null); setError(''); setDistributionError(''); setContinuousSessionActive(false); setSelectedItemIds([]); setContinuousResult([]) }} disabled={loadingEvents || !events.length || checking}>
              {loadingEvents && <option value="">Loading authorized events…</option>}
              {!loadingEvents && !events.length && <option value="">No assigned events available</option>}
              {events.map((event) => <option value={event.event_id} key={event.event_id}>{event.event_title}</option>)}
            </select>
          </label>
          {activeEvent && <div className="ticket-scanner-event">
            <strong>{activeEvent.event_title}</strong>
            <span>{formatEventDateTime(activeEvent.event_start)}</span>
            <span>{activeEvent.venue || activeEvent.event_status}</span>
          </div>}

          {isDistributionMode && (
            <section className="continuous-item-selection" aria-label="Distribution item selection">
              <div className="continuous-section-heading">
                <div>
                  <span className="eyebrow">ASSIGNED ITEMS</span>
                  <strong>{selectedItemIds.length} selected</strong>
                </div>
                {continuousSessionActive && <span className="continuous-session-active">Session active</span>}
              </div>
              {distributionError && <p className="form-feedback" role="alert">{distributionError}</p>}
              {distributionSuccess && <p className="inline-notice" role="status">{distributionSuccess}</p>}
              <div className="continuous-item-grid">
                {assignedItems.map((item) => {
                  const selected = selectedItemIds.includes(item.item_id)
                  return (
                    <button
                      type="button"
                      className={`continuous-item-card${selected ? ' is-selected' : ''}`}
                      key={item.item_id}
                      onClick={() => toggleSelectedItem(item.item_id)}
                      disabled={continuousSessionActive || !item.is_active}
                      aria-pressed={selected}
                    >
                      <strong>{item.item_name}</strong>
                      <span>{item.inventory_remaining} remaining</span>
                      {!item.is_active && <small>Inactive</small>}
                    </button>
                  )
                })}
              </div>
              {!assignedItems.length && <p className="admin-muted">No active item assignments are available for this event.</p>}
              <div className="continuous-session-actions">
                {!continuousSessionActive
                  ? <button className="button button-primary" type="button" disabled={!selectedItemIds.length} onClick={startContinuousSession}>Start Scanning</button>
                  : <>
                    <button className="button button-outline" type="button" onClick={changeSelectedItems}>Change Items</button>
                    <button className="button button-danger" type="button" onClick={endContinuousSession}>End Session</button>
                  </>}
              </div>
            </section>
          )}

          <div className="ticket-camera-panel">
            {cameraActive
              ? <video ref={videoRef} className="ticket-camera-video" muted playsInline aria-label="Camera QR scanner" />
              : <div className="ticket-camera-placeholder"><span aria-hidden="true">QR</span><strong>Camera scanner</strong><small>Allow camera access to scan a ticket QR code.</small></div>}
            <button className="button button-primary" type="button" onClick={cameraActive ? stopCamera : startCamera} disabled={!eventId || checking || (isDistributionMode && !continuousSessionActive)}>
              {cameraActive ? cameraLoading ? 'Requesting camera…' : 'Stop camera' : 'Start camera scanner'}
            </button>
            {cameraError && <p className="field-error" role="alert">{cameraError}</p>}
            <small>{cameraActive && cameraLoading ? 'Waiting for camera permission…' : 'Camera scanning requires HTTPS or localhost and device permission.'}</small>
          </div>

          <form className="ticket-manual-form" onSubmit={handleManualSubmit}>
            <label className="form-field">
              <span>Manual ticket token</span>
              <input value={token} onChange={(event) => setToken(event.target.value)} maxLength={128} autoComplete="off" spellCheck="false" placeholder="Enter the token from the ticket QR" />
            </label>
            <button className="button button-outline" type="submit" disabled={!eventId || checking || (isDistributionMode && !continuousSessionActive)}>
              {checking ? 'Checking ticket…' : 'Validate ticket'}
            </button>
          </form>
        </section>

        <aside className={`ticket-validation-result${result ? ` is-${statusClass}` : ''}`} aria-live="polite">
          {!result
          ? <><span className="eyebrow">VALIDATION RESULT</span><h2>Ready to scan</h2><p>{isDistributionMode ? 'Select the assigned event before checking distribution eligibility.' : 'Select the correct event before checking in a participant.'}</p></>
            : <>
              <span className="ticket-result-code">{result.result_code.replace('_', ' ')}</span>
            <h2>{result.result_code === 'VALID'
              ? 'Entry accepted'
              : result.result_code === 'ALREADY_USED'
                ? 'Already checked in'
                : result.result_code === 'DISTRIBUTION_READY'
                  ? 'Eligible for distribution'
                  : result.result_code === 'NO_ITEMS'
                    ? 'No items assigned'
                    : result.result_code === 'NOT_ELIGIBLE'
                      ? 'Not eligible'
                      : 'Invalid ticket'}</h2>
              <p>{result.result_message}</p>
              {result.event_title && <dl className="ticket-result-details">
                <div><dt>Event</dt><dd>{result.event_title}</dd></div>
                <div><dt>Participant</dt><dd>{result.participant_name}</dd></div>
                <div><dt>Participant type</dt><dd className="capitalize">{result.participant_type}</dd></div>
                {result.relationship && <div><dt>Guest relationship</dt><dd className="capitalize">{result.relationship}</dd></div>}
                {result.main_participant_name && <div><dt>Main participant</dt><dd>{result.main_participant_name}</dd></div>}
                {result.ticket_reference && <div><dt>Ticket reference</dt><dd>{result.ticket_reference}</dd></div>}
                {result.checked_in_at && <div><dt>Checked in</dt><dd>{formatEventDateTime(result.checked_in_at)}</dd></div>}
                {result.checked_in_by_name && <div><dt>Checked in by</dt><dd>{result.checked_in_by_name}</dd></div>}
              </dl>}
            </>}
        </aside>
      </div>
      {isDistributionMode && continuousResult.length > 0 && (
        <section className="distribution-result-panel" aria-live="polite">
          <div className="distribution-section-heading">
            <div>
              <span className="eyebrow">LAST PARTICIPANT</span>
              <h2>{result?.participant_name || 'Distribution result'}</h2>
            </div>
            {continuousSessionActive && <button className="button button-outline button-small" type="button" onClick={startCamera} disabled={cameraActive || checking}>Next Participant</button>}
          </div>
          <div className="continuous-result-grid">
            {continuousResult.map((row, index) => (
              <article className={`continuous-result-card is-${row.item_status}`} key={`${row.item_id || 'invalid'}-${index}`}>
                <strong>{row.item_name || 'Ticket validation'}</strong>
                <span>
                  {row.item_status === 'distributed'
                    ? 'Successfully Distributed'
                    : row.item_status === 'already_received'
                      ? 'Already Received'
                      : row.item_status === 'invalid_ticket'
                        ? 'Invalid or ineligible ticket'
                        : row.item_status === 'unauthorized'
                          ? 'Not assigned to you'
                          : row.item_status === 'not_eligible'
                            ? 'Not Eligible'
                          : row.item_status === 'inventory_error'
                            ? 'Inventory error — not distributed'
                            : 'Not distributed'}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
      {!loadingEvents && events.length === 0 && <div className="empty-state"><h2>No events assigned</h2><p>Ticket scanning is limited to event assignments. Ask a Super Admin to assign you to an event.</p></div>}
    </section>
  )
}

export default TicketScanner
