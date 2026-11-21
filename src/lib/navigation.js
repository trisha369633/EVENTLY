export function navigate(path, { replace = false } = {}) {
  if (replace) {
    window.history.replaceState({}, '', path)
  } else {
    window.history.pushState({}, '', path)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function getSafeRelativeRedirect(value) {
  const redirect = String(value || '').trim()
  if (!redirect.startsWith('/')) return null
  if (redirect.startsWith('//') || redirect.includes('\\')) return null
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(redirect)) return null
  if (redirect.length > 2048) return null
  return redirect
}
