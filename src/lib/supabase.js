import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim()
const rememberSessionKey = 'evently:remember-session'

let supabaseClient

const authStorage = {
  getItem(key) {
    if (typeof window === 'undefined') return null
    const primary = window.localStorage.getItem(rememberSessionKey) === 'true'
      ? window.localStorage
      : window.sessionStorage
    const fallback = primary === window.localStorage ? window.sessionStorage : window.localStorage
    return primary.getItem(key) ?? fallback.getItem(key)
  },
  setItem(key, value) {
    if (typeof window === 'undefined') return
    const primary = window.localStorage.getItem(rememberSessionKey) === 'true'
      ? window.localStorage
      : window.sessionStorage
    const fallback = primary === window.localStorage ? window.sessionStorage : window.localStorage
    primary.setItem(key, value)
    fallback.removeItem(key)
  },
  removeItem(key) {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
    window.sessionStorage.removeItem(key)
  },
}

function isServerKey(key) {
  if (key.startsWith('sb_secret_')) return true

  try {
    const payload = key.split('.')[1]
    if (!payload) return false
    const encodedPayload = payload.replaceAll('-', '+').replaceAll('_', '/')
    const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=')
    const decoded = JSON.parse(atob(paddedPayload))
    return decoded.role === 'service_role'
  } catch {
    return false
  }
}

function validateSupabaseConfig() {
  const missing = []
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!publishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (missing.length) {
    throw new Error(`Supabase is not configured. Add ${missing.join(' and ')} to .env.local.`)
  }

  let parsedUrl
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid Supabase project URL.')
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
    throw new Error('VITE_SUPABASE_URL must use HTTPS.')
  }
  if (isServerKey(publishableKey)) {
    throw new Error('A server-only Supabase key cannot be used in the browser. Use a publishable key.')
  }
}

export function getSupabaseConfigurationError() {
  try {
    validateSupabaseConfig()
    return ''
  } catch (error) {
    return error.message
  }
}

export function getSupabaseClient() {
  validateSupabaseConfig()

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: authStorage,
      },
    })
  }

  return supabaseClient
}

export function setRememberSession(remember) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(rememberSessionKey, String(Boolean(remember)))
  }
}
