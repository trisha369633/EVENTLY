import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const invalidCredentials = { error: 'Invalid credentials.' }
const attempts = new Map<string, { count: number; resetAt: number }>()
const rateLimitWindowMs = 60_000
const maxAttemptsPerWindow = 8
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maxBodyBytes = 2048

function response(
  body: Record<string, unknown>,
  status: number,
  headers: HeadersInit,
) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}

function corsHeaders(origin: string | null) {
  const allowedOrigin = Deno.env.get('APP_ALLOWED_ORIGIN')
  return {
    'Access-Control-Allow-Origin': allowedOrigin || origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function isRateLimited(request: Request) {
  const now = Date.now()
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || 'unknown'
  const current = attempts.get(ip)

  if (!current || current.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + rateLimitWindowMs })
  } else if (current.count >= maxAttemptsPerWindow) {
    return true
  } else {
    current.count += 1
  }

  if (attempts.size > 5000) {
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key)
    }
  }
  return false
}

async function readSmallJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing request body.')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    totalBytes += value.byteLength
    if (totalBytes > maxBodyBytes) {
      await reader.cancel()
      throw new Error('Request body is too large.')
    }
    chunks.push(value)
  }

  const bodyBytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bodyBytes))
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)
  const configuredOrigin = Deno.env.get('APP_ALLOWED_ORIGIN')

  if (configuredOrigin && origin && origin !== configuredOrigin) {
    return response({ error: 'Origin not allowed.' }, 403, headers)
  }
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers })
  }
  if (request.method !== 'POST') {
    return response({ error: 'Method not allowed.' }, 405, headers)
  }
  if (Number(request.headers.get('content-length') || 0) > maxBodyBytes) {
    return response({ error: 'Invalid request.' }, 400, headers)
  }
  if (isRateLimited(request)) {
    return response({ error: 'Too many attempts. Try again shortly.' }, 429, headers)
  }

  let body: Record<string, unknown>
  try {
    const parsedBody = await readSmallJsonBody(request)
    if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
      return response({ error: 'Invalid request.' }, 400, headers)
    }
    body = parsedBody as Record<string, unknown>
  } catch {
    return response({ error: 'Invalid request.' }, 400, headers)
  }

  const identityNumber = typeof body.identity_number === 'string' ? body.identity_number.trim() : ''
  const institutionId = typeof body.institution_id === 'string' ? body.institution_id : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (
    identityNumber.length < 1
    || identityNumber.length > 128
    || !uuidPattern.test(institutionId)
    || password.length < 1
    || password.length > 256
  ) {
    return response({ error: 'Invalid request.' }, 400, headers)
  }

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const serverKey = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')
  if (!projectUrl || !serverKey || !publishableKey) {
    return response({ error: 'ID sign-in is temporarily unavailable.' }, 503, headers)
  }

  const adminClient = createClient(projectUrl, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const authClient = createClient(projectUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: identity, error: identityError } = await adminClient
    .from('user_identities')
    .select('user_id, is_verified')
    .eq('institution_id', institutionId)
    .eq('identity_number', identityNumber)
    .maybeSingle()
  if (identityError) {
    return response({ error: 'ID sign-in is temporarily unavailable.' }, 503, headers)
  }
  if (!identity?.user_id || !identity.is_verified) {
    return response(invalidCredentials, 401, headers)
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('email')
    .eq('id', identity.user_id)
    .maybeSingle()
  if (profileError) {
    return response({ error: 'ID sign-in is temporarily unavailable.' }, 503, headers)
  }
  if (!profile?.email) {
    return response(invalidCredentials, 401, headers)
  }

  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password,
  })
  if (authError || !authData.session) {
    return response(invalidCredentials, 401, headers)
  }

  const { access_token, refresh_token, expires_at, expires_in, token_type } = authData.session
  return response({
    session: { access_token, refresh_token, expires_at, expires_in, token_type },
  }, 200, headers)
})
