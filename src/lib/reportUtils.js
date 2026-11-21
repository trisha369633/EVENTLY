export const reportDatePresets = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

function localMidnight(date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null
}

export function getReportDateBounds(filter) {
  const today = localMidnight(new Date())
  let start
  let end = new Date(today)
  end.setDate(end.getDate() + 1)

  if (filter?.preset === 'all') return { start: null, endExclusive: null, error: '' }
  if (filter?.preset === 'custom') {
    start = parseLocalDate(filter.from)
    const lastDay = parseLocalDate(filter.to)
    if (!start || !lastDay) {
      return { start: null, endExclusive: null, error: 'Choose a valid start and end date.' }
    }
    if (start > lastDay) {
      return { start: null, endExclusive: null, error: 'The start date must be on or before the end date.' }
    }
    end = new Date(lastDay)
    end.setDate(end.getDate() + 1)
  } else if (filter?.preset === 'today') {
    start = today
  } else if (filter?.preset === 'last7') {
    start = new Date(today)
    start.setDate(start.getDate() - 6)
  } else if (filter?.preset === 'thisMonth') {
    start = new Date(today.getFullYear(), today.getMonth(), 1)
  } else {
    start = new Date(today)
    start.setDate(start.getDate() - 29)
  }

  return {
    start: start.toISOString(),
    endExclusive: end.toISOString(),
    error: '',
  }
}

export function formatReportDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, options)
}

export function formatReportCurrency(value) {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? `৳${amount.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'
}

export function formatReportNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '—'
}

export function groupReportRows(rows, key, labelKey = key) {
  const groups = new Map()
  for (const row of rows) {
    const groupKey = String(row[key] ?? 'unknown')
    const label = String(row[labelKey] ?? 'Unknown')
    const current = groups.get(groupKey) || { key: groupKey, label, count: 0 }
    current.count += 1
    groups.set(groupKey, current)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
