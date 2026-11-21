import { useEffect } from 'react'
import { navigate } from '../lib/navigation.js'
import { useAuth } from '../context/useAuth.js'

function ProtectedRoute({ children, roles: requiredRoles = [], unauthorizedRedirect }) {
  const { user, roles, loading, authError } = useAuth()
  const isAuthorized = !requiredRoles.length || requiredRoles.some((role) => roles.includes(role))
  const denialDestination = typeof unauthorizedRedirect === 'function'
    ? unauthorizedRedirect(roles)
    : unauthorizedRedirect

  useEffect(() => {
    if (!loading && !user) {
      const returnTo = `${window.location.pathname}${window.location.search}`
      navigate(`/login?next=${encodeURIComponent(returnTo)}`, { replace: true })
    } else if (!loading && user && !isAuthorized && denialDestination && window.location.pathname !== denialDestination) {
      navigate(denialDestination, { replace: true })
    }
  }, [loading, user, isAuthorized, denialDestination])

  if (loading) {
    return <section className="not-found container" aria-live="polite"><p>Restoring your Evently session…</p></section>
  }

  if (!user) {
    return <section className="not-found container" aria-live="polite"><p>Taking you to sign in…</p></section>
  }

  if (!isAuthorized && denialDestination) {
    return <section className="not-found container" aria-live="polite"><p>Redirecting to your Evently workspace…</p></section>
  }

  if (!isAuthorized) {
    return (
      <section className="not-found container">
        <span className="eyebrow">{authError ? 'ACCESS CHECK UNAVAILABLE' : 'ACCESS DENIED'}</span>
        <h1>{authError ? 'We couldn’t verify your platform access.' : 'This area isn’t available to your account.'}</h1>
        <p>{authError || 'Your current platform role does not grant access to this page.'}</p>
        <a className="button button-outline" href="/">Return to Evently</a>
      </section>
    )
  }

  return children
}

export default ProtectedRoute