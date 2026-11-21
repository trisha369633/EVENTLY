import { useEffect, useMemo, useState } from 'react'
import EventCard from '../../components/EventCard.jsx'
import Icon from '../../components/Icon.jsx'
import { getPublishedEvents, getPublicRegistrationCounts } from '../../services/eventService.js'

function Events() {
  const [events, setEvents] = useState([])
  const [counts, setCounts] = useState({})
  const [search, setSearch] = useState('')
  const [institutionId, setInstitutionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [mode, setMode] = useState('')
  const [timePeriod, setTimePeriod] = useState('upcoming')
  const [sort, setSort] = useState('soonest')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [countWarning, setCountWarning] = useState('')
  const [retry, setRetry] = useState(0)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    getPublishedEvents()
      .then(async (items) => {
        if (!active) return
        setEvents(items)
        try {
          const nextCounts = await getPublicRegistrationCounts(items.map((item) => item.id))
          if (active) setCounts(nextCounts)
        } catch {
          if (active) setCountWarning('Seat counts are temporarily unavailable. Registration availability is verified when you submit.')
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'We could not load events. Please try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [retry])

  const institutions = useMemo(() => {
    const map = new Map()
    events.forEach((event) => map.set(event.institution_id, event.institution_name))
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [events])
  const departments = useMemo(() => {
    const map = new Map()
    events
      .filter((event) => !institutionId || event.institution_id === institutionId)
      .forEach((event) => {
        if (event.department_id && event.department_name) map.set(event.department_id, event.department_name)
      })
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [events, institutionId])
  const modes = useMemo(() => [...new Set(events.map((event) => event.event_mode))].sort(), [events])

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase()
    return events
      .filter((event) => {
        const startsAt = Date.parse(event.event_start)
        const isUpcoming = Number.isFinite(startsAt) && startsAt > now
        const searchable = `${event.title} ${event.short_description || ''} ${event.description || ''}`.toLowerCase()
        return (!query || searchable.includes(query))
          && (!institutionId || event.institution_id === institutionId)
          && (!departmentId || event.department_id === departmentId)
          && (!mode || event.event_mode === mode)
          && (timePeriod === 'all' || (timePeriod === 'upcoming' ? isUpcoming : !isUpcoming))
      })
      .sort((a, b) => {
        const difference = Date.parse(a.event_start) - Date.parse(b.event_start)
        return sort === 'latest' ? -difference : difference
      })
  }, [events, search, institutionId, departmentId, mode, timePeriod, sort, now])

  const clearFilters = () => {
    setSearch('')
    setInstitutionId('')
    setDepartmentId('')
    setMode('')
    setTimePeriod('upcoming')
    setSort('soonest')
  }

  return (
    <div className="events-page">
      <section className="events-intro">
        <div className="container">
          <span className="eyebrow">EVENT DISCOVERY</span>
          <h1>Explore university events</h1>
          <p>Find your next event, discover new experiences, and register with ease.</p>
          <div className="result-count">
            <span className="result-count-mark"><Icon name="calendar" size={17} /></span>
            <strong>{loading ? '—' : filteredEvents.length}</strong> {filteredEvents.length === 1 ? 'event' : 'events'} to explore
          </div>
        </div>
      </section>

      <section className="container events-content">
        <div className="filter-panel">
          <label className="search-field">
            <Icon name="search" size={19} />
            <input
              type="search"
              placeholder="Search events and descriptions..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search events"
            />
          </label>
          <div className="filter-controls">
            <label className="filter-select"><span className="sr-only">University</span>
              <select value={institutionId} onChange={(event) => { setInstitutionId(event.target.value); setDepartmentId('') }}>
                <option value="">All universities</option>
                {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="filter-select"><span className="sr-only">Department</span>
              <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                <option value="">All departments</option>
                {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="filter-select"><span className="sr-only">Event mode</span>
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="">All modes</option>
                {modes.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
              </select>
            </label>
            <label className="filter-select"><span className="sr-only">Event period</span>
              <select value={timePeriod} onChange={(event) => setTimePeriod(event.target.value)}>
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
                <option value="all">All published</option>
              </select>
            </label>
            <label className="filter-select filter-sort"><span className="sr-only">Sort events</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="soonest">Soonest first</option>
                <option value="latest">Latest first</option>
              </select>
            </label>
            <button type="button" className="clear-filters" onClick={clearFilters}>Clear filters</button>
          </div>
        </div>

        {countWarning && <p className="inline-notice" role="status">{countWarning}</p>}
        {error && (
          <div className="empty-state" role="alert">
            <h2>Events couldn’t load</h2>
            <p>{error}</p>
            <button className="button button-outline" type="button" onClick={() => { setLoading(true); setError(''); setCountWarning(''); setRetry((value) => value + 1) }}>Try again</button>
          </div>
        )}
        {loading && (
          <div className="event-grid events-grid" aria-label="Loading events" aria-busy="true">
            {Array.from({ length: 3 }, (_, index) => <div className="event-skeleton" key={index} />)}
          </div>
        )}
        {!loading && !error && filteredEvents.length > 0 && (
          <div className="event-grid events-grid">
            {filteredEvents.map((event) => (
              <EventCard key={event.id} event={event} registrationCount={counts[String(event.id)]} />
            ))}
          </div>
        )}
        {!loading && !error && filteredEvents.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon"><Icon name="search" size={25} /></span>
            <h2>No events found</h2>
            <p>Try a different search or clear your filters to see published events.</p>
            <button className="button button-outline" type="button" onClick={clearFilters}>Clear filters</button>
          </div>
        )}
      </section>
    </div>
  )
}

export default Events
