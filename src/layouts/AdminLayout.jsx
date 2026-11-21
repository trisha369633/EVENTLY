function AdminLayout({ children }) {
  const path = window.location.pathname
  const links = [
    { href: '/admin', label: 'Overview', active: path === '/admin' },
    { href: '/admin/events', label: 'Manage Events', active: path === '/admin/events' || (/^\/admin\/events\/[^/]+/.test(path) && path !== '/admin/events/create') },
    { href: '/admin/events/create', label: 'Create Event', active: path === '/admin/events/create' },
    { href: '/admin/registrations', label: 'All Registrations', active: path === '/admin/registrations' },
    { href: '/admin/reports/registrations', label: 'Registration Analytics', active: path === '/admin/reports/registrations' },
    { href: '/admin/payments', label: 'Payment Management', active: path === '/admin/payments' },
    { href: '/admin/reports/payments', label: 'Payment Reports', active: path === '/admin/reports/payments' },
    { href: '/admin/reports/revenue', label: 'Revenue Reports', active: path === '/admin/reports/revenue' },
    { href: '/admin/participants', label: 'Participant Search', active: path === '/admin/participants' },
    { href: '/admin/tickets', label: 'Ticket Management', active: path === '/admin/tickets' },
    { href: '/admin/distributions', label: 'Distributions', active: path === '/admin/distributions' },
    { href: '/admin/reports/benefits', label: 'Benefit Reports', active: path === '/admin/reports/benefits' },
    { href: '/admin/reports/volunteers', label: 'Volunteer Reports', active: path === '/admin/reports/volunteers' },
    { href: '/admin/volunteer-management', label: 'Volunteer Management', active: path === '/admin/volunteer-management' },
    { href: '/admin/ticket-scanner', label: 'Ticket Scanner', active: path === '/admin/ticket-scanner' },
    { href: '/admin/organizations', label: 'Universities & Departments', active: path === '/admin/organizations' },
    { href: '/admin/settings', label: 'Settings', active: path === '/admin/settings' },
  ]
  return (
    <div className="container admin-layout">
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <span className="admin-sidebar-title">ADMIN WORKSPACE</span>
        <nav className="admin-sidebar-links">
          {links.map(({ href, label, active }) => <a className={active ? 'active' : ''} href={href} key={href}>{label}</a>)}
        </nav>
        <a className="admin-public-link" href="/events">Explore public events</a>
      </aside>
      <div className="admin-layout-content">{children}</div>
    </div>
  )
}

export default AdminLayout