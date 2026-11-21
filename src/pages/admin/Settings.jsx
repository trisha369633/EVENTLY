import { useAuth } from '../../context/useAuth.js'

function displayDate(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function Settings() {
  const { user, profile, roles } = useAuth()
  return (
    <section className="admin-page">
      <div className="admin-page-heading"><div><span className="eyebrow">ACCOUNT</span><h1>Admin settings</h1><p>Review your Evently account information and access role.</p></div></div>
      <article className="admin-settings-panel">
        <div className="admin-settings-heading"><span className="eyebrow">CURRENT ADMIN PROFILE</span><h2>{profile?.full_name || 'Admin account'}</h2></div>
        <dl className="admin-settings-list">
          <div><dt>Email</dt><dd>{profile?.email || user?.email || 'Not available'}</dd></div>
          <div><dt>Platform role</dt><dd>{roles.length ? roles.join(', ') : 'Not available'}</dd></div>
          <div><dt>Phone</dt><dd>{profile?.phone || 'Not provided'}</dd></div>
          <div><dt>Account created</dt><dd>{displayDate(profile?.created_at || user?.created_at)}</dd></div>
          <div><dt>Account ID</dt><dd className="admin-account-id">{user?.id || 'Not available'}</dd></div>
        </dl>
        <p className="admin-muted">Role changes and credential management are not available from this page.</p>
      </article>
    </section>
  )
}

export default Settings
