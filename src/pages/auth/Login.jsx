import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Brand } from '../../components/Navbar.jsx'
import { useAuth } from '../../context/useAuth.js'
import { getSafeRelativeRedirect, navigate } from '../../lib/navigation.js'
import { getFriendlyAuthError, sendPasswordReset } from '../../services/authService.js'
import { listInstitutions } from '../../services/profileService.js'

function getRoleDestination(roles) {
  if (roles.includes('super_admin')) return '/admin'
  if (roles.includes('volunteer')) return '/volunteer'
  if (roles.includes('participant')) return '/dashboard'
  return null
}

function Login() {
  const [mode, setMode] = useState('email')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [institutions, setInstitutions] = useState([])
  const [institutionsLoading, setInstitutionsLoading] = useState(false)
  const [institutionsError, setInstitutionsError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [errors, setErrors] = useState({})
  const { signIn, signInWithId, authError } = useAuth()

  useEffect(() => {
    if (mode !== 'id' || institutions.length) return undefined
    let active = true
    listInstitutions()
      .then((items) => {
        if (active) setInstitutions(items)
      })
      .catch((error) => {
        if (active) setInstitutionsError(getFriendlyAuthError(error))
      })
      .finally(() => {
        if (active) setInstitutionsLoading(false)
      })
    return () => {
      active = false
    }
  }, [mode, institutions.length])

  const handleSubmit = async (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const identity = String(formData.get('identity') || '').trim()
    const password = String(formData.get('password') || '')
    const institutionId = String(formData.get('institution') || '')
    const nextErrors = {}
    if (!identity) nextErrors.identity = mode === 'email' ? 'Enter your email address.' : 'Enter your student or employee ID.'
    if (mode === 'email' && identity && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) nextErrors.identity = 'Enter a valid email address.'
    if (mode === 'id' && !institutionId) nextErrors.institution = 'Select your institution.'
    if (!password) nextErrors.password = 'Enter your password.'
    setErrors(nextErrors)
    setFeedback(null)
    if (Object.keys(nextErrors).length) return

    setBusy(true)
    try {
      const result = mode === 'email'
        ? await signIn({ email: identity, password, remember: formData.get('remember') === 'on' })
        : await signInWithId({
          identityNumber: identity,
          institutionId,
          password,
          remember: formData.get('remember') === 'on',
        })

      const params = new URLSearchParams(window.location.search)
      const next = params.get('next')
      const safeNext = getSafeRelativeRedirect(next)
      const destination = safeNext || getRoleDestination(result.roles)
      if (destination) {
        navigate(destination, { replace: true })
      } else {
        setFeedback({
          type: 'error',
          message: 'You signed in, but this account has no recognized platform role. Ask an administrator to review your access.',
        })
      }
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || getFriendlyAuthError(error, { idLogin: mode === 'id' }) })
    } finally {
      setBusy(false)
    }
  }

  const selectMode = (nextMode) => {
    setMode(nextMode)
    setErrors({})
    setFeedback(null)
    if (nextMode === 'id' && !institutions.length) {
      setInstitutionsLoading(true)
      setInstitutionsError('')
    }
  }

  const handleForgotPassword = async () => {
    if (mode !== 'email') {
      setFeedback({ type: 'error', message: 'Switch to Email Login and enter your email address to request a reset link.' })
      return
    }
    const email = document.querySelector('input[name="identity"]')?.value.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors((current) => ({ ...current, identity: 'Enter a valid email address first.' }))
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      await sendPasswordReset(email)
      setFeedback({ type: 'success', message: 'If an account exists for that email, a password reset link is on its way.' })
    } catch (error) {
      setFeedback({ type: 'error', message: getFriendlyAuthError(error) })
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
            <span className="eyebrow eyebrow-light">EVERY EVENT. ONE PLATFORM.</span>
            <h1>Welcome back.</h1>
            <p>Your next campus experience is just a step away.</p>
            <div className="auth-illustration" aria-hidden="true">
              <div className="auth-illustration-ring" />
              <div className="auth-illustration-card"><Icon name="calendar" size={24} /><span><strong>Something good</strong><small>is happening soon</small></span><Icon name="arrow" size={18} /></div>
              <span className="auth-illustration-dot dot-one" /><span className="auth-illustration-dot dot-two" />
            </div>
          </div>
          <span className="auth-tagline">Make every campus moment count.</span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <a href="/" className="auth-back-link">← <span>Back to Evently</span></a>
          <span className="eyebrow">YOUR CAMPUS, CONNECTED</span>
          <h2>Sign in to Evently</h2>
          <p className="auth-subtitle">Access your events, tickets, and registrations.</p>
          {authError && <div className="form-feedback" role="status">{authError}</div>}
          {feedback && <div className={`form-feedback${feedback.type === 'success' ? ' success-feedback' : ''}`} role="status">{feedback.message}</div>}
          <div className="auth-mode-switch" role="group" aria-label="Choose sign-in method">
            <button type="button" className={mode === 'email' ? 'selected' : ''} aria-pressed={mode === 'email'} onClick={() => selectMode('email')}>Email Login</button>
            <button type="button" className={mode === 'id' ? 'selected' : ''} aria-pressed={mode === 'id'} onClick={() => selectMode('id')}>Student / Employee ID</button>
          </div>
          <form onSubmit={handleSubmit} noValidate>
            {mode === 'id' && (
              <label className="form-field">
                <span>Institution</span>
                <select name="institution" defaultValue="" aria-invalid={Boolean(errors.institution)} disabled={institutionsLoading}>
                  <option value="" disabled>{institutionsLoading ? 'Loading institutions…' : 'Select institution'}</option>
                  {institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
                </select>
                {errors.institution && <small className="field-error">{errors.institution}</small>}
                {institutionsError && <small className="field-error">{institutionsError}</small>}
              </label>
            )}
            <label className="form-field">
              <span>{mode === 'email' ? 'Email address' : 'Student / Employee ID'}</span>
              <input
                name="identity"
                autoComplete={mode === 'email' ? 'username' : 'off'}
                placeholder={mode === 'email' ? 'you@university.edu' : 'Enter your ID'}
                aria-invalid={Boolean(errors.identity)}
              />
              {errors.identity && <small className="field-error">{errors.identity}</small>}
            </label>
            <label className="form-field">
              <span>Password</span>
              <span className="password-wrap">
                <input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" aria-invalid={Boolean(errors.password)} />
                <button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}><Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} /></button>
              </span>
              {errors.password && <small className="field-error">{errors.password}</small>}
            </label>
            <div className="form-options">
              <label className="check-option"><input type="checkbox" name="remember" defaultChecked /><span>Remember session</span></label>
              <button className="inline-button" type="button" onClick={() => void handleForgotPassword()} disabled={busy}>Forgot password?</button>
            </div>
            <button className="button button-primary button-wide auth-submit" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'} {!busy && <Icon name="arrow" size={18} />}
            </button>
          </form>
          <p className="auth-switch">Don’t have an account? <a href="/register">Create account</a></p>
          <p className="auth-demo-note"><Icon name="shield" size={15} /> Sign-in methods use your EVENTLY account.</p>
        </div>
      </section>
    </main>
  )
}

export default Login
