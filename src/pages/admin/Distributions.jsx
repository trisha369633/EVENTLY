import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import { useDistributionRealtime } from '../../hooks/useDistributionRealtime.js'
import { getAdminEvents } from '../../services/eventService.js'
import {
  correctEventDistribution,
  getAdminContinuousDistributionSummary,
  getAdminDistributionHistory,
  getAdminDistributionItems,
  getAdminDistributionSummary,
  getAdminDistributionVolunteerActivity,
  getDistributionItemVolunteers,
  saveDistributionItem,
  setDistributionItemGuestEligibility,
  setDistributionItemVolunteer,
} from '../../services/distributionService.js'
import {
  getEventTicketAssignments,
  getTicketVolunteerCandidates,
} from '../../services/ticketService.js'

const distributionTabStorageKey = 'evently:/admin/distributions:active-tab'
const distributionTabValues = ['item-setup', 'live-inventory', 'item-wise-volunteer', 'auditable-history', 'staff-activity']

function getStoredDistributionTab() {
  try {
    const storedTab = window.sessionStorage.getItem(distributionTabStorageKey)
    if (!distributionTabValues.includes(storedTab)) return 'item-setup'
    return storedTab === 'item-wise-volunteer' ? 'item-catalog' : storedTab
  } catch (error) {
    console.error('The active distribution tab could not be restored.', error)
    return 'item-setup'
  }
}

const emptyForm = {
  id: '',
  eventId: '',
  itemName: '',
  description: '',
  totalQuantity: '0',
  maxPerParticipant: '1',
  startsAt: '',
  endsAt: '',
  location: '',
  isActive: true,
  guestEligible: true,
}

function toLocalDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function toIsoDateTime(value) {
  return value ? new Date(value).toISOString() : null
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString()
}

function getItemAvailability(item) {
  const now = Date.now()
  const windowOpen = (!item.distribution_starts_at || Date.parse(item.distribution_starts_at) <= now)
    && (!item.distribution_ends_at || Date.parse(item.distribution_ends_at) > now)
  if (!item.is_active) return 'inactive'
  if (Number(item.remaining_inventory) <= 0 || !windowOpen) return 'unavailable'
  return 'active'
}

function Distributions() {
  const [activeTab, setActiveTab] = useState(getStoredDistributionTab)
  const [events, setEvents] = useState([])
  const [volunteerCandidates, setVolunteerCandidates] = useState([])
  const [eventFilter, setEventFilter] = useState('')
  const [itemFilter, setItemFilter] = useState('')
  const [volunteerFilter, setVolunteerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [itemAvailabilityFilter, setItemAvailabilityFilter] = useState('')
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [continuousSummary, setContinuousSummary] = useState([])
  const [history, setHistory] = useState([])
  const [volunteerActivity, setVolunteerActivity] = useState([])
  const [loadedQueryKey, setLoadedQueryKey] = useState('')
  const [pageError, setPageError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [formBusy, setFormBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [success, setSuccess] = useState('')
  const [retry, setRetry] = useState(0)
  const [assignmentItemId, setAssignmentItemId] = useState('')
  const [assignmentResult, setAssignmentResult] = useState({ itemId: '', assignments: [], eventVolunteers: [], error: '' })
  const [assignmentVolunteerId, setAssignmentVolunteerId] = useState('')
  const [assignmentSearch, setAssignmentSearch] = useState('')
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [assignmentActionError, setAssignmentActionError] = useState('')
  const [correctionTarget, setCorrectionTarget] = useState(null)
  const [correctionQuantity, setCorrectionQuantity] = useState('1')
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionBusy, setCorrectionBusy] = useState(false)

  useEffect(() => {
    const storedTab = activeTab === 'item-catalog' ? 'item-wise-volunteer' : activeTab
    try {
      window.sessionStorage.setItem(distributionTabStorageKey, storedTab)
    } catch (error) {
      console.error('The active distribution tab could not be saved.', error)
    }
  }, [activeTab])

  const refresh = useCallback(() => setRetry((value) => value + 1), [])
  const queryKey = JSON.stringify([eventFilter, itemFilter, volunteerFilter, statusFilter, retry])
  const loading = loadedQueryKey !== queryKey
  useDistributionRealtime({
    eventId: eventFilter,
    onChange: refresh,
    onFallback: refresh,
  })

  useEffect(() => {
    let active = true
    Promise.all([getAdminEvents(), getTicketVolunteerCandidates()])
      .then(([nextEvents, nextVolunteers]) => {
        if (!active) return
        setEvents(nextEvents)
        setVolunteerCandidates(nextVolunteers)
        if (nextEvents.length) {
          setForm((current) => current.eventId ? current : { ...current, eventId: String(nextEvents[0].id) })
        }
      })
      .catch((loadError) => {
        if (active) setPageError(loadError.message || 'Events and volunteers could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      getAdminDistributionSummary(eventFilter),
      getAdminDistributionItems(eventFilter),
      getAdminDistributionHistory({
        eventId: eventFilter,
        itemId: itemFilter,
        volunteerUserId: volunteerFilter,
        status: statusFilter,
        limit: 50,
      }),
      getAdminDistributionVolunteerActivity(eventFilter, itemFilter),
      getAdminContinuousDistributionSummary(eventFilter),
    ])
      .then(([nextSummary, nextItems, nextHistory, nextVolunteerActivity, nextContinuousSummary]) => {
        if (!active) return
        setSummary(nextSummary)
        setItems(nextItems)
        setHistory(nextHistory)
        setVolunteerActivity(nextVolunteerActivity)
        setContinuousSummary(nextContinuousSummary)
        setPageError('')
      })
      .catch((loadError) => {
        if (active) setPageError(loadError.message || 'Distribution data could not be loaded.')
      })
      .finally(() => {
        if (active) setLoadedQueryKey(queryKey)
      })
    return () => {
      active = false
    }
  }, [eventFilter, itemFilter, volunteerFilter, statusFilter, retry, queryKey])

  const selectedAssignmentItem = useMemo(
    () => items.find((item) => String(item.item_id) === assignmentItemId),
    [items, assignmentItemId],
  )
  const assignments = assignmentResult.itemId === assignmentItemId ? assignmentResult.assignments : []
  const eventVolunteers = assignmentResult.itemId === assignmentItemId ? assignmentResult.eventVolunteers : []
  const assignmentError = assignmentResult.itemId === assignmentItemId ? assignmentResult.error : ''
  const assignmentLoading = Boolean(selectedAssignmentItem && assignmentResult.itemId !== assignmentItemId)
  const searchTerm = assignmentSearch.trim().toLowerCase()
  const filteredEventVolunteers = !searchTerm
    ? eventVolunteers
    : eventVolunteers.filter((volunteer) => [
      volunteer.volunteer_name,
      volunteer.volunteer_email,
      volunteer.volunteer_phone,
      volunteer.phone_number,
      volunteer.phone,
    ].some((value) => String(value || '').toLowerCase().includes(searchTerm)))
  const selectedVolunteerIsVisible = filteredEventVolunteers.some(
    (volunteer) => volunteer.volunteer_user_id === assignmentVolunteerId,
  )

  useEffect(() => {
    if (!selectedAssignmentItem) return undefined
    let active = true
    Promise.all([
      getDistributionItemVolunteers(selectedAssignmentItem.item_id),
      getEventTicketAssignments(selectedAssignmentItem.event_id),
    ])
      .then(([nextAssignments, nextEventVolunteers]) => {
        if (!active) return
        setAssignmentResult({
          itemId: String(selectedAssignmentItem.item_id),
          assignments: nextAssignments,
          eventVolunteers: nextEventVolunteers.filter((volunteer) => volunteer.is_active),
          error: '',
        })
      })
      .catch((loadError) => {
        if (active) setAssignmentResult({
          itemId: String(selectedAssignmentItem.item_id),
          assignments: [],
          eventVolunteers: [],
          error: loadError.message || 'Item permissions could not be loaded.',
        })
      })
    return () => {
      active = false
    }
  }, [selectedAssignmentItem, retry])

  const eventTitle = (id) => events.find((event) => String(event.id) === String(id))?.title || 'Event'

  const handleSaveItem = async (event) => {
    event.preventDefault()
    setFormBusy(true)
    setActionError('')
    setSuccess('')
    try {
      const savedId = await saveDistributionItem({
        ...form,
        eventId: form.eventId,
        startsAt: toIsoDateTime(form.startsAt),
        endsAt: toIsoDateTime(form.endsAt),
      })
      await setDistributionItemGuestEligibility({
        itemId: savedId,
        guestEligible: form.guestEligible,
      })
      setSuccess(
        form.id
          ? `${form.itemName.trim()} was updated${form.eventId ? ' and can now be used with the selected event' : ''}.`
          : `${form.itemName.trim()} was created.`,
      )
      setForm({ ...emptyForm, eventId: form.eventId })
      setAssignmentItemId(savedId)
      setActiveTab('item-catalog')
      refresh()
    } catch (saveError) {
      setActionError(saveError.message || 'The distribution item could not be saved.')
    } finally {
      setFormBusy(false)
    }
  }

  const editItem = (item) => {
    setForm({
      id: String(item.item_id),
      eventId: String(item.event_id),
      itemName: item.item_name,
      description: item.description || '',
      totalQuantity: String(item.total_quantity),
      maxPerParticipant: String(item.max_per_participant),
      startsAt: toLocalDateTime(item.distribution_starts_at),
      endsAt: toLocalDateTime(item.distribution_ends_at),
      location: item.distribution_location || '',
      isActive: item.is_active,
      guestEligible: item.guest_eligible !== false,
    })
    setActiveTab('item-setup')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleItem = async (item) => {
    setActionError('')
    setSuccess('')
    try {
      await saveDistributionItem({
        id: item.item_id,
        eventId: item.event_id,
        itemName: item.item_name,
        description: item.description,
        totalQuantity: item.total_quantity,
        maxPerParticipant: item.max_per_participant,
        startsAt: item.distribution_starts_at,
        endsAt: item.distribution_ends_at,
        location: item.distribution_location,
        isActive: !item.is_active,
      })
      setSuccess(`${item.item_name} is now ${item.is_active ? 'inactive' : 'active'}.`)
      refresh()
    } catch (toggleError) {
      setActionError(toggleError.message || 'The item status could not be changed.')
    }
  }

  const handleSetAssignment = async (volunteerUserId, active) => {
    if (!selectedAssignmentItem || !volunteerUserId) return
    setAssignmentBusy(true)
    setAssignmentActionError('')
    setSuccess('')
    try {
      await setDistributionItemVolunteer({
        itemId: selectedAssignmentItem.item_id,
        volunteerUserId,
        active,
      })
      setSuccess(active ? 'Volunteer can now distribute this item.' : 'Item distribution access was removed.')
      refresh()
    } catch (assignmentFailure) {
      setAssignmentActionError(assignmentFailure.message || 'Item access could not be updated.')
    } finally {
      setAssignmentBusy(false)
    }
  }

  const handleCorrection = async (event) => {
    event.preventDefault()
    if (!correctionTarget) return
    setCorrectionBusy(true)
    setActionError('')
    try {
      await correctEventDistribution({
        recordId: correctionTarget.activity_id,
        quantity: correctionQuantity,
        reason: correctionReason.trim(),
      })
      setSuccess('The correction was recorded in the audit history.')
      setCorrectionTarget(null)
      setCorrectionQuantity('1')
      setCorrectionReason('')
      refresh()
    } catch (correctionFailure) {
      setActionError(correctionFailure.message || 'The distribution could not be corrected.')
    } finally {
      setCorrectionBusy(false)
    }
  }

  const completion = Number(summary?.completion_percentage || 0)
  const visibleItems = useMemo(
    () => items.filter((item) => !itemAvailabilityFilter || getItemAvailability(item) === itemAvailabilityFilter),
    [items, itemAvailabilityFilter],
  )

  return (
    <section className="admin-page distribution-admin-page">
      <nav className="distribution-tabs" role="tablist" aria-label="Distribution sections">
        {[
          ['item-setup', 'ITEM SETUP'],
          ['live-inventory', 'LIVE INVENTORY'],
          ['item-catalog', 'ITEM WISE VOLUNTEER'],
          ['auditable-history', 'AUDITABLE HISTORY'],
          ['staff-activity', 'STAFF ACTIVITY'],
        ].map(([tab, label]) => (
          <button
            className={activeTab === tab ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`distribution-panel-${tab}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>

      {pageError && <p className="form-feedback" role="alert">{pageError}<button className="inline-button" type="button" onClick={refresh}>Try again</button></p>}
      {actionError && <p className="form-feedback" role="alert">{actionError}</p>}
      {success && <p className="inline-notice" role="status">{success}</p>}

      <section className="distribution-editor-panel" id="distribution-panel-item-setup" role="tabpanel" aria-label="Item setup" hidden={activeTab !== 'item-setup'}>
        <div className="distribution-section-heading"><div><p>Create or edit event inventory, stock levels, limits, and item eligibility.</p></div>{form.id && <button className="inline-button" type="button" onClick={() => setForm({ ...emptyForm, eventId: eventFilter || String(events[0]?.id || '') })}>Cancel edit</button>}</div>
        <form className="distribution-item-form" onSubmit={(event) => void handleSaveItem(event)}>
          <label className="form-field"><span>Event</span><select value={form.eventId} onChange={(event) => setForm((current) => ({ ...current, eventId: event.target.value }))} required><option value="">Select an event</option>{events.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>{form.id && <small>Changing the event moves this item and safely resets event-scoped volunteer assignments.</small>}</label>
          <label className="form-field"><span>Item name</span><input value={form.itemName} onChange={(event) => setForm((current) => ({ ...current, itemName: event.target.value }))} maxLength={120} required placeholder="Enter a custom item name" /></label>
          <label className="form-field distribution-form-wide"><span>Description</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={2000} rows="2" placeholder="Optional details for distribution staff" /></label>
          <label className="form-field"><span>Total inventory</span><input type="number" min="0" step="1" value={form.totalQuantity} onChange={(event) => setForm((current) => ({ ...current, totalQuantity: event.target.value }))} required /></label>
          <label className="form-field"><span>Max per participant</span><input type="number" min="1" step="1" value={form.maxPerParticipant} onChange={(event) => setForm((current) => ({ ...current, maxPerParticipant: event.target.value }))} required /></label>
          <label className="form-field"><span>Distribution starts</span><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label>
          <label className="form-field"><span>Distribution ends</span><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></label>
          <label className="form-field"><span>Location</span><input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} maxLength={240} placeholder="Optional pickup location" /></label>
          <label className="distribution-toggle"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>Item is active for distribution</span></label>
          <label className="distribution-toggle"><input type="checkbox" checked={form.guestEligible} onChange={(event) => setForm((current) => ({ ...current, guestEligible: event.target.checked }))} /><span>Guests are eligible to receive this item</span></label>
          <div className="distribution-form-actions"><button className="button button-primary" type="submit" disabled={formBusy || !events.length}>{formBusy ? 'Saving…' : form.id ? 'Save changes' : 'Create item'}</button></div>
        </form>
      </section>

      <section className="distribution-analytics-section" id="distribution-panel-live-inventory" role="tabpanel" aria-label="Live inventory" hidden={activeTab !== 'live-inventory'}>
        <div className="distribution-section-heading">
          <div><p>Current event inventory, distribution progress, and scan-session totals.</p></div>
          <label className="form-field distribution-event-filter"><span>Event</span><select value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setItemFilter('') }}><option value="">All events</option>{events.map((event) => <option value={event.id} key={event.id}>{event.title}</option>)}</select></label>
        </div>
        {loading && <p className="admin-muted" role="status">Loading distribution analytics…</p>}
        {!loading && summary && (
          <>
            <div className="distribution-stat-grid">
              <article><span>Events with items</span><strong>{formatQuantity(summary.events_with_items)}</strong></article>
              <article><span>Configured items</span><strong>{formatQuantity(summary.total_items)}</strong></article>
              <article><span>Total inventory</span><strong>{formatQuantity(summary.total_inventory)}</strong></article>
              <article><span>Distributed</span><strong>{formatQuantity(summary.total_distributed)}</strong><small>{formatQuantity(summary.remaining_inventory)} remaining</small></article>
              <article><span>Pending participant items</span><strong>{formatQuantity(summary.pending_participant_distributions)}</strong></article>
            </div>
            {continuousSummary.length > 0 && (
              <div className="distribution-stat-grid">
                {continuousSummary.map((row) => (
                  <article key={row.event_id}>
                    <span>Event scan sessions</span>
                    <strong>{formatQuantity(row.scan_sessions)}</strong>
                    <small>{formatQuantity(row.successful_operations)} successful operations · {formatQuantity(row.total_items_distributed)} items distributed</small>
                    <small>{formatQuantity(row.already_received_attempts)} already received · {formatQuantity(row.failed_attempts)} failed attempts</small>
                  </article>
                ))}
              </div>
            )}
            <div className="distribution-completion">
              <div><span>Inventory completion</span><strong>{completion.toFixed(1)}%</strong></div>
              <div className="distribution-progress-track" role="progressbar" aria-valuenow={Math.round(completion)} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${Math.min(100, completion)}%` }} /></div>
            </div>
          </>
        )}
      </section>

      <section className="distribution-items-section" id="distribution-panel-item-catalog" role="tabpanel" aria-label="Item wise volunteer" hidden={activeTab !== 'item-catalog'}>
        <div className="distribution-section-heading">
          <div><p>Review and manage distribution items, inventory, and item-level volunteer access.</p></div>
          <div className="distribution-items-toolbar"><label className="form-field"><span>Distribution status</span><select value={itemAvailabilityFilter} onChange={(event) => setItemAvailabilityFilter(event.target.value)}><option value="">All item statuses</option><option value="active">Available</option><option value="unavailable">Unavailable</option><option value="inactive">Inactive</option></select></label><button className="inline-button" type="button" onClick={refresh}>Refresh</button></div>
        </div>
        {!loading && items.length === 0 && <div className="empty-state"><h2>No distribution items configured</h2><p>Create an item above to start tracking event inventory.</p></div>}
        {!loading && items.length > 0 && !visibleItems.length && <p className="admin-muted">No items match this distribution status.</p>}
        {!loading && visibleItems.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table distribution-items-table">
              <thead><tr><th>Item / event</th><th>Inventory</th><th>Limit</th><th>Window / location</th><th>Volunteers</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{visibleItems.map((item) => (
                <Fragment key={item.item_id}>
                  <tr>
                    <td><strong>{item.item_name}</strong><small>{eventTitle(item.event_id)}</small></td>
                    <td><strong>{formatQuantity(item.quantity_distributed)} / {formatQuantity(item.total_quantity)}</strong><small>{formatQuantity(item.remaining_inventory)} remaining</small></td>
                    <td>{item.max_per_participant} per participant</td>
                    <td>{item.distribution_starts_at ? formatEventDateTime(item.distribution_starts_at) : 'Any time'}<small>{item.distribution_location || 'Location not set'}</small></td>
                    <td>{item.active_volunteer_count}</td>
                    <td><span className={`distribution-state-badge is-${getItemAvailability(item)}`}>{getItemAvailability(item)}</span></td>
                    <td><div className="admin-row-actions"><button className="inline-button" type="button" onClick={() => editItem(item)}>Edit</button><button className="inline-button" type="button" aria-expanded={assignmentItemId === String(item.item_id)} onClick={() => {
                      const nextItemId = assignmentItemId === String(item.item_id) ? '' : String(item.item_id)
                      setAssignmentItemId(nextItemId)
                      setAssignmentVolunteerId('')
                      setAssignmentSearch('')
                      setAssignmentActionError('')
                    }}>Volunteers</button><button className="inline-button" type="button" onClick={() => void toggleItem(item)}>{item.is_active ? 'Deactivate' : 'Activate'}</button></div></td>
                  </tr>
                  {assignmentItemId === String(item.item_id) && (
                    <tr className="distribution-permissions-row">
                      <td colSpan="7">
                        <div className="distribution-inline-assignment">
                          <div className="distribution-inline-assignment-heading">
                            <div><h3>Volunteer access · {selectedAssignmentItem?.item_name}</h3><p>Only active volunteers assigned to {eventTitle(item.event_id)} can receive access to this item.</p></div>
                            <button className="inline-button" type="button" onClick={() => setAssignmentItemId('')}>Close</button>
                          </div>
                          {assignmentError && <p className="form-feedback" role="alert">{assignmentError}</p>}
                          {assignmentActionError && <p className="form-feedback" role="alert">{assignmentActionError}</p>}
                          {assignmentLoading && <p className="admin-muted" role="status">Loading item permissions…</p>}
                          {!assignmentLoading && (
                            <>
                              <form className="distribution-assignment-form" onSubmit={(event) => { event.preventDefault(); void handleSetAssignment(assignmentVolunteerId, true) }}>
                                <label className="form-field"><span>Search volunteer by name, phone, or email</span><input type="search" value={assignmentSearch} onChange={(event) => setAssignmentSearch(event.target.value)} placeholder="Search volunteer by name, phone, or email..." /></label>
                                <label className="form-field"><span>Event-assigned volunteer</span><select value={assignmentVolunteerId} onChange={(event) => setAssignmentVolunteerId(event.target.value)} required><option value="">Select a volunteer</option>{filteredEventVolunteers.map((volunteer) => <option value={volunteer.volunteer_user_id} key={volunteer.volunteer_user_id}>{volunteer.volunteer_name} · {volunteer.volunteer_email}</option>)}</select></label>
                                <button className="button button-primary button-small" type="submit" disabled={assignmentBusy || !assignmentVolunteerId || !selectedVolunteerIsVisible}>{assignmentBusy ? 'Saving…' : 'Grant item access'}</button>
                              </form>
                              {!eventVolunteers.length && <p className="admin-muted">No active event volunteers. Assign volunteers first from Ticket Management.</p>}
                              {eventVolunteers.length > 0 && !filteredEventVolunteers.length && <p className="admin-muted">No active event volunteers match this search.</p>}
                              {!assignments.length && <p className="admin-muted">No volunteers have item-specific access yet.</p>}
                              {assignments.length > 0 && <div className="distribution-assignee-list">{assignments.map((volunteer) => (
                                <div className="distribution-assignee-row" key={volunteer.volunteer_user_id}>
                                  <div><strong>{volunteer.volunteer_name}</strong><small>{volunteer.volunteer_email}</small></div>
                                  <span className={`ticket-status-badge ${volunteer.is_active ? 'is-active' : 'is-revoked'}`}>{volunteer.is_active ? 'Active' : 'Removed'}</span>
                                  {volunteer.is_active && <button className="inline-button danger-link" type="button" disabled={assignmentBusy} onClick={() => void handleSetAssignment(volunteer.volunteer_user_id, false)}>Revoke</button>}
                                </div>
                              ))}</div>}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="distribution-activity-section" id="distribution-panel-auditable-history" role="tabpanel" aria-label="Auditable history" hidden={activeTab !== 'auditable-history'}>
        <div className="distribution-section-heading"><div><p>Review distribution records and enter corrections with an audit reason.</p></div></div>
        <div className="distribution-history-filters">
          <label className="form-field"><span>Item</span><select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}><option value="">All items</option>{items.map((item) => <option value={item.item_id} key={item.item_id}>{item.item_name}</option>)}</select></label>
          <label className="form-field"><span>Volunteer / staff</span><select value={volunteerFilter} onChange={(event) => setVolunteerFilter(event.target.value)}><option value="">All staff</option>{volunteerCandidates.map((volunteer) => <option value={volunteer.volunteer_user_id} key={volunteer.volunteer_user_id}>{volunteer.volunteer_name}</option>)}</select></label>
          <label className="form-field"><span>Activity status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All activity</option><option value="distributed">Distributed</option><option value="corrected">Corrected</option></select></label>
        </div>
        {correctionTarget && (
          <form className="distribution-correction-form" onSubmit={(event) => void handleCorrection(event)}>
            <div><strong>Correct distribution · {correctionTarget.item_name}</strong><small>{correctionTarget.attendee_name || correctionTarget.participant_name} · {correctionTarget.attendee_type === 'guest' ? `Guest — ${correctionTarget.relationship}` : 'Main Participant'} · {correctionTarget.ticket_reference || 'Existing ticket'} · {correctionTarget.net_quantity} units remain to correct</small></div>
            <label className="form-field"><span>Quantity to correct</span><input type="number" min="1" max={correctionTarget.net_quantity} step="1" value={correctionQuantity} onChange={(event) => setCorrectionQuantity(event.target.value)} required /></label>
            <label className="form-field distribution-correction-reason"><span>Reason (required for audit)</span><input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={1000} required /></label>
            <div className="distribution-form-actions"><button className="button button-primary button-small" type="submit" disabled={correctionBusy}>{correctionBusy ? 'Saving…' : 'Record correction'}</button><button className="button button-outline button-small" type="button" onClick={() => setCorrectionTarget(null)}>Cancel</button></div>
          </form>
        )}
        {loading && <p className="admin-muted" role="status">Loading history…</p>}
        {!loading && !history.length && <p className="admin-muted">No distribution activity matches these filters.</p>}
        {!loading && history.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table distribution-history-table">
              <thead><tr><th>Activity</th><th>Event / item</th><th>Participant</th><th>Quantity</th><th>Current total</th><th>Staff / time</th><th>Audit</th></tr></thead>
              <tbody>{history.map((row) => (
                <tr key={`${row.activity_type}-${row.activity_id}`}>
                  <td><span className={`ticket-status-badge ${row.activity_type === 'correction' ? 'is-revoked' : 'is-active'}`}>{row.activity_type === 'correction' ? 'Correction' : row.activity_status.replace('_', ' ')}</span></td>
                  <td><strong>{row.item_name}</strong><small>{row.event_title}</small></td>
                  <td><strong>{row.attendee_name || row.participant_name}</strong><small className="capitalize">{row.attendee_type === 'guest' ? `Guest — ${row.relationship}` : 'Main Participant'}</small><small>{row.ticket_reference || 'Registration:' + row.registration_id}</small></td>
                  <td>{row.quantity > 0 ? `+${row.quantity}` : row.quantity}</td>
                  <td>{row.net_quantity}</td>
                  <td><strong>{row.actor_name}</strong><small>{formatEventDateTime(row.activity_at)}</small></td>
                  <td>{row.activity_type === 'correction' ? row.reason : Number(row.net_quantity) > 0 && <button className="inline-button danger-link" type="button" onClick={() => { setCorrectionTarget(row); setCorrectionQuantity('1'); setCorrectionReason('') }}>Correct</button>}</td>
                </tr>
              ))}</tbody>
            </table>
            {history.length === 50 && <p className="admin-muted">Showing the latest 50 matching activity records.</p>}
          </div>
        )}
      </section>

      <section className="distribution-volunteer-activity" id="distribution-panel-staff-activity" role="tabpanel" aria-label="Staff activity" hidden={activeTab !== 'staff-activity'}>
        <div className="distribution-section-heading"><div><p>Totals summarize volunteer distribution records and any corrected quantity.</p></div></div>
        {loading && <p className="admin-muted" role="status">Loading staff totals…</p>}
        {!loading && !volunteerActivity.length && <p className="admin-muted">No distribution activity has been recorded.</p>}
        {!loading && volunteerActivity.length > 0 && <div className="distribution-staff-grid">{volunteerActivity.map((person) => (
          <article className="distribution-staff-card" key={person.volunteer_user_id}>
            <strong>{person.volunteer_name}</strong>
            <span>{formatQuantity(person.distribution_count)} distribution record{Number(person.distribution_count) === 1 ? '' : 's'}</span>
            <small>{formatQuantity(person.net_quantity)} net units · {formatQuantity(person.quantity_corrected)} corrected</small>
          </article>
        ))}</div>}
      </section>
    </section>
  )
}

export default Distributions
