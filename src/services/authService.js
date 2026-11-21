import { getSupabaseClient, setRememberSession } from '../lib/supabase.js'

const participantTypes = new Set(['student', 'teacher', 'alumni'])

export function getFriendlyAuthError(error, { idLogin = false } = {}) {
  const code = error?.code
  const message = String(error?.message || '').toLowerCase()

  if (
    code === 'SUPABASE_CONFIG'
    || message.includes('supabase is not configured')
    || message.includes('supabase_url')
    || message.includes('must use https')
  ) {
    return 'Authentication is not configured yet. Add the Supabase project URL and publishable key to .env.local.'
  }
  if (message.includes('server-only') || message.includes('publishable key')) {
    return 'Use a Supabase publishable key in the browser. Server-only keys must stay in Edge Function secrets.'
  }
  if (code === 'FUNCTION_NOT_DEPLOYED') {
    return 'Student / employee ID sign-in is not deployed yet. Use email sign-in or ask the administrator to deploy the login function.'
  }
  if (code === '23505' || code === 'IDENTITY_ALREADY_EXISTS') {
    return 'That student, employee, or alumni ID is already registered.'
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in. Check your inbox for the confirmation link.'
  }
  if (code === 'user_already_exists' || message.includes('user already registered') || message.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.'
  }
  if (code === 'weak_password' || message.includes('password should be') || message.includes('weak password')) {
    return 'Choose a stronger password with at least 8 characters.'
  }
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return idLogin
      ? 'The ID, institution, or password is incorrect.'
      : 'The email or password is incorrect.'
  }
  if (message.includes('failed to fetch') || message.includes('network') || error?.name === 'TypeError') {
    return 'We could not reach Supabase. Check your connection and try again.'
  }
  if (code === '42501' || message.includes('row-level security')) {
    return 'Your account was created, but identity setup was blocked by the database permissions. Contact your platform administrator.'
  }
  if (message.includes('function') && (message.includes('not found') || message.includes('404'))) {
    return 'Student / employee ID sign-in is not deployed yet. Use email sign-in or ask the administrator to deploy the login function.'
  }

  return 'We could not complete that request. Please try again.'
}

export async function registerWithEmail({ email, password, metadata }) {
  const identityType = String(metadata.identity_type || '').toLowerCase()
  if (!participantTypes.has(identityType)) {
    throw new Error('Choose Student, Teacher, or Alumni.')
  }

  const client = getSupabaseClient()
  setRememberSession(true)
  const safeMetadata = {
    full_name: String(metadata.full_name || '').trim(),
    phone: String(metadata.phone || '').trim(),
    institution_id: metadata.institution_id,
    department_id: metadata.department_id || null,
    identity_type: identityType,
    identity_number: String(metadata.identity_number || '').trim(),
  }
  const { data, error } = await client.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: safeMetadata,
      emailRedirectTo: `${window.location.origin}/login`,
    },
  })

  if (error) throw error
  return data
}

export async function signInWithEmail({ email, password, remember }) {
  const client = getSupabaseClient()
  setRememberSession(remember)
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) throw error
  return data
}

export async function signInWithIdentity({ identityNumber, institutionId, password, remember }) {
  const client = getSupabaseClient()
  setRememberSession(remember)
  const { data, error } = await client.functions.invoke('login-with-id', {
    body: {
      identity_number: identityNumber.trim(),
      institution_id: institutionId,
      password,
    },
  })

  if (error) {
    let responseMessage = ''
    const status = error.context?.status
    try {
      const body = await error.context?.json()
      responseMessage = body?.error || body?.message || ''
    } catch {
      responseMessage = ''
    }
    if (status === 404) {
      throw Object.assign(new Error('The student / employee ID login function has not been deployed.'), { code: 'FUNCTION_NOT_DEPLOYED' })
    }
    if (status === 401) {
      throw new Error(responseMessage || 'Invalid credentials.')
    }
    if (status >= 500) {
      throw new Error('The ID login service is temporarily unavailable.')
    }
    if (responseMessage) throw new Error(responseMessage)
    throw error
  }

  const accessToken = data?.session?.access_token
  const refreshToken = data?.session?.refresh_token
  if (!accessToken || !refreshToken) {
    throw new Error('The ID login function returned an invalid session.')
  }

  const { data: sessionData, error: sessionError } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (sessionError) throw sessionError
  return sessionData
}

export async function signOut() {
  const { error } = await getSupabaseClient().auth.signOut()
  if (error) throw error
}

export async function sendPasswordReset(email) {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/login`,
  })
  if (error) throw error
}