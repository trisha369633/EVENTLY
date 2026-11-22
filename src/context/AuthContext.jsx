import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext } from './authContextInstance.js'
import { getSupabaseClient, getSupabaseConfigurationError } from '../lib/supabase.js'
import { getFriendlyAuthError, registerWithEmail, signInWithEmail, signInWithIdentity, signOut } from '../services/authService.js'
import { ensureUserIdentity, getUserIdentity } from '../services/identityService.js'
import { getProfile } from '../services/profileService.js'
import { getPlatformRoles } from '../services/roleService.js'

export function AuthProvider({ children }) {
  const [configurationError] = useState(() => {
    const message = getSupabaseConfigurationError()
    return message ? getFriendlyAuthError(new Error(message)) : ''
  })
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [roles, setRoles] = useState([])
  const [participantType, setParticipantType] = useState(null)
  const [loading, setLoading] = useState(!configurationError)
  const [authError, setAuthError] = useState(configurationError)
  const accessUserIdRef = useRef('')

  const loadUserAccess = useCallback(async (currentUser, isActive = () => true) => {
    accessUserIdRef.current = currentUser.id
    try {
      const ensuredIdentity = await ensureUserIdentity(currentUser)
      const [nextProfile, nextRoles, identity] = await Promise.all([
        getProfile(currentUser.id),
        getPlatformRoles(currentUser.id),
        ensuredIdentity ? Promise.resolve(ensuredIdentity) : getUserIdentity(currentUser.id),
      ])
      const access = {
        profile: nextProfile,
        roles: nextRoles,
        participantType: identity?.identity_type || null,
      }

      if (isActive()) {
        setProfile(access.profile)
        setRoles(access.roles)
        setParticipantType(access.participantType)
        setAuthError('')
      }
      return access
    } catch (error) {
      if (isActive()) {
        setProfile(null)
        setRoles([])
        setParticipantType(null)
        setAuthError(getFriendlyAuthError(error))
      }
      return null
    } finally {
      if (isActive()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    let hydrationTimer
    let client

    try {
      client = getSupabaseClient()
    } catch {
      return () => {
        active = false
      }
    }

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      const nextUser = nextSession?.user || null
      if (nextUser && accessUserIdRef.current === nextUser.id) {
        setSession(nextSession)
        setUser(nextUser)
        return
      }
      window.clearTimeout(hydrationTimer)
      setSession(nextSession)
      setUser(nextUser)
      setAuthError('')

      if (nextUser) {
        accessUserIdRef.current = nextUser.id
        setLoading(true)
        hydrationTimer = window.setTimeout(() => {
          void loadUserAccess(nextUser, () => active)
        }, 0)
      } else {
        accessUserIdRef.current = ''
        setProfile(null)
        setRoles([])
        setParticipantType(null)
        setLoading(false)
      }
    })

    return () => {
      active = false
      window.clearTimeout(hydrationTimer)
      subscription.unsubscribe()
    }
  }, [loadUserAccess])

  const signUp = useCallback(async (input) => {
    setAuthError('')
    try {
      const result = await registerWithEmail(input)
      if (result.session && result.user) {
        await ensureUserIdentity(result.user)
        const access = await loadUserAccess(result.user)
        return { ...result, roles: access?.roles || [] }
      }
      return result
    } catch (error) {
      const message = getFriendlyAuthError(error)
      throw new Error(message)
    }
  }, [loadUserAccess])

  const signIn = useCallback(async ({ email, password, remember }) => {
    setAuthError('')
    try {
      const result = await signInWithEmail({ email, password, remember })
      const access = result.user ? await loadUserAccess(result.user) : null
      return { ...result, roles: access?.roles || [] }
    } catch (error) {
      const message = getFriendlyAuthError(error)
      throw new Error(message)
    }
  }, [loadUserAccess])

  const signInWithId = useCallback(async (input) => {
    setAuthError('')
    try {
      const result = await signInWithIdentity(input)
      const access = result.user ? await loadUserAccess(result.user) : null
      return { ...result, roles: access?.roles || [] }
    } catch (error) {
      const message = getFriendlyAuthError(error, { idLogin: true })
      throw new Error(message)
    }
  }, [loadUserAccess])

  const refreshUserProfile = useCallback(async () => {
    if (!user) return null
    const nextProfile = await getProfile(user.id)
    setProfile(nextProfile)
    return nextProfile
  }, [user])

  const refreshPermissions = useCallback(async () => {
    if (!user) return { roles: [], participantType: null }
    const [nextRoles, identity] = await Promise.all([
      getPlatformRoles(user.id),
      getUserIdentity(user.id),
    ])
    setRoles(nextRoles)
    setParticipantType(identity?.identity_type || null)
    return { roles: nextRoles, participantType: identity?.identity_type || null }
  }, [user])

  const logOut = useCallback(async () => {
    setAuthError('')
    try {
      await signOut()
    } catch (error) {
      const message = getFriendlyAuthError(error)
      setAuthError(message)
      throw new Error(message)
    }
  }, [])

  const value = useMemo(() => ({
    session,
    user,
    profile,
    roles,
    participantType,
    loading,
    authError,
    signUp,
    signIn,
    signInWithId,
    signOut: logOut,
    refreshUserProfile,
    refreshPermissions,
  }), [
    session,
    user,
    profile,
    roles,
    participantType,
    loading,
    authError,
    signUp,
    signIn,
    signInWithId,
    logOut,
    refreshUserProfile,
    refreshPermissions,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}