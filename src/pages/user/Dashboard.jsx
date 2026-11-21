import { useAuth } from '../../context/useAuth.js'
import MyEvents from './MyEvents.jsx'

function Dashboard() {
  const { profile } = useAuth()
  return (
    <div className="container user-dashboard">
      <div className="user-page-heading"><div><span className="eyebrow">PARTICIPANT DASHBOARD</span><h1>{profile?.full_name ? `Welcome, ${profile.full_name}` : 'Welcome to Evently'}</h1><p>Keep track of your registrations and find your next campus event.</p></div><a className="button button-primary" href="/events">Explore events</a></div>
      <MyEvents compact />
    </div>
  )
}

export default Dashboard