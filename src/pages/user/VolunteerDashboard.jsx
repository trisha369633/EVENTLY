import { useCallback, useEffect, useState } from 'react'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { useDistributionRealtime } from '../../hooks/useDistributionRealtime.js'
import {
  getMyDistributionEvents,
  getMyDistributionItems,
  getMyDistributionRecentActivity,
} from '../../services/distributionService.js'
import { getTicketScannerEvents } from '../../services/ticketService.js'

function VolunteerDashboard() {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState({ retry: -1, events: [], items: [], activity: [], error: '' })
  const loading = result.retry !== retry
  const events = result.events
  const items = result.items
  const activity = result.activity
  const error = loading ? '' : result.error
  const itemsByEvent = new Map()
  for (const item of items) {
    const eventItems = itemsByEvent.get(String(item.event_id)) || []
    eventItems.push(item)
    itemsByEvent.set(String(item.event_id), eventItems)
  }

  const refresh = useCallback(() => setRetry((value) => value + 1), [])
  const connection = useDistributionRealtime({
    onChange: refresh,
    onFallback: refresh,
  })

  useEffect(() => {
    let active = true
    Promise.all([
      getTicketScannerEvents(),
      getMyDistributionEvents(),
      getMyDistributionItems(),
      getMyDistributionRecentActivity(),
    ])
      .then(([assignedEvents, distributionEvents, nextItems, nextActivity]) => {
        if (!active) return
        const distributionByEvent = new Map(distributionEvents.map((event) => [String(event.event_id), event]))
        const nextEvents = assignedEvents.map((event) => distributionByEvent.get(String(event.event_id)) || ({
          ...event,
          item_count: 0,
          total_inventory: 0,
          quantity_distributed: 0,
          remaining_inventory: 0,
          pending_items: 0,
        }))
        setResult({ retry, events: nextEvents, items: nextItems, activity: nextActivity, error: '' })
      })
      .catch((loadError) => {
        if (active) setResult({
          retry,
          events: [],
          items: [],
          activity: [],
          error: loadError.message || 'Your distribution assignments could not be loaded.',
        })
      })
    return () => {
      active = false
    }
  }, [retry])

  return (
    <section className="container distribution-volunteer-page">
      <header className="distribution-page-heading">
        <div>
          <span className="eyebrow">VOLUNTEER WORKSPACE</span>
          <h1>My assigned events</h1>
          <p>View only events and distribution items authorized for your staff account.</p>
        </div>
        <div className={`distribution-connection is-${connection}`} role="status">
          <span aria-hidden="true" />
          {connection === 'connected' ? 'Live updates on' : connection === 'reconnecting' ? 'Reconnecting · checking for updates' : connection === 'connecting' ? 'Connecting to live updates' : 'Live updates off'}
        </div>
      </header>

      {error && <div className="form-feedback" role="alert">{error}<button className="inline-button" type="button" onClick={refresh}>Try again</button></div>}
      {loading && <div className="event-skeleton distribution-loading" aria-label="Loading assigned events" aria-busy="true" />}
      {!loading && !error && !events.length && (
        <div className="empty-state distribution-empty">
          <h2>No assigned events</h2>
          <p>A Super Admin must first assign you to an event in Ticket Management and grant access to specific distribution items.</p>
          <a className="button button-outline" href="/volunteer/distributions">Open item distribution scanner</a>
        </div>
      )}
      {!loading && !error && events.length > 0 && (
        <div className="distribution-volunteer-grid">
          {events.map((event) => {
            const progress = event.total_inventory
              ? Math.min(100, Number(event.quantity_distributed) / Number(event.total_inventory) * 100)
              : 0
            return (
              <article className="distribution-volunteer-card" key={event.event_id}>
                <div className="distribution-volunteer-card-heading">
                  <div>
                    <span className="eyebrow">{event.item_count} assigned item{Number(event.item_count) === 1 ? '' : 's'}</span>
                    <h2>{event.event_title}</h2>
                    <p>{formatEventDateTime(event.event_start)}</p>
                  </div>
                  <StatusBadge status={event.event_status} />
                </div>
                <div className="distribution-progress-label">
                  <span>Inventory distributed</span>
                  <strong>{event.quantity_distributed} / {event.total_inventory}</strong>
                </div>
                <div className="distribution-progress-track" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin="0" aria-valuemax="100">
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="distribution-volunteer-items">
                  <strong>Authorized items</strong>
                  {!itemsByEvent.get(String(event.event_id))?.length && <small>No distribution items are currently authorized for you.</small>}
                  {itemsByEvent.get(String(event.event_id))?.map((item) => {
                    const now = Date.now()
                    const inWindow = (!item.distribution_starts_at || Date.parse(item.distribution_starts_at) <= now)
                      && (!item.distribution_ends_at || Date.parse(item.distribution_ends_at) > now)
                    const status = !item.is_active
                      ? 'inactive'
                      : Number(item.inventory_remaining) <= 0 || !inWindow
                        ? 'unavailable'
                        : 'active'
                    return (
                      <div className="distribution-volunteer-item" key={item.item_id}>
                        <div><span>{item.item_name}</span><small>{item.quantity_distributed} / {item.total_quantity} distributed · limit {item.max_per_participant}</small></div>
                        <span className={`distribution-state-badge is-${status}`}>{status}</span>
                      </div>
                    )
                  })}
                </div>
                <dl className="distribution-event-metrics">
                  <div><dt>Remaining stock</dt><dd>{event.remaining_inventory}</dd></div>
                  <div><dt>Items with remaining distributions</dt><dd>{event.pending_items}</dd></div>
                </dl>
                <a className="button button-primary button-small" href={`/volunteer/distributions?event_id=${event.event_id}`}>Distribute items for this event</a>
              </article>
            )
          })}
        </div>
      )}

      <section className="distribution-activity-section">
        <div className="distribution-section-heading">
          <div><span className="eyebrow">LIVE EVENT ACTIVITY</span><h2>Recent activity</h2></div>
          <button className="inline-button" type="button" onClick={refresh}>Refresh</button>
        </div>
        {loading && <p className="admin-muted" role="status">Loading recent activity…</p>}
        {!loading && !error && activity.length === 0 && <p className="admin-muted">No distribution activity has been recorded for your assigned items yet.</p>}
        {!loading && activity.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table distribution-history-table">
              <thead><tr><th>Activity</th><th>Event / item</th><th>Participant</th><th>Quantity</th><th>Staff</th><th>Time</th></tr></thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={`${row.activity_type}-${row.activity_id}`}>
                    <td>{row.activity_type === 'correction' ? 'Correction' : 'Distributed'}</td>
                    <td><strong>{row.item_name}</strong><small>{row.event_title}</small></td>
                    <td>{row.participant_name}</td>
                    <td>{row.quantity > 0 ? `+${row.quantity}` : row.quantity}</td>
                    <td>{row.actor_name}</td>
                    <td>{formatEventDateTime(row.activity_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}

export default VolunteerDashboard
