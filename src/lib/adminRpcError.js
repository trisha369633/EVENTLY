function getErrorText(value, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function isNetworkFailure(error, message) {
  return error?.status === 0
    || error?.name === 'AbortError'
    || (error?.name === 'TypeError' && /fetch|network|connection/i.test(message))
}

export function formatAdminRpcError(error, operation) {
  const code = getErrorText(error?.code, 40)
  const message = getErrorText(error?.message)
  const details = getErrorText(error?.details)
  const hint = getErrorText(error?.hint)
  const searchableErrorText = `${message} ${details}`.toLowerCase()
  const matchesOperation = searchableErrorText.includes(operation.toLowerCase())
  let userMessage

  if (['PGRST202', '42883'].includes(code) && matchesOperation) {
    userMessage = `Supabase could not resolve ${operation} through its API schema. Verify the RPC signature and refresh the PostgREST schema cache; this does not prove the migration is missing.`
  } else if (code === '42501' || error?.status === 401 || error?.status === 403) {
    userMessage = 'Supabase denied this operation. Confirm that the signed-in account has Super Admin access.'
  } else if (isNetworkFailure(error, message)) {
    userMessage = 'Supabase could not be reached. Check the network connection and retry.'
  } else if (code.startsWith('22') || ['P0002', '23505'].includes(code)) {
    userMessage = 'Supabase rejected the request. Check the selected user and supplied values, then retry.'
  } else {
    userMessage = 'The Supabase request failed. Retry or ask a developer to inspect the diagnostic details.'
  }

  return {
    userMessage,
    diagnostic: {
      operation,
      code: code || 'not provided',
      message: message || 'not provided',
      details,
      hint,
      status: Number.isInteger(error?.status) ? error.status : null,
    },
  }
}
