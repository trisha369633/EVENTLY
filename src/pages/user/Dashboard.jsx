import { useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useAuth } from '../../context/useAuth.js'
import MyEvents from './MyEvents.jsx'
import ParticipantProfileEditor from './ParticipantProfileEditor.jsx'

function Dashboard() {
  const { user, profile, updateParticipantProfile } = useAuth()
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileUpdated, setProfileUpdated] = useState(false)
  const editButtonRef = useRef(null)

  const closeProfileEditor = () => {
    setEditingProfile(false)
    window.requestAnimationFrame(() => editButtonRef.current?.focus())
  }

  const handleProfileSaved = (nextProfile, identityType) => {
    updateParticipantProfile(nextProfile, identityType)
    setProfileUpdated(true)
    closeProfileEditor()
  }

  return (
    <div className="container user-dashboard">
      <div className="user-page-heading">
        <div>
          <span className="eyebrow">PARTICIPANT DASHBOARD</span>
          <div className="user-dashboard-greeting">
            <h1>{profile?.full_name ? `Welcome, ${profile.full_name}` : 'Welcome to Evently'}</h1>
            <button
              ref={editButtonRef}
              className="profile-edit-trigger"
              type="button"
              aria-label="Edit profile and academic identity"
              title="Edit profile"
              onClick={() => {
                setProfileUpdated(false)
                setEditingProfile(true)
              }}
            >
              <Icon name="edit" size={17} />
            </button>
          </div>
          <p>Keep track of your registrations and find your next campus event.</p>
          {profileUpdated && <p className="profile-update-confirmation" role="status">Profile updated.</p>}
        </div>
        <a className="button button-primary" href="/events">Explore events</a>
      </div>
      <MyEvents compact />
      {editingProfile && user && (
        <ParticipantProfileEditor
          user={user}
          profile={profile}
          onClose={closeProfileEditor}
          onSaved={handleProfileSaved}
        />
      )}
    </div>
  )
}

export default Dashboard