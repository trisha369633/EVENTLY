import { useEffect, useMemo, useState } from 'react'
import { formatEventDateTime } from '../../lib/eventUtils.js'
import { formatAdminRpcError } from '../../lib/adminRpcError.js'
import {
  getAdminDistributionHistory,
  setDistributionItemVolunteer,
} from '../../services/distributionService.js'
import { getAdminVolunteerActivityData } from '../../services/adminReportService.js'
import {
  assignEventTicketVolunteer,
  revokeEventTicketVolunteer,
} from '../../services/ticketService.js'
import { searchAdminUsers, setVolunteerRole } from '../../services/roleService.js'

const pageSize = 50
const emptyList = []

function RpcErrorNotice({ error }) {
  if (!error) return null
  const { diagnostic } = error

  return (
    <div className="form-feedback" role="alert">
      <p>{error.userMessage}</p>
      {import.meta.env.DEV && diagnostic && (
        <details>
          <summary>Developer diagnostics</summary>
          <dl>
            <div><dt>Operation</dt><dd>{diagnostic.operation}</dd></div>
            <div><dt>Code</dt><dd>{diagnostic.code}</dd></div>
            <div><dt>Message</dt><dd>{diagnostic.message}</dd></div>
            {diagnostic.details && <div><dt>Details</dt><dd>{diagnostic.details}</dd></div>}
            {diagnostic.hint && <div><dt>Hint</dt><dd>{diagnostic.hint}</dd></div>}
            {diagnostic.status !== null && <div><dt>HTTP status</dt><dd>{diagnostic.status}</dd></div>}
          </dl>
        </details>
      )}
    </div>
  )
}

function VolunteerManagement() {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('volunteer')
  const [page, setPage] = useState(0)
  const [directoryVersion, setDirectoryVersion] = useState(0)
  const [directory, setDirectory] = useState({ key: '', users: [], count: 0, error: '' })
  const [managementVersion, setManagementVersion] = useState(0)
  const [management, setManagement] = useState({ version: -1, data: null, error: '' })
  const [selectedUserId, setSelectedUserId] = useState('')
  const [eventId, setEventId] = useState('')
  const [activity, setActivity] = useState({ userId: '', rows: [], error: '' })
  const [actionError, setActionError] = useState('')
  const [roleError, setRoleError] = useState(null)
  const [notice, setNotice] = useState('')
  const [busyAction, setBusyAction] = useState('')

  const directoryKey = JSON.stringify([search, roleFilter, page, directoryVersion])
  const directoryLoading = directory.key !== directoryKey
  const managementLoading = management.version !== managementVersion
  const managementData = management.version === managementVersion ? management.data : null
  const selectedUser = directory.users.find((user) => String(user.user_id) === selectedUserId)
  const isVolunteer = Boolean(selectedUser?.roles?.includes('volunteer'))
  const eventAssignments = managementData?.eventAssignments || emptyList
  const distributionItems = managementData?.distributionItems || emptyList
  const itemAssignments = managementData?.itemAssignments || emptyList
  const activityLoading = Boolean(selectedUserId && isVolunteer && activity.userId !== selectedUserId)
  const activeEventIds = useMemo(() => new Set(
    eventAssignments.flatMap((event) => event.assignments
      .filter((assignment) => assignment.is_active && String(assignment.volunteer_user_id) === selectedUserId)
      .map(() => String(event.eventId))),
  ), [eventAssignments, selectedUserId])
  const selectedEventAssignments = eventAssignments
    .map((event) => ({
      ...event,
      assignment: event.assignments.find((assignment) => String(assignment.volunteer_user_id) === selectedUserId),
    }))
    .filter((event) => event.assignment)
  const permittedItems = distributionItems
    .filter((item) => activeEventIds.has(String(item.event_id)))
    .map((item) => ({
      ...item,
      assignment: itemAssignments
        .find((group) => group.itemId === String(item.item_id))
        ?.assignments.find((assignment) => String(assignment.volunteer_user_id) === selectedUserId),
    }))

  useEffect(() => {
    let active = true
    searchAdminUsers({
      search,
      role: roleFilter || null,
      limit: pageSize,
      offset: page * pageSize,
    })
      .then(({ users, count }) => {
        if (active) setDirectory({ key: directoryKey, users, count, error: '' })
      })
      .catch((error) => {
        if (active) setDirectory({
          key: directoryKey,
          users: [],
          count: 0,
          error: formatAdminRpcError(error, 'admin_search_users'),
        })
      })
    return () => {
      active = false
    }
  }, [directoryKey, search, roleFilter, page])

  useEffect(() => {
    let active = true
    getAdminVolunteerActivityData()
      .then((data) => {
        if (active) setManagement({ version: managementVersion, data, error: '' })
      })
      .catch((error) => {
        if (active) setManagement({ version: managementVersion, data: null, error: error.message || 'Event and item assignment data could not be loaded.' })
      })
    return () => {
      active = false
    }
  }, [managementVersion])

  useEffect(() => {
    if (!selectedUserId || !isVolunteer) return undefined
    let active = true
    getAdminDistributionHistory({ volunteerUserId: selectedUserId, limit: 50 })
      .then((rows) => {
        if (active) setActivity({ userId: selectedUserId, rows, error: '' })
      })
      .catch((error) => {
        if (active) setActivity({ userId: selectedUserId, rows: [], error: error.message || 'Volunteer activity could not be loaded.' })
      })
    return () => {
      active = false
    }
  }, [selectedUserId, isVolunteer, managementVersion])

  const refresh = () => {
    setDirectoryVersion((value) => value + 1)
    setManagementVersion((value) => value + 1)
  }

  const runRoleAction = async (user) => {
    const active = !user.roles.includes('volunteer')
    if (!active && !window.confirm(`Revoke the volunteer role from ${user.full_name || user.email}? Their event and item assignments will also be deactivated.`)) return
    setBusyAction(`role:${user.user_id}`)
    setActionError('')
    setRoleError(null)
    setNotice('')
    try {
      await setVolunteerRole({ userId: user.user_id, active })
      setNotice(active
        ? `${user.full_name || user.email} now has the volunteer role. Their participant role was left unchanged.`
        : `The volunteer role and its active event/item access were revoked for ${user.full_name || user.email}.`)
      if (!active) setSelectedUserId('')
      refresh()
    } catch (error) {
      setRoleError(formatAdminRpcError(error, 'admin_set_volunteer_role'))
    } finally {
      setBusyAction('')
    }
  }

  const handleSearch = (event) => {
    event.preventDefault()
    setSearch(searchText.trim())
    setPage(0)
  }

  const handleAssignEvent = async (event) => {
    event.preventDefault()
    if (!selectedUser || !isVolunteer || !eventId) return
    setBusyAction(`event:${eventId}`)
    setActionError('')
    setNotice('')
    try {
      await assignEventTicketVolunteer({ eventId, volunteerUserId: selectedUser.user_id })
      setNotice(`${selectedUser.full_name || selectedUser.email} was assigned to the selected event. Item permissions were not granted automatically.`)
      setEventId('')
      refresh()
    } catch (error) {
      setActionError(error.message || 'The event assignment could not be created.')
    } finally {
      setBusyAction('')
    }
  }

  const handleRevokeEvent = async (event) => {
    if (!selectedUser || !window.confirm(`Remove ${selectedUser.full_name || selectedUser.email} from ${event.eventTitle}?`)) return
    setBusyAction(`event:${event.eventId}`)
    setActionError('')
    setNotice('')
    try {
      await revokeEventTicketVolunteer({ eventId: event.eventId, volunteerUserId: selectedUser.user_id })
      setNotice(`Event access was removed for ${event.eventTitle}; Phase 6 item access is also revoked by the existing database trigger.`)
      refresh()
    } catch (error) {
      setActionError(error.message || 'The event assignment could not be removed.')
    } finally {
      setBusyAction('')
    }
  }

  const handleItemPermission = async (item, active) => {
    if (!selectedUser || !isVolunteer) return
    setBusyAction(`item:${item.item_id}`)
    setActionError('')
    setNotice('')
    try {
      await setDistributionItemVolunteer({
        itemId: item.item_id,
        volunteerUserId: selectedUser.user_id,
        active,
      })
      setNotice(`${item.item_name} access was ${active ? 'granted' : 'removed'} for ${selectedUser.full_name || selectedUser.email}.`)
      refresh()
    } catch (error) {
      setActionError(error.message || 'The distribution item permission could not be updated.')
    } finally {
      setBusyAction('')
    }
  }

  const pageCount = Math.ceil(directory.count / pageSize)

  return (
    <section className="admin-page volunteer-management-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">ACCESS & STAFF</span><h1>Volunteer Management</h1><p>Manage role membership, event assignments, item-level distribution access, and activity.</p></div>
        <button className="button button-outline" type="button" onClick={refresh} disabled={directoryLoading || managementLoading}>Refresh</button>
      </header>

      {actionError && <p className="form-feedback" role="alert">{actionError}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {!directoryLoading && <RpcErrorNotice error={directory.error} />}
      <RpcErrorNotice error={roleError} />
      {management.error && <p className="form-feedback" role="alert">{management.error}</p>}
      {managementData?.distributionError && <p className="inline-notice" role="status">{managementData.distributionError} Event assignments remain manageable.</p>}
      {managementData?.itemAssignmentError && <p className="inline-notice" role="status">{managementData.itemAssignmentError}</p>}

      <section className="admin-section-panel">
        <div className="admin-section-heading"><div><h2>All Volunteers & Search Users</h2><p>Search existing profiles, view role rows, and grant or revoke only the volunteer role.</p></div></div>
        <form className="volunteer-search-form" onSubmit={handleSearch}>
          <label className="form-field"><span>Search registered users</span><input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} maxLength={100} placeholder="Search name or email" /></label>
          <label className="form-field"><span>Directory</span><select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(0) }}><option value="volunteer">All Volunteers</option><option value="">All registered users</option><option value="participant">Participants</option><option value="super_admin">Super Admins</option></select></label>
          <button className="button button-primary button-small" type="submit" disabled={directoryLoading}>Search Users</button>
        </form>

        {directoryLoading && <p className="admin-muted" role="status">Loading user directory…</p>}
        {!directoryLoading && !directory.error && directory.users.length === 0 && <p className="admin-muted">No users match this search.</p>}
        {!directoryLoading && directory.users.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table volunteer-directory-table">
              <thead><tr><th>Name / email</th><th>Institution</th><th>Department</th><th>Role status</th><th>Actions</th></tr></thead>
              <tbody>
                {directory.users.map((user) => {
                  const volunteer = user.roles.includes('volunteer')
                  return (
                    <tr key={user.user_id} className={selectedUserId === String(user.user_id) ? 'is-selected' : ''}>
                      <td><button className="volunteer-profile-link" type="button" onClick={() => setSelectedUserId(String(user.user_id))}><strong>{user.full_name || 'Name unavailable'}</strong></button><small>{user.email || 'Email unavailable'}</small></td>
                      <td>{user.institution_name || '—'}</td>
                      <td>{user.department_name || '—'}</td>
                      <td><span className={`ticket-status-badge ${volunteer ? 'is-active' : 'is-revoked'}`}>{volunteer ? 'Volunteer' : 'Not a volunteer'}</span><small>{user.roles.join(', ') || 'No platform role'}</small></td>
                      <td><div className="admin-row-actions"><button className="inline-button" type="button" onClick={() => setSelectedUserId(String(user.user_id))}>View profile</button><button className={`inline-button${volunteer ? ' danger-link' : ''}`} type="button" disabled={busyAction === `role:${user.user_id}`} onClick={() => void runRoleAction(user)}>{busyAction === `role:${user.user_id}` ? 'Saving…' : volunteer ? 'Revoke volunteer' : 'Assign volunteer'}</button></div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!directoryLoading && pageCount > 1 && <div className="admin-pagination"><span>Page {page + 1} of {pageCount} · {directory.count} users</span><div><button className="button button-outline button-small" type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
      </section>

      {selectedUser && (
        <section className="admin-section-panel volunteer-profile-panel">
          <div className="admin-section-heading"><div><span className="eyebrow">VOLUNTEER PROFILE</span><h2>{selectedUser.full_name || selectedUser.email}</h2><p>{selectedUser.email || 'Email unavailable'} · {selectedUser.institution_name || 'Institution unavailable'} · {selectedUser.department_name || 'Department unavailable'}</p></div><span className={`ticket-status-badge ${isVolunteer ? 'is-active' : 'is-revoked'}`}>{isVolunteer ? 'Volunteer role active' : 'Volunteer role inactive'}</span></div>
          {!isVolunteer
            ? <p className="admin-muted">Assign the volunteer role before managing event assignments or item permissions.</p>
            : <>
              <div className="volunteer-management-subsection">
                <div className="admin-section-heading"><div><h3>Assigned Events</h3><p>Event-scoped ticket access uses the existing Phase 5 assignment RPCs.</p></div></div>
                <form className="volunteer-search-form" onSubmit={(event) => void handleAssignEvent(event)}>
                  <label className="form-field"><span>Event</span><select value={eventId} onChange={(event) => setEventId(event.target.value)} required disabled={managementLoading || !managementData?.events?.length}><option value="">Select an event</option>{(managementData?.events || []).map((event) => <option value={event.id} key={event.id}>{event.title}</option>)}</select></label>
                  <button className="button button-primary button-small" type="submit" disabled={!eventId || Boolean(busyAction)}>Assign event</button>
                </form>
                {selectedEventAssignments.length === 0
                  ? <p className="admin-muted">No event assignments are recorded for this volunteer.</p>
                  : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Event</th><th>Assignment</th><th>Action</th></tr></thead><tbody>
                    {selectedEventAssignments.map((event) => <tr key={event.eventId}><td>{event.eventTitle}</td><td>{event.assignment.is_active ? 'Active' : 'Removed'}</td><td>{event.assignment.is_active && <button className="inline-button danger-link" type="button" disabled={Boolean(busyAction)} onClick={() => void handleRevokeEvent(event)}>Remove assignment</button>}</td></tr>)}
                  </tbody></table></div>}
              </div>

              <div className="volunteer-management-subsection">
                <div className="admin-section-heading"><div><h3>Distribution Item Permissions</h3><p>Only items within active event assignments are listed. No item access is granted by default.</p></div></div>
                {managementData?.distributionError
                  ? <p className="admin-muted">Phase 6 item permission data is unavailable.</p>
                  : !activeEventIds.size
                    ? <p className="admin-muted">Assign this volunteer to an event before granting item access.</p>
                    : permittedItems.length === 0
                      ? <p className="admin-muted">No distribution items are configured for the volunteer’s assigned events.</p>
                      : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Item / event</th><th>Permission</th><th>Action</th></tr></thead><tbody>
                        {permittedItems.map((item) => {
                          const active = Boolean(item.assignment?.is_active)
                          return <tr key={item.item_id}><td><strong>{item.item_name}</strong><small>{item.event_title}</small></td><td>{active ? 'Active' : 'Not granted'}</td><td><button className={`inline-button${active ? ' danger-link' : ''}`} type="button" disabled={Boolean(busyAction)} onClick={() => void handleItemPermission(item, !active)}>{active ? 'Remove item access' : 'Grant item access'}</button></td></tr>
                        })}
                      </tbody></table></div>}
              </div>

              <div className="volunteer-management-subsection">
                <div className="admin-section-heading"><div><h3>Volunteer Activity</h3><p>Recent distribution records for this volunteer; ticket scans and check-ins are not benefits.</p></div></div>
                {activityLoading && <p className="admin-muted" role="status">Loading volunteer activity…</p>}
                {activity.error && activity.userId === selectedUserId && <p className="form-feedback" role="alert">{activity.error}</p>}
                {!activityLoading && activity.userId === selectedUserId && !activity.error && activity.rows.length === 0 && <p className="admin-muted">No distribution activity is recorded for this volunteer.</p>}
                {!activityLoading && activity.userId === selectedUserId && activity.rows.length > 0 && (
                  <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Activity</th><th>Event / item</th><th>Participant</th><th>Quantity</th><th>Time</th></tr></thead><tbody>
                    {activity.rows.map((row) => <tr key={`${row.activity_type}-${row.activity_id}`}><td>{row.activity_type === 'correction' ? 'Correction' : row.activity_status}</td><td><strong>{row.item_name}</strong><small>{row.event_title}</small></td><td>{row.participant_name}</td><td>{row.quantity > 0 ? `+${row.quantity}` : row.quantity}</td><td>{formatEventDateTime(row.activity_at)}</td></tr>)}
                  </tbody></table></div>
                )}
              </div>
            </>}
        </section>
      )}
    </section>
  )
}

export default VolunteerManagement
