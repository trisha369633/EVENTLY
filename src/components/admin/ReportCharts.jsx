function ReportBarList({ title, description, items, valueLabel = 'registrations', formatValue = (value) => value.toLocaleString() }) {
  const maximum = Math.max(1, ...items.map((item) => Number(item.value) || 0))

  return (
    <section className="report-panel">
      <div className="report-panel-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {!items.length ? <p className="report-empty-inline">No data for this range.</p> : (
        <div className="report-bar-list">
          {items.map((item) => {
            const value = Number(item.value) || 0
            return (
              <div className="report-bar-row" key={item.key || item.label}>
                <div className="report-bar-label"><span>{item.label}</span><strong>{formatValue(value)} {valueLabel}</strong></div>
                <div className="report-bar-track" role="progressbar" aria-label={`${item.label}: ${value} ${valueLabel}`} aria-valuenow={value} aria-valuemin="0" aria-valuemax={maximum}>
                  <span style={{ width: `${Math.max(value ? 2 : 0, (value / maximum) * 100)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ReportTrendChart({ title, description, items }) {
  const width = 720
  const height = 220
  const padding = { top: 18, right: 18, bottom: 38, left: 36 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const maxValue = Math.max(1, ...items.map((item) => Number(item.value) || 0))
  const points = items.map((item, index) => {
    const x = items.length < 2
      ? padding.left + plotWidth / 2
      : padding.left + (index / (items.length - 1)) * plotWidth
    const y = padding.top + plotHeight - ((Number(item.value) || 0) / maxValue) * plotHeight
    return { ...item, x, y }
  })
  const path = points.map((point) => `${point.x},${point.y}`).join(' ')
  const labels = points.length > 8
    ? points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0)
    : points

  return (
    <section className="report-panel report-trend-panel">
      <div className="report-panel-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {!items.length ? <p className="report-empty-inline">No registrations for this date range.</p> : (
        <div className="report-chart-scroll">
          <svg className="report-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${items.map((item) => `${item.label} ${item.value}`).join(', ')}`}>
            {[0, 0.5, 1].map((fraction) => {
              const y = padding.top + plotHeight * fraction
              return <line key={fraction} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="report-chart-gridline" />
            })}
            <polyline points={path} className="report-trend-line" />
            {points.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="3.5" className="report-trend-point"><title>{point.label}: {point.value}</title></circle>)}
            {labels.map((point) => <text key={point.label} x={point.x} y={height - 11} textAnchor="middle" className="report-chart-label">{point.label}</text>)}
          </svg>
        </div>
      )}
    </section>
  )
}

export { ReportBarList, ReportTrendChart }
