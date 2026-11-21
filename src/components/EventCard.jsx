import { useState } from 'react'
import fallbackImage from '../assets/hero.png'
import { formatEventDate, formatFee, formatEventDateTime, getRegistrationAvailability, getStartingFee } from '../lib/eventUtils.js'
import Icon from './Icon.jsx'
import StatusBadge from './StatusBadge.jsx'

function EventCard({ event, registrationCount }) {
  const [imageSource, setImageSource] = useState(event.cover_image_url || fallbackImage)
  const availability = getRegistrationAvailability(event, registrationCount)
  const eventUrl = `/events/${encodeURIComponent(event.slug)}`
  const department = event.department_name

  return (
    <article className="event-card">
      <a className="event-card-image" href={eventUrl} aria-label={`View ${event.title}`}>
        <img
          src={imageSource}
          alt={`${event.title} event`}
          loading="lazy"
          onError={() => setImageSource(fallbackImage)}
        />
        <span className="category-tag">{event.event_mode}</span>
      </a>
      <div className="event-card-body">
        <div className="event-card-status"><StatusBadge status={availability.state} /></div>
        <h3><a href={eventUrl}>{event.title}</a></h3>
        <p className="event-card-university">{department ? `${department} · ` : ''}{event.institution_name}</p>
        <p className="event-card-description">{event.short_description}</p>
        <div className="event-card-facts">
          <span><Icon name="location" size={15} />{event.venue}</span>
          <span><Icon name="clock" size={15} />Closes {formatEventDateTime(event.registration_deadline)}</span>
        </div>
        <div className="event-card-footer">
          <span className="event-date"><Icon name="calendar" size={16} />{formatEventDate(event.event_start)}</span>
          <a className="text-link" href={eventUrl} aria-label={`Details for ${event.title}`}>
            Details <Icon name="arrow" size={16} />
          </a>
        </div>
        <div className="event-card-extra">
          <span>Starting from <strong>{formatFee(getStartingFee(event))}</strong></span>
          {event.seat_limit !== null && <span>{availability.remaining === null ? `Up to ${event.seat_limit} seats` : `${availability.remaining} left`}</span>}
        </div>
      </div>
    </article>
  )
}

export default EventCard