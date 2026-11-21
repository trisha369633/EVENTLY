import { getReportDateBounds, reportDatePresets } from '../../lib/reportUtils.js'

function ReportDateFilter({ value, onChange }) {
  const bounds = getReportDateBounds(value)
  const update = (patch) => onChange((current) => ({ ...current, ...patch }))

  return (
    <div className="report-date-filter">
      <label className="form-field">
        <span>Date range</span>
        <select value={value.preset} onChange={(event) => update({ preset: event.target.value })}>
          {reportDatePresets.map((preset) => <option value={preset.value} key={preset.value}>{preset.label}</option>)}
        </select>
      </label>
      {value.preset === 'custom' && (
        <>
          <label className="form-field">
            <span>From</span>
            <input type="date" value={value.from} onChange={(event) => update({ from: event.target.value })} />
          </label>
          <label className="form-field">
            <span>Through</span>
            <input type="date" value={value.to} onChange={(event) => update({ to: event.target.value })} />
          </label>
        </>
      )}
      {bounds.error && <p className="report-filter-error" role="alert">{bounds.error}</p>}
    </div>
  )
}

export default ReportDateFilter
