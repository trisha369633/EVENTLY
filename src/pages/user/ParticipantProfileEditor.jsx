import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { getParticipantProfileEditorData, saveParticipantProfileIdentity } from '../../services/profileService.js'
import './ParticipantProfileEditor.css'

const participantTypes = ['student', 'teacher', 'alumni']

function getSaveErrorMessage(error) {
  const message = String(error?.message || error?.details || '')
  if (error?.code === '23505' || /duplicate key|identity[\s_-]*number.*already|already.*identity[\s_-]*number/i.test(message)) {
    return 'This student / employee ID is already in use. Check the number and try again.'
  }
  if (error?.code === '23503' || error?.code === '23514') {
    return 'The selected participant type, institution, or department is not valid. Review your academic details.'
  }
  return message || 'Your changes could not be saved. Please try again.'
}

function ParticipantProfileEditor({ user, profile, onClose, onSaved }) {
  const [values, setValues] = useState({
    full_name: '',
    email: user.email || '',
    phone: '',
    identity_type: '',
    institution_id: '',
    department_id: '',
    identity_number: '',
  })
  const [loadedProfile, setLoadedProfile] = useState(null)
  const [institutions, setInstitutions] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [nameError, setNameError] = useState('')
  const [saving, setSaving] = useState(false)
  const fullNameRef = useRef(null)
  const closeButtonRef = useRef(null)
  const dialogRef = useRef(null)
  const visibleDepartments = useMemo(
    () => departments.filter((department) => String(department.institution_id) === values.institution_id),
    [departments, values.institution_id],
  )

  useEffect(() => {
    let active = true
    closeButtonRef.current?.focus()
    getParticipantProfileEditorData(user.id)
      .then(({ profile: nextProfile, identity, institutions: nextInstitutions, departments: nextDepartments }) => {
        if (!active) return
        setLoadedProfile(nextProfile || profile)
        setInstitutions(nextInstitutions)
        setDepartments(nextDepartments)
        setValues({
          full_name: nextProfile?.full_name || '',
          email: nextProfile?.email || user.email || '',
          phone: nextProfile?.phone || '',
          identity_type: participantTypes.includes(identity?.identity_type) ? identity.identity_type : '',
          institution_id: identity?.institution_id == null ? '' : String(identity.institution_id),
          department_id: identity?.department_id == null ? '' : String(identity.department_id),
          identity_number: identity?.identity_number || '',
        })
        setLoadError('')
      })
      .catch((error) => {
        if (active) setLoadError(error?.message || 'Your profile details could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [user, profile])

  useEffect(() => {
    if (!loading && !loadError) fullNameRef.current?.focus()
  }, [loading, loadError])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleDialogKeyDown = (event) => {
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const updateValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setSaveError('')
    if (key === 'full_name') setNameError('')
  }

  const handleSave = async (event) => {
    event.preventDefault()
    const fullName = values.full_name.trim()
    if (!fullName) {
      setNameError('Full name is required.')
      fullNameRef.current?.focus()
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      await saveParticipantProfileIdentity({ ...values, full_name: fullName })
      onSaved({
        ...(loadedProfile || profile || {}),
        full_name: fullName,
        phone: values.phone.trim(),
        email: values.email,
      }, values.identity_type)
    } catch (error) {
      setSaveError(getSaveErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="participant-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="participant-profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="participant-profile-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="participant-profile-header">
          <div>
            <span className="participant-profile-eyebrow">YOUR ACCOUNT</span>
            <h2 id="participant-profile-title">Edit profile</h2>
          </div>
          <button ref={closeButtonRef} className="participant-profile-close" type="button" aria-label="Close profile editor" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        {loading ? (
          <p className="participant-profile-loading" role="status">Loading your profile…</p>
        ) : loadError ? (
          <div className="participant-profile-error" role="alert">{loadError}</div>
        ) : (
          <form className="participant-profile-form" onSubmit={handleSave} noValidate>
            <label className="participant-profile-field">
              <span>Full name <span aria-hidden="true">*</span></span>
              <input
                ref={fullNameRef}
                autoComplete="name"
                required
                value={values.full_name}
                onChange={(event) => updateValue('full_name', event.target.value)}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'participant-full-name-error' : undefined}
              />
              {nameError && <small id="participant-full-name-error" className="participant-profile-field-error">{nameError}</small>}
            </label>

            <label className="participant-profile-field">
              <span>Email</span>
              <input type="email" value={values.email} readOnly aria-readonly="true" />
            </label>

            <label className="participant-profile-field">
              <span>Phone number</span>
              <input
                type="tel"
                autoComplete="tel"
                value={values.phone}
                onChange={(event) => updateValue('phone', event.target.value)}
              />
            </label>

            <label className="participant-profile-field">
              <span>Participant type</span>
              <select value={values.identity_type} onChange={(event) => updateValue('identity_type', event.target.value)}>
                <option value="">Select type</option>
                {participantTypes.map((type) => <option value={type} key={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
              </select>
            </label>

            <label className="participant-profile-field">
              <span>University / Institution</span>
              <select
                value={values.institution_id}
                onChange={(event) => {
                  updateValue('institution_id', event.target.value)
                  updateValue('department_id', '')
                }}
              >
                <option value="">Select institution</option>
                {institutions.map((institution) => (
                  <option value={String(institution.id)} key={institution.id}>{institution.name}</option>
                ))}
              </select>
            </label>

            <label className="participant-profile-field">
              <span>Department</span>
              <select
                value={values.department_id}
                onChange={(event) => updateValue('department_id', event.target.value)}
                disabled={!values.institution_id}
              >
                <option value="">Select department</option>
                {visibleDepartments.map((department) => (
                  <option value={String(department.id)} key={department.id}>
                    {department.code ? `${department.name} (${department.code})` : department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="participant-profile-field participant-profile-field-wide">
              <span>Student / Employee ID</span>
              <input
                value={values.identity_number}
                onChange={(event) => updateValue('identity_number', event.target.value)}
                autoComplete="off"
              />
            </label>

            {saveError && <div className="participant-profile-error participant-profile-save-error" role="alert">{saveError}</div>}

            <footer className="participant-profile-actions">
              <button className="participant-profile-cancel" type="button" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="button button-primary participant-profile-save" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}

export default ParticipantProfileEditor
