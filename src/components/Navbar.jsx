import { useState } from 'react'
import Icon from './Icon.jsx'
import { useAuth } from '../context/useAuth.js'
import { navigate } from '../lib/navigation.js'

function Brand({ inverse = false }) {
  return (
    <a className={`brand${inverse ? ' brand-inverse' : ''}`} href="/" aria-label="Evently home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 28 28" fill="none">
          <rect x="3.5" y="5.5" width="21" height="19" rx="4" stroke="currentColor" strokeWidth="2" />
          <path d="M9 3.5v4M19 3.5v4M4 11h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="m10 17 2.5 2.5L18.5 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>EVENTLY</span>
    </a>
  )
}

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [actionError, setActionError] = useState('')
  const { user, roles, signOut } = useAuth()
  const canAccessParticipantWorkspace = roles.includes('participant')
  const canAccessVolunteerWorkspace = roles.includes('volunteer')
  const isSuperAdmin = roles.includes('super_admin')
  const showVolunteerWorkspace = canAccessVolunteerWorkspace && !isSuperAdmin
  const path = window.location.pathname
  const onHome = path === '/'
  const onEvents = path === '/events' || path.startsWith('/events/')
  const accountPath = roles.includes('super_admin')
    ? '/admin'
    : roles.includes('volunteer')
      ? '/volunteer'
      : '/dashboard'
  const closeMenu = () => setMenuOpen(false)

  const handleSignOut = async () => {
    setActionError('')
    try {
      await signOut()
      setLogoutConfirm(false)
      closeMenu()
      navigate('/')
    } catch (error) {
      setActionError(error.message)
    }
  }

  const accountActions = user ? (
    <>
      {canAccessParticipantWorkspace
        ? <>
          {showVolunteerWorkspace && <a className="nav-text-action" href="/volunteer" onClick={closeMenu}>Volunteer Workspace</a>}
          <a className="nav-text-action" href="/dashboard" onClick={closeMenu}>My Evently</a>
        </>
        : <a className="nav-text-action" href={showVolunteerWorkspace ? '/volunteer' : accountPath} onClick={closeMenu}>{showVolunteerWorkspace ? 'Volunteer Workspace' : 'My Evently'}</a>}
      {logoutConfirm ? (
        <>
          <button className="nav-text-action" type="button" onClick={() => setLogoutConfirm(false)}>Cancel</button>
          <button className="nav-text-action" type="button" onClick={() => void handleSignOut()}>Confirm sign out</button>
        </>
      ) : (
        <button className="nav-text-action" type="button" onClick={() => setLogoutConfirm(true)}>Sign out</button>
      )}
    </>
  ) : (
    <>
      <a className="nav-text-action" href="/login" onClick={closeMenu}>Login</a>
      <a className="nav-text-action" href="/register" onClick={closeMenu}>Get Started</a>
    </>
  )

  return (
    <header className="site-header">
      <div className="nav-wrap container">
        <Brand />
        <button
          className="menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} size={23} />
        </button>
        <nav id="primary-navigation" className={`primary-nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">
          <a className={onHome ? 'active' : ''} href="/" onClick={closeMenu}>Home</a>
          <a className={onEvents ? 'active' : ''} href="/events" onClick={closeMenu}>Explore Events</a>
          {user && roles.includes('super_admin') && <a className={path.startsWith('/admin') ? 'active' : ''} href="/admin" onClick={closeMenu}>Admin Panel</a>}
          <a href="/#about" onClick={closeMenu}>About</a>
          <div className="mobile-nav-actions">
            {accountActions}
          </div>
        </nav>
        <div className="nav-actions">{accountActions}</div>
        {actionError && <span className="nav-action-error" role="alert">{actionError}</span>}
      </div>
    </header>
  )
}

export { Brand }
export default Navbar