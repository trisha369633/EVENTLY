import { useEffect, useMemo, useState } from 'react'
import heroImage from '../../assets/hero.png'
import EventCard from '../../components/EventCard.jsx'
import Icon from '../../components/Icon.jsx'
import SectionHeading from '../../components/SectionHeading.jsx'
import { formatEventDate } from '../../lib/eventUtils.js'
import { getPublishedEvents, getPublicRegistrationCounts } from '../../services/eventService.js'

function Home() {
  const [events, setEvents] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [eventError, setEventError] = useState('')

  useEffect(() => {
    let active = true
    getPublishedEvents()
      .then(async (items) => {
        if (!active) return
        const upcoming = items.filter((event) => Date.parse(event.event_start) > Date.now())
        setEvents(upcoming)
        try {
          const nextCounts = await getPublicRegistrationCounts(upcoming.map((event) => event.id))
          if (active) setCounts(nextCounts)
        } catch {
          if (active) setCounts({})
        }
      })
      .catch((error) => {
        if (active) setEventError(error.message || 'Published events could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const departments = useMemo(() => [...new Set(events.map((event) => event.department_name).filter(Boolean))], [events])
  const nextEvent = events[0]

  return (
    <>
      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow hero-eyebrow"><span className="eyebrow-dot" /> THE FUTURE OF UNIVERSITY EVENTS</span>
            <h1>Every campus event.<br /><span>One simple platform.</span></h1>
            <p className="hero-description">
              Discover university events, register in minutes, manage your registrations, and experience every campus moment — all in one place.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/events">Explore Events <Icon name="arrow" size={18} /></a>
              <a className="button button-outline" href="/register">Get Started</a>
            </div>
            <div className="hero-trust"><span className="trust-avatars" aria-hidden="true"><i>S</i><i>T</i><i>A</i></span><span>Built for students, teachers &amp; alumni</span></div>
          </div>
          <div className="hero-visual">
            <div className="hero-image-frame">
              <img src={heroImage} alt="University students enjoying an event together" />
              <div className="hero-image-shade" />
              <div className="hero-image-caption">
                <span className="hero-caption-kicker">CAMPUS SPOTLIGHT</span>
                <strong>Make room for<br />a little wonder.</strong>
                <span className="caption-link">Explore what’s happening <Icon name="arrow" size={16} /></span>
              </div>
            </div>
            <div className="hero-date-card">
              <span className="mini-icon"><Icon name="calendar" size={18} /></span>
              <span><small>NEXT UP</small><strong>{nextEvent?.title || 'Your next event'}</strong><small>{nextEvent ? `${formatEventDate(nextEvent.event_start, { month: 'short', day: 'numeric' })} · ${nextEvent.institution_name}` : 'Explore campus events'}</small></span>
            </div>
            <div className="hero-ticket-card">
              <span className="ticket-icon"><Icon name="ticket" size={19} /></span>
              <span><strong>Your next story</strong><small>starts right here</small></span>
              <span className="ticket-arrow"><Icon name="arrow" size={16} /></span>
            </div>
            <span className="hero-sparkle" aria-hidden="true"><Icon name="sparkle" size={26} /></span>
            <span className="hero-orbit" aria-hidden="true" />
          </div>
        </div>
        <div className="hero-bottom container">
          <span>DISCOVER</span><i /><span>CONNECT</span><i /><span>EXPERIENCE</span>
        </div>
      </section>

      <section className="department-strip" aria-label="Departments supported">
        <div className="container department-strip-inner">
          <span>Events across your campus</span>
          <div className="department-list">
            {departments.slice(0, 6).map((department, index) => (
              <span key={department}>{index > 0 && <i aria-hidden="true" />}{department}</span>
            ))}
          </div>
          {!departments.length && !loading && <small>Explore published events from your institution</small>}
        </div>
      </section>

      <section className="featured-section section-space">
        <div className="container">
          <SectionHeading
            eyebrow="A GOOD PLACE TO START"
            title="Find your next campus experience"
            description="Explore upcoming events and be part of something memorable."
            action={<a className="text-link text-link-large" href="/events">View all events <Icon name="arrow" size={18} /></a>}
          />
          {loading && <div className="event-grid event-grid-featured" aria-busy="true">{Array.from({ length: 3 }, (_, index) => <div className="event-skeleton" key={index} />)}</div>}
          {eventError && <p className="inline-notice" role="status">{eventError}</p>}
          {!loading && !eventError && events.length > 0 && (
            <div className="event-grid event-grid-featured">
              {events.slice(0, 3).map((event) => <EventCard key={event.id} event={event} registrationCount={counts[String(event.id)]} />)}
            </div>
          )}
          {!loading && !eventError && events.length === 0 && <div className="empty-state"><h2>No upcoming events yet</h2><p>Check back soon for campus events.</p></div>}
        </div>
      </section>

      <section className="journey-section section-space">
        <div className="container">
          <SectionHeading
            eyebrow="THREE SIMPLE STEPS"
            title="Your event journey, made simple"
            description="From discovering an event to collecting your ticket."
            align="center"
          />
          <div className="journey-grid">
            <div className="journey-step"><div className="step-icon"><Icon name="compass" size={23} /></div><span className="step-number">01</span><h3>Discover events</h3><p>Find events from your university and departments.</p></div>
            <div className="journey-connector" aria-hidden="true" />
            <div className="journey-step"><div className="step-icon"><Icon name="check" size={23} /></div><span className="step-number">02</span><h3>Register</h3><p>Share your details securely and keep your registration in one place.</p></div>
            <div className="journey-connector" aria-hidden="true" />
            <div className="journey-step"><div className="step-icon"><Icon name="ticket" size={23} /></div><span className="step-number">03</span><h3>Track your event</h3><p>Find your registration details and event information in your dashboard.</p></div>
          </div>
        </div>
      </section>

      <section className="features-section section-space" id="about">
        <div className="container">
          <SectionHeading
            eyebrow="MADE FOR CAMPUS LIFE"
            title="Everything your event needs"
            description="Less time figuring things out. More time being part of it."
          />
          <div className="features-grid">
            <div className="feature-item"><div className="feature-icon"><Icon name="check" size={21} /></div><h3>Easy registration</h3><p>Sign up for university events without unnecessary hassle.</p></div>
            <div className="feature-item"><div className="feature-icon"><Icon name="shield" size={21} /></div><h3>Clear event fees</h3><p>Review the registration fee, then submit payment proof for verification when the event requires payment.</p></div>
            <div className="feature-item"><div className="feature-icon"><Icon name="ticket" size={21} /></div><h3>Registration details</h3><p>Keep your sign-ups and event information together.</p></div>
            <div className="feature-item"><div className="feature-icon"><Icon name="university" size={21} /></div><h3>Organized events</h3><p>A smoother event experience for participants and organizers.</p></div>
          </div>
        </div>
      </section>

      <section className="closing-cta">
        <span className="cta-accent" aria-hidden="true" />
        <div className="container closing-cta-inner">
          <div><span className="eyebrow eyebrow-light">THE CAMPUS IS CALLING</span><h2>Your next campus experience<br />starts here.</h2><p>Discover upcoming university events and be part of the excitement.</p></div>
          <a className="button button-light" href="/events">Explore Events <Icon name="arrow" size={18} /></a>
        </div>
      </section>
    </>
  )
}

export default Home