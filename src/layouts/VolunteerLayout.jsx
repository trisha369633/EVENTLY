import { cloneElement, useState } from 'react'

function VolunteerLayout({ children }) {
  const path = window.location.pathname
  const isDistributionPage = path === '/volunteer/distributions'
  const [distributionView, setDistributionView] = useState('items')
  const links = [
    { href: '/volunteer', label: 'My Assigned Events', active: path === '/volunteer' },
  ]
  const content = isDistributionPage
    ? cloneElement(children, {
        distributionView,
        onDistributionViewChange: setDistributionView,
      })
    : children

  return (
    <div className={`container admin-layout volunteer-layout${isDistributionPage ? ' volunteer-distribution-layout' : ''}`}>
      <aside className="admin-sidebar" aria-label="Volunteer navigation">
        <span className="admin-sidebar-title">VOLUNTEER WORKSPACE</span>
        <nav className="admin-sidebar-links">
          {links.map(({ href, label, active }) => <a className={active ? 'active' : ''} href={href} key={href}>{label}</a>)}
          {isDistributionPage ? (
            <div className="volunteer-distribution-segments" role="tablist" aria-label="Item distribution views">
              <button
                id="volunteer-distribution-select-tab"
                className={distributionView === 'items' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={distributionView === 'items'}
                aria-controls="volunteer-distribution-select-panel"
                onClick={() => setDistributionView('items')}
              >
                Select item
              </button>
              <button
                id="volunteer-distribution-scan-tab"
                className={distributionView === 'scan' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={distributionView === 'scan'}
                aria-controls="volunteer-distribution-scan-panel"
                onClick={() => setDistributionView('scan')}
              >
                Scan
              </button>
            </div>
          ) : (
            <a href="/volunteer/distributions">Item Distribution</a>
          )}
          <a className={path === '/volunteer/history' ? 'active' : ''} href="/volunteer/history">My Distribution History</a>
        </nav>
        <a className="admin-public-link" href="/events">Explore public events</a>
      </aside>
      <div className="admin-layout-content">{content}</div>
    </div>
  )
}

export default VolunteerLayout