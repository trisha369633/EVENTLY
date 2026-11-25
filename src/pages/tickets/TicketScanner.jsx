import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { useAuth } from '../../context/useAuth.js'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import {
  getAdminDistributionItems,
  getMyDistributionItems,
  recordContinuousAttendeeDistribution,
} from '../../services/distributionService.js'
import { getAdminEvents } from '../../services/eventService.js'
import {
  checkInEventTicket,
  getTicketScannerEvents,
  validateAttendeeTicket,
} from '../../services/ticketService.js'

function TicketScanner({
  workflow = 'distribution',
  volunteerWorkspace = false,
  distributionView = 'items',
  onDistributionViewChange,
}) {
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
  const [loadingItems, setLoadingItems] = useState(workflow === 'distribution')
  const [selectedItemIds, setSelectedItemIds] = useState([])
  const [continuousResult, setContinuousResult] = useState([])
  const [continuousSessionActive, setContinuousSessionActive] = useState(false)
  const [scanMode, setScanMode] = useState(workflow)
  const isSuperAdmin = roles.includes('super_admin')
  const isDistributionMode = scanMode === 'distribution'
  const isVolunteerDistribution = isDistributionMode && !isSuperAdmin
  const hasDistributionViews = isDistributionMode && volunteerWorkspace && !isSuperAdmin

  useEffect(() => {
    if (hasDistributionViews && continuousSessionActive) {
      onDistributionViewChange?.('scan')
    }
  }, [continuousSessionActive, hasDistributionViews, onDistributionViewChange])

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
      const privateToken = String(value || '').trim()
      if (isDistributionMode && (!continuousSessionActive || selectedItemIds.length === 0)) {
        throw new Error(`Select ${isSuperAdmin ? 'active' : 'assigned'} items and start scanning before scanning a participant.`)
      }
      setContinuousResult([])
      if (!isDistributionMode) {
        const checkInResult = await checkInEventTicket({ eventId, token: privateToken })
        setResult({
          ...checkInResult,
          event_title: checkInResult.event_title || events.find((event) => String(event.event_id) === eventId)?.event_title,
          participant_name: checkInResult.participant_name || checkInResult.attendee_name || 'Unknown attendee',
          result_message: checkInResult.result_message || 'The ticket check-in result was received.',
        })
        setToken('')
        return
      }
      const resolvedTicket = await validateAttendeeTicket({ eventId, token: privateToken })
      const selectedItems = assignedItems.filter((item) => (
        selectedItemIds.some((itemId) => String(itemId) === String(item.item_id))
      ))
      const isGuest = String(resolvedTicket?.attendee_type || '').toLowerCase() === 'guest'
      const notApplicableItems = isGuest
        ? selectedItems.filter((item) => resolvedTicket?.guest_eligible === false || item.guest_eligible === false)
        : []
      const notApplicableItemIds = new Set(notApplicableItems.map((item) => String(item.item_id)))
      const applicableItemIds = selectedItemIds.filter((itemId) => !notApplicableItemIds.has(String(itemId)))
      const distributionRows = applicableItemIds.length
        ? await recordContinuousAttendeeDistribution({
            eventId,
            token: privateToken,
            itemIds: applicableItemIds,
          })
        : []
      const notApplicableRows = notApplicableItems.map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name,
        item_status: 'not_applicable',
        event_title: resolvedTicket?.event_title,
        attendee_name: resolvedTicket?.attendee_name || resolvedTicket?.participant_name,
        attendee_type: resolvedTicket?.attendee_type,
        relationship: resolvedTicket?.relationship,
        main_participant_name: resolvedTicket?.main_participant_name,
      }))
      const rowsByItemId = new Map(distributionRows.map((row) => [String(row.item_id), row]))
      const notApplicableByItemId = new Map(notApplicableRows.map((row) => [String(row.item_id), row]))
      const rows = selectedItemIds
        .map((itemId) => notApplicableByItemId.get(String(itemId)) || rowsByItemId.get(String(itemId)))
        .filter(Boolean)
        .concat(distributionRows.filter((row) => !selectedItemIds.some((itemId) => String(itemId) === String(row.item_id))))
      setToken('')
      const firstItem = rows.find((row) => row.attendee_name)
      const invalid = rows.some((row) => row.item_status === 'invalid_ticket')
      const allNotApplicable = rows.length > 0 && rows.every((row) => row.item_status === 'not_applicable')
      const resultCode = invalid
        ? 'INVALID_TICKET'
        : rows.some((row) => row.item_status === 'distributed')
          ? 'DISTRIBUTION_COMPLETE'
          : rows.some((row) => row.item_status === 'already_received')
            ? 'ALREADY_RECEIVED'
            : allNotApplicable
              ? 'NOT_APPLICABLE'
              : 'NOT_ELIGIBLE'
      setResult({
        result_code: resultCode,
        result_message: invalid
          ? 'This ticket is invalid, revoked, cancelled, or not eligible.'
          : allNotApplicable
            ? 'Selected items are not applicable for this guest.'
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
    } catch (validationError) {
      setError(validationError.message || 'The ticket could not be validated.')
    } finally {
      setChecking(false)
    }
  }, [eventId, events, assignedItems, continuousSessionActive, selectedItemIds, isDistributionMode, isSuperAdmin])

  useEffect(() => {
    let active = true
    const eventRequest = isSuperAdmin
      ? getAdminEvents().then((items) => items.map((item) => ({
          event_id: item.id,
          event_title: item.title,
          event_start: item.event_start,
          venue: item.venue,
          event_status: item.status,
        })))
      : getTicketScannerEvents()
    eventRequest
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
        if (active) {
          setError(loadError.message || (isSuperAdmin ? 'Events could not be loaded.' : 'Authorized event assignments could not be loaded.'))
        }
      })
      .finally(() => {
        if (active) setLoadingEvents(false)
      })
    return () => {
      active = false
    }
  }, [isSuperAdmin])

  useEffect(() => {
    if (!isDistributionMode || !eventId) return undefined
    let active = true
    const itemsRequest = isSuperAdmin
      ? getAdminDistributionItems(eventId)
      : getMyDistributionItems()
    itemsRequest
      .then((items) => {
        if (!active) return
        setAssignedItems(items.filter((item) => (
          String(item.event_id) === String(eventId) && (!isSuperAdmin || item.is_active)
        )))
      })
      .catch((loadError) => {
        if (active) setDistributionError(loadError.message || `${isSuperAdmin ? 'Active' : 'Assigned'} items could not be loaded.`)
      })
      .finally(() => {
        if (active) setLoadingItems(false)
      })
    return () => {
      active = false
    }
  }, [eventId, isDistributionMode, isSuperAdmin])

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
      setDistributionError(`Select at least one ${isSuperAdmin ? 'active item' : 'assigned item'} before starting scanning.`)
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

  const changeScanMode = (mode) => {
    if (checking) return
    stopCamera()
    setScanMode(mode)
    setToken('')
    setAssignedItems([])
    setLoadingItems(mode === 'distribution')
    setContinuousSessionActive(false)
    setSelectedItemIds([])
    setContinuousResult([])
    setResult(null)
    setError('')
    setDistributionError('')
    setDistributionSuccess('')
  }

  const activeEvent = events.find((event) => String(event.event_id) === eventId)
  const statusClass = result?.result_code?.toLowerCase().replace('_', '-') || ''
  const continuousResultCards = continuousResult.map((row, index) => (
    <article className={`continuous-result-card is-${row.item_status}`} key={`${row.item_id || 'invalid'}-${index}`}>
      <strong>{row.item_name || 'Ticket validation'}</strong>
      <span>
        {row.item_status === 'distributed'
          ? 'Successfully Distributed'
          : row.item_status === 'already_received'
            ? 'Already Received'
            : row.item_status === 'not_applicable'
              ? 'Not applicable for this guest'
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
  ))
  const distributionResults = isDistributionMode && continuousResult.length > 0
    ? isVolunteerDistribution
      ? <details className={`distribution-result-panel volunteer-recent-distributions is-${statusClass}`} aria-live="polite">
          <summary>
            <span>
              <small>LAST PARTICIPANT</small>
              <strong>{result?.participant_name || 'Distribution result'}</strong>
            </span>
            <span className="volunteer-recent-result">
              {result?.result_code?.replace('_', ' ') || 'View item results'} · {continuousResult.length} item{continuousResult.length === 1 ? '' : 's'}
            </span>
          </summary>
          <div className="continuous-result-grid">{continuousResultCards}</div>
        </details>
      : <section className="distribution-result-panel" aria-live="polite">
          <div className="distribution-section-heading">
            <div>
              <span className="eyebrow">LAST PARTICIPANT</span>
              <h2>{result?.participant_name || 'Distribution result'}</h2>
            </div>
            {continuousSessionActive && <button className="button button-outline button-small" type="button" onClick={startCamera} disabled={cameraActive || checking}>Next Participant</button>}
          </div>
          <div className="continuous-result-grid">{continuousResultCards}</div>
        </section>
    : null
  const cameraScannerPanel = (
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
  )
  const manualTokenForm = (
    <form className="ticket-manual-form" onSubmit={handleManualSubmit}>
      <label className="form-field">
        <span>Manual ticket token</span>
        <input value={token} onChange={(event) => setToken(event.target.value)} maxLength={128} autoComplete="off" spellCheck="false" placeholder="Enter the token from the ticket QR" />
      </label>
      <button className="button button-outline" type="submit" disabled={!eventId || checking || (isDistributionMode && !continuousSessionActive)}>
        {checking ? 'Checking ticket…' : isDistributionMode ? 'Validate ticket' : 'Check in ticket'}
      </button>
    </form>
  )
  const validationResultPanel = (result || !isVolunteerDistribution) && (
    <aside className={`ticket-validation-result${result ? ` is-${statusClass}` : ''}`} aria-live="polite">
      {!result
        ? <><span className="eyebrow">VALIDATION RESULT</span><h2>Ready to scan</h2><p>{isDistributionMode
          ? `Select an event and ${isSuperAdmin ? 'active items' : 'assigned items'} before scanning a participant ticket.`
          : 'Select an event, then scan or enter a ticket to check the participant in.'}</p></>
        : <>
            <span className="ticket-result-code">{result.result_code.replace('_', ' ')}</span>
            <h2>{isDistributionMode
              ? result.result_code === 'DISTRIBUTION_COMPLETE'
                ? 'Distribution complete'
                : result.result_code === 'ALREADY_RECEIVED'
                  ? 'Already received'
                  : result.result_code === 'NOT_APPLICABLE'
                    ? 'Not applicable'
                    : result.result_code === 'NOT_ELIGIBLE'
                      ? 'Not eligible'
                      : 'Invalid ticket'
              : String(result.result_code || '').toLowerCase().includes('already')
                ? 'Already checked in'
                  : ['valid', 'checked_in', 'check_in_success'].some((code) => String(result.result_code || '').toLowerCase().includes(code))
                  ? 'Ticket checked in'
                  : 'Ticket not checked in'}</h2>
            <p>{result.result_message}</p>
            {result.event_title && <dl className="ticket-result-details">
              <div><dt>Event</dt><dd>{result.event_title}</dd></div>
              <div><dt>Participant</dt><dd>{result.participant_name}</dd></div>
              <div><dt>Participant type</dt><dd className="capitalize">{result.participant_type}</dd></div>
              {result.relationship && <div><dt>Guest relationship</dt><dd className="capitalize">{result.relationship}</dd></div>}
              {result.main_participant_name && <div><dt>Main participant</dt><dd>{result.main_participant_name}</dd></div>}
              {result.ticket_reference && <div><dt>Ticket reference</dt><dd>{result.ticket_reference}</dd></div>}
            </dl>}
          </>}
    </aside>
  )
  return (
    <section className={`container ticket-scanner-page${isVolunteerDistribution ? ' volunteer-distribution-scanner' : ''}`}>
      {isVolunteerDistribution
        ? <div className="volunteer-distribution-nav"><a className="back-link" href="/volunteer">← Volunteer workspace</a></div>
        : <div className="ticket-scanner-heading">
            <div>
              <a className="back-link" href={isSuperAdmin ? '/admin/tickets' : '/volunteer'}>← {isSuperAdmin ? 'Ticket management' : 'Volunteer workspace'}</a>
              <span className="eyebrow">{isDistributionMode ? 'ITEM DISTRIBUTION' : 'EVENT ENTRY'}</span>
              <h1>{isDistributionMode ? 'Item distribution' : 'Ticket scanner'}</h1>
              <p>{isSuperAdmin
                ? isDistributionMode
                  ? 'Select any active items for the event to distribute. Super Admins do not need volunteer assignments.'
                  : 'Scan or enter a ticket to check a participant in directly for the selected event.'
                : 'Scan an eligible ticket to distribute only the items assigned to you. Distribution does not check the participant in.'}</p>
            </div>
            {isSuperAdmin && <a className="button button-outline" href="/admin">Admin overview</a>}
          </div>}

      {isSuperAdmin && (
        <div className="admin-filter-tabs ticket-scanner-mode-tabs" role="group" aria-label="Scanner task">
          <button type="button" className={isDistributionMode ? 'active' : ''} onClick={() => changeScanMode('distribution')} disabled={checking}>Item distribution</button>
          <button type="button" className={!isDistributionMode ? 'active' : ''} onClick={() => changeScanMode('checkin')} disabled={checking}>Ticket check-in</button>
        </div>
      )}

      {error && <div className="form-feedback" role="alert">{error}</div>}
      <div className={`ticket-scanner-layout${isVolunteerDistribution ? ` volunteer-distribution-workspace${hasDistributionViews ? ` is-view-${distributionView}` : ''}` : ''}`}>
        <section
          className="ticket-scanner-panel"
          id={hasDistributionViews ? 'volunteer-distribution-select-panel' : undefined}
          role={hasDistributionViews ? 'tabpanel' : undefined}
          aria-labelledby={hasDistributionViews ? 'volunteer-distribution-select-tab' : undefined}
        >
          <label className="form-field">
            <span>Event</span>
            <select value={eventId} onChange={(event) => { setEventId(event.target.value); setToken(''); setResult(null); setError(''); setDistributionError(''); setContinuousSessionActive(false); setSelectedItemIds([]); setContinuousResult([]); setAssignedItems([]); setLoadingItems(isDistributionMode); stopCamera() }} disabled={loadingEvents || !events.length || checking}>
              {loadingEvents && <option value="">Loading {isSuperAdmin ? 'events' : 'authorized events'}…</option>}
              {!loadingEvents && !events.length && <option value="">{isSuperAdmin ? 'No events available' : 'No assigned events available'}</option>}
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
                  <span className="eyebrow">{isSuperAdmin ? 'ACTIVE ITEMS' : 'ASSIGNED ITEMS'}</span>
                  <strong>{selectedItemIds.length} selected</strong>
                </div>
                {continuousSessionActive && <span className="continuous-session-active">Session active</span>}
              </div>
              {distributionError && <p className="form-feedback" role="alert">{distributionError}</p>}
              {distributionSuccess && <p className="inline-notice" role="status">{distributionSuccess}</p>}
              {loadingItems && eventId && <p className="admin-muted" role="status">Loading {isSuperAdmin ? 'active' : 'assigned'} items…</p>}
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
              {!loadingItems && eventId && !assignedItems.length && <p className="admin-muted">{isSuperAdmin ? 'No active distribution items are available for this event.' : 'No active item assignments are available for this event.'}</p>}
              <div className="continuous-session-actions">
                {!continuousSessionActive
                  ? <button className="button button-primary" type="button" disabled={!selectedItemIds.length} onClick={startContinuousSession}>{isVolunteerDistribution ? 'Start Distribution Session' : 'Start Scanning'}</button>
                  : <>
                    <button className="button button-outline" type="button" onClick={changeSelectedItems}>Change Items</button>
                    <button className="button button-danger" type="button" onClick={endContinuousSession}>End Session</button>
                  </>}
              </div>
            </section>
          )}

          {!isVolunteerDistribution && <>{cameraScannerPanel}{manualTokenForm}</>}
        </section>

        {isVolunteerDistribution && <section
          className="volunteer-distribution-scan-column"
          id={hasDistributionViews ? 'volunteer-distribution-scan-panel' : undefined}
          role={hasDistributionViews ? 'tabpanel' : undefined}
          aria-labelledby={hasDistributionViews ? 'volunteer-distribution-scan-tab' : undefined}
        >
          {cameraScannerPanel}
          {manualTokenForm}
          {validationResultPanel}
          {distributionResults}
        </section>}

        {!isVolunteerDistribution && validationResultPanel}
      </div>
      {!isVolunteerDistribution && distributionResults}
      {!loadingEvents && events.length === 0 && <div className="empty-state">
        <h2>{isSuperAdmin ? 'No events available' : 'No events assigned'}</h2>
        <p>{isSuperAdmin ? 'There are no events available to scan.' : 'Ticket scanning is limited to event assignments. Ask a Super Admin to assign you to an event.'}</p>
      </div>}
    </section>
  )
}

export default TicketScanner
