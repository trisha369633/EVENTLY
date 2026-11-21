import { useCallback, useEffect, useState } from 'react'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import { useDistributionRealtime } from '../../hooks/useDistributionRealtime.js'
import { getMyDistributionRecentActivity } from '../../services/distributionService.js'

function DistributionHistory() {
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  const refresh = useCallback(() => setRetry((value) => value + 1), [])
  const connection = useDistributionRealtime({
    onChange: refresh,
    onFallback: refresh,
  })

  useEffect(() => {
    let active = true
    getMyDistributionRecentActivity(50)
      .then((rows) => {
        if (!active) return
        setActivity(rows)
        setError('')
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Your distribution history could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
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
          <h1>My Distribution History</h1>
          <p>Recent item distributions for events and items currently authorized to your staff account.</p>
        </div>
        <div className={`distribution-connection is-${connection}`} role="status">
          <span aria-hidden="true" />
          {connection === 'connected' ? 'Live updates on' : connection === 'reconnecting' ? 'Reconnecting · checking for updates' : connection === 'connecting' ? 'Connecting to live updates' : 'Live updates off'}
        </div>
      </header>

      {error && <div className="form-feedback" role="alert">{error}<button className="inline-button" type="button" onClick={refresh}>Try again</button></div>}
      {loading && <div className="event-skeleton distribution-loading" aria-label="Loading distribution history" aria-busy="true" />}
      {!loading && !error && !activity.length && (
        <div className="empty-state"><h2>No distribution history yet</h2><p>Completed distributions for your authorized items will appear here.</p></div>
      )}
      {!loading && !error && activity.length > 0 && (
        <section className="distribution-activity-section">
          <div className="distribution-section-heading">
            <div><span className="eyebrow">RECENT ACTIVITY</span><h2>Latest 50 records</h2></div>
            <button className="inline-button" type="button" onClick={refresh}>Refresh</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table distribution-history-table">
              <thead><tr><th>Activity</th><th>Event / item</th><th>Participant</th><th>Quantity</th><th>Staff</th><th>Time</th></tr></thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={`${row.activity_type}-${row.activity_id}`}>
                    <td>{row.activity_type === 'correction' ? 'Correction' : 'Distributed'}{row.reason && <small>{row.reason}</small>}</td>
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
        </section>
      )}
    </section>
  )
}

export default DistributionHistory