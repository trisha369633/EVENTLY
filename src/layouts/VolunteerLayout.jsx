function VolunteerLayout({ children }) {
  const path = window.location.pathname
  const links = [
    { href: '/volunteer', label: 'My Assigned Events', active: path === '/volunteer' },
    { href: '/volunteer/distributions', label: 'Item Distribution', active: path === '/volunteer/distributions' },
    { href: '/volunteer/history', label: 'My Distribution History', active: path === '/volunteer/history' },
  ]

  return (
    <div className="container admin-layout volunteer-layout">
      <aside className="admin-sidebar" aria-label="Volunteer navigation">
        <span className="admin-sidebar-title">VOLUNTEER WORKSPACE</span>
        <nav className="admin-sidebar-links">
          {links.map(({ href, label, active }) => <a className={active ? 'active' : ''} href={href} key={href}>{label}</a>)}
        </nav>
        <a className="admin-public-link" href="/events">Explore public events</a>
      </aside>
      <div className="admin-layout-content">{children}</div>
    </div>
  )
}

export default VolunteerLayout