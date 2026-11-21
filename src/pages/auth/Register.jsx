import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Brand } from '../../components/Navbar.jsx'
import { useAuth } from '../../context/useAuth.js'
import { navigate } from '../../lib/navigation.js'
import { getFriendlyAuthError } from '../../services/authService.js'
import { listDepartments, listInstitutions } from '../../services/profileService.js'

function getRoleDestination(roles) {
  if (roles.includes('super_admin')) return '/admin'
  if (roles.includes('volunteer')) return '/volunteer'
  if (roles.includes('participant')) return '/dashboard'
  return null
}

function Register() {
  const [busy, setBusy] = useState(false)
  const [institutions, setInstitutions] = useState([])
  const [departments, setDepartments] = useState([])
  const [institutionId, setInstitutionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [lookupLoading, setLookupLoading] = useState(true)
  const [departmentsLoading, setDepartmentsLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [success, setSuccess] = useState('')
  const [errors, setErrors] = useState({})
  const { signUp, authError } = useAuth()

  useEffect(() => {
    let active = true
    listInstitutions()
      .then((items) => {
        if (active) setInstitutions(items)
      })
      .catch((error) => {
        if (active) setLookupError(getFriendlyAuthError(error))
      })
      .finally(() => {
        if (active) setLookupLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!institutionId) return undefined
    let active = true
    listDepartments(institutionId)
      .then((items) => {
        if (active) setDepartments(items)
      })
      .catch((error) => {
        if (active) setLookupError(getFriendlyAuthError(error))
      })
      .finally(() => {
        if (active) setDepartmentsLoading(false)
      })
    return () => {
      active = false
    }
  }, [institutionId])

  const handleSubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    const nextErrors = {}
    const required = ['fullName', 'email', 'phone', 'institution', 'participantType', 'identityNumber', 'password', 'confirmPassword']
    required.forEach((key) => {
      if (!String(values[key] || '').trim()) nextErrors[key] = 'This field is required.'
    })
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email))) nextErrors.email = 'Enter a valid email address.'
    const phoneDigits = String(values.phone || '').replace(/\D/g, '')
    if (values.phone && (phoneDigits.length < 8 || phoneDigits.length > 15 || !/^[+\d\s().-]+$/.test(String(values.phone)))) nextErrors.phone = 'Enter a valid phone number.'
    if (values.password && String(values.password).length < 8) nextErrors.password = 'Use at least 8 characters.'
    if (values.password && values.confirmPassword && values.password !== values.confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.'
    if (values.institution && !values.department) nextErrors.department = 'Select a department.'
    setErrors(nextErrors)
    setSuccess('')
    if (Object.keys(nextErrors).length) return

    setBusy(true)
    try {
      const result = await signUp({
        email: values.email,
        password: values.password,
        metadata: {
          full_name: String(values.fullName).trim(),
          phone: String(values.phone).trim(),
          institution_id: values.institution,
          department_id: values.department || null,
          identity_type: values.participantType,
          identity_number: String(values.identityNumber).trim(),
        },
      })
      form.reset()
      setInstitutionId('')
      setDepartmentId('')
      setDepartments([])
      setDepartmentsLoading(false)
      setErrors({})
      if (result.session) {
        const destination = getRoleDestination(result.roles || [])
        if (destination) {
          navigate(destination, { replace: true })
          return
        }
        setSuccess('Your account was created and signed in, but a platform role is not available yet. Contact an administrator.')
      } else {
        setSuccess('If this email is new, check your inbox for a confirmation link. If you already have an account, sign in instead. Your identity details will be added after confirmation.')
      }
    } catch (error) {
      setSuccess('')
      setErrors((current) => ({ ...current, submit: error.message || getFriendlyAuthError(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-content">
          <Brand inverse />
          <div className="auth-brand-copy">
            <span className="eyebrow eyebrow-light">FIND YOUR PEOPLE. FIND YOUR EVENT.</span>
            <h1>Make campus<br />feel a little closer.</h1>
            <p>One account brings your university experiences together — from the first RSVP to the final encore.</p>
            <div className="register-note"><span className="register-note-icon"><Icon name="people" size={20} /></span><span><strong>Made for your campus life</strong><small>Students, teachers &amp; alumni welcome</small></span></div>
          </div>
          <span className="auth-tagline">Every Event. One Platform.</span>
        </div>
      </section>
      <section className="auth-form-panel register-form-panel">
        <div className="auth-form-wrap register-form-wrap">
          <a href="/" className="auth-back-link">← <span>Back to Evently</span></a>
          <span className="eyebrow">GET STARTED</span>
          <h2>Create your account</h2>
          <p className="auth-subtitle">Join your campus community on Evently.</p>
          {authError && <div className="form-feedback" role="status">{authError}</div>}
          {lookupError && <div className="form-feedback" role="alert">{lookupError}</div>}
          {success && <div className="form-feedback success-feedback" role="status">{success}</div>}
          {errors.submit && <div className="form-feedback" role="alert">{errors.submit}</div>}
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-grid">
              <label className="form-field">
                <span>Full name</span>
                <input name="fullName" autoComplete="name" placeholder="Your full name" aria-invalid={Boolean(errors.fullName)} />
                {errors.fullName && <small className="field-error">{errors.fullName}</small>}
              </label>
              <label className="form-field">
                <span>Email address</span>
                <input name="email" type="email" autoComplete="email" placeholder="you@university.edu" aria-invalid={Boolean(errors.email)} />
                {errors.email && <small className="field-error">{errors.email}</small>}
              </label>
              <label className="form-field">
                <span>Phone number</span>
                <input name="phone" type="tel" autoComplete="tel" placeholder="+880 1XXX-XXXXXX" aria-invalid={Boolean(errors.phone)} />
                {errors.phone && <small className="field-error">{errors.phone}</small>}
              </label>
              <label className="form-field">
                <span>Institution / University</span>
                <select
                  name="institution"
                  value={institutionId}
                  onChange={(event) => {
                    setInstitutionId(event.target.value)
                    setDepartmentId('')
                    setDepartments([])
                    setDepartmentsLoading(true)
                    setLookupError('')
                    setErrors((current) => ({ ...current, institution: '', department: '' }))
                  }}
                  aria-invalid={Boolean(errors.institution)}
                  disabled={lookupLoading || institutions.length === 0}
                >
                  <option value="">{lookupLoading ? 'Loading institutions…' : 'Select institution'}</option>
                  {institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
                </select>
                {errors.institution && <small className="field-error">{errors.institution}</small>}
              </label>
              <label className="form-field">
                <span>Department</span>
                <select
                  name="department"
                  value={departmentId}
                  onChange={(event) => {
                    setDepartmentId(event.target.value)
                    setErrors((current) => ({ ...current, department: '' }))
                  }}
                  aria-invalid={Boolean(errors.department)}
                  disabled={!institutionId || departmentsLoading}
                >
                  <option value="">{departmentsLoading ? 'Loading departments…' : 'Select department'}</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
                {errors.department && <small className="field-error">{errors.department}</small>}
              </label>
              <fieldset className="form-field participant-field">
                <legend>Participant type</legend>
                <div className="participant-options">
                  <label><input type="radio" name="participantType" value="student" /><span>Student</span></label>
                  <label><input type="radio" name="participantType" value="teacher" /><span>Teacher</span></label>
                  <label><input type="radio" name="participantType" value="alumni" /><span>Alumni</span></label>
                </div>
                {errors.participantType && <small className="field-error">{errors.participantType}</small>}
              </fieldset>
              <label className="form-field">
                <span>Student / Employee / Alumni ID <small className="optional-hint">(required for identity verification)</small></span>
                <input name="identityNumber" placeholder="ID number for your participant type" aria-invalid={Boolean(errors.identityNumber)} />
                {errors.identityNumber && <small className="field-error">{errors.identityNumber}</small>}
              </label>
              <label className="form-field">
                <span>Password</span>
                <input name="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" aria-invalid={Boolean(errors.password)} />
                {errors.password && <small className="field-error">{errors.password}</small>}
              </label>
              <label className="form-field form-field-last">
                <span>Confirm password</span>
                <input name="confirmPassword" type="password" autoComplete="new-password" placeholder="Enter password again" aria-invalid={Boolean(errors.confirmPassword)} />
                {errors.confirmPassword && <small className="field-error">{errors.confirmPassword}</small>}
              </label>
            </div>
            <button className="button button-primary button-wide auth-submit" type="submit" disabled={busy || lookupLoading || Boolean(lookupError)}>
              {busy ? 'Creating account…' : 'Create account'} {!busy && <Icon name="arrow" size={18} />}
            </button>
          </form>
          <p className="auth-switch">Already have an account? <a href="/login">Sign in</a></p>
          <p className="auth-demo-note"><Icon name="shield" size={15} /> Your password is handled only by Supabase Auth.</p>
        </div>
      </section>
    </main>
  )
}

export default Register
