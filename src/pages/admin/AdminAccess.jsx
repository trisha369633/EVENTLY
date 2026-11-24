import { useEffect, useState } from 'react'
import { useAuth } from '../../context/useAuth.js'
import { formatAdminRpcError } from '../../lib/adminRpcError.js'
import { searchAdminUsers, setSuperAdminRole } from '../../services/roleService.js'
import './AdminAccess.css'

const pageSize = 50

function AdminAccess() {
  const { user, roles } = useAuth()
  const isSuperAdmin = roles.includes('super_admin')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [directoryVersion, setDirectoryVersion] = useState(0)
  const [directory, setDirectory] = useState({ key: '', users: [], count: 0, error: null })
  const [busyUserId, setBusyUserId] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const directoryKey = JSON.stringify([search, page, directoryVersion])
  const loading = directory.key !== directoryKey
  const pageCount = Math.ceil(directory.count / pageSize)

  useEffect(() => {
    if (!isSuperAdmin) return undefined
    let active = true
    searchAdminUsers({ search, limit: pageSize, offset: page * pageSize })
      .then(({ users, count }) => {
        if (active) setDirectory({ key: directoryKey, users, count, error: null })
      })
      .catch((error) => {
        if (active) {
          setDirectory({
            key: directoryKey,
            users: [],
            count: 0,
            error: formatAdminRpcError(error, 'admin_search_users'),
          })
        }
      })
    return () => {
      active = false
    }
  }, [directoryKey, isSuperAdmin, page, search])

  const handleSearch = (event) => {
    event.preventDefault()
    setSearch(searchText.trim())
    setPage(0)
  }

  const handleRoleChange = async (target, makeAdmin) => {
    const targetUserId = String(target.user_id)
    if (!isSuperAdmin || busyUserId) return
    if (!makeAdmin && targetUserId === user?.id) return
    if (!makeAdmin && !window.confirm(`Remove Super Admin access from ${target.full_name || target.email}?`)) return

    setBusyUserId(targetUserId)
    setActionError('')
    setNotice('')
    try {
      await setSuperAdminRole({ userId: target.user_id, makeAdmin })
      setNotice(makeAdmin
        ? `${target.full_name || target.email} was granted Super Admin access.`
        : `Super Admin access was removed from ${target.full_name || target.email}.`)
      setDirectoryVersion((version) => version + 1)
    } catch (error) {
      const { userMessage } = formatAdminRpcError(error, 'set_user_super_admin_role')
      const databaseMessage = String(error?.message || '').trim()
      setActionError(error?.code && String(error.code).startsWith('22')
        ? userMessage
        : databaseMessage
          ? `Admin access could not be updated: ${databaseMessage}`
          : userMessage)
    } finally {
      setBusyUserId('')
    }
  }

  if (!isSuperAdmin) {
    return <section className="admin-page"><div className="form-feedback" role="alert">Only Super Admins can manage administrator access.</div></section>
  }

  return (
    <section className="admin-page admin-access-page">
      <header className="admin-page-heading">
        <div><span className="eyebrow">ADMINISTRATION</span><h1>Admin Access</h1><p>Search registered users and manage Super Admin access.</p></div>
      </header>

      {actionError && <p className="form-feedback" role="alert">{actionError}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}

      <form className="admin-access-search" onSubmit={handleSearch}>
        <label className="form-field">
          <span>Search registered users</span>
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            maxLength={100}
            placeholder="Search by name or email"
          />
        </label>
        <button className="button button-primary button-small" type="submit" disabled={loading || Boolean(busyUserId)}>Search</button>
      </form>

      {loading && <p className="admin-muted" role="status">Loading users…</p>}
      {!loading && directory.error && (
        <p className="form-feedback" role="alert">
          {directory.error.userMessage}
          <button className="inline-button" type="button" onClick={() => setDirectoryVersion((version) => version + 1)}>Retry</button>
        </p>
      )}
      {!loading && !directory.error && directory.users.length === 0 && <p className="admin-muted">No users match this search.</p>}

      {!loading && !directory.error && directory.users.length > 0 && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table admin-access-table">
              <thead><tr><th>User</th><th>Current roles</th><th>Admin access</th></tr></thead>
              <tbody>
                {directory.users.map((target) => {
                  const targetUserId = String(target.user_id)
                  const targetRoles = Array.isArray(target.roles) ? target.roles : []
                  const hasAdminAccess = targetRoles.includes('super_admin')
                  const isCurrentUser = targetUserId === user?.id
                  const rowBusy = busyUserId === targetUserId
                  return (
                    <tr key={targetUserId} aria-busy={rowBusy}>
                      <td><strong>{target.full_name || 'Name unavailable'}</strong><small>{target.email || 'Email unavailable'}</small></td>
                      <td>
                        <div className="admin-access-roles">
                          {targetRoles.length
                            ? targetRoles.map((role) => (
                              <span className={`admin-access-role${role === 'super_admin' ? ' is-super-admin' : ''}`} key={role}>
                                {role === 'super_admin' ? 'Super Admin' : role.replace(/_/g, ' ')}
                              </span>
                            ))
                            : <span className="admin-muted">No platform roles</span>}
                        </div>
                      </td>
                      <td>
                        <div className="admin-access-action">
                          <button
                            className={`inline-button${hasAdminAccess ? ' danger-link' : ''}`}
                            type="button"
                            disabled={Boolean(busyUserId) || (hasAdminAccess && isCurrentUser)}
                            title={hasAdminAccess && isCurrentUser ? 'You cannot remove your own Super Admin access.' : undefined}
                            onClick={() => void handleRoleChange(target, !hasAdminAccess)}
                          >
                            {rowBusy ? 'Saving…' : hasAdminAccess ? 'Remove Admin' : 'Add Super Admin'}
                          </button>
                          {hasAdminAccess && isCurrentUser && <small>Your own access cannot be removed here.</small>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="admin-pagination">
              <span>Page {page + 1} of {pageCount} · {directory.count} users</span>
              <div>
                <button className="button button-outline button-small" type="button" disabled={page === 0 || Boolean(busyUserId)} onClick={() => setPage((value) => value - 1)}>Previous</button>
                <button className="button button-outline button-small" type="button" disabled={page + 1 >= pageCount || Boolean(busyUserId)} onClick={() => setPage((value) => value + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default AdminAccess
