import { useState } from 'react'
import { exportReport } from '../../services/reportExportService.js'

function ReportExportButtons({ rows = [], loadRows, columns, fileName, disabled = false }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const unavailable = disabled || busy !== '' || (!loadRows && !rows.length)

  const handleExport = async (format) => {
    setBusy(format)
    setError('')
    try {
      const exportRows = loadRows ? await loadRows() : rows
      exportReport({ rows: exportRows, columns, fileName, format })
    } catch (exportError) {
      setError(exportError.message || 'The report could not be exported.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <div className="report-export-actions" aria-label="Export report">
      <button className="button button-outline button-small" type="button" disabled={unavailable} onClick={() => void handleExport('csv')}>
        {busy === 'csv' ? 'Preparing CSV…' : 'Export CSV'}
      </button>
      <button className="button button-outline button-small" type="button" disabled={unavailable} onClick={() => void handleExport('xlsx')}>
        {busy === 'xlsx' ? 'Preparing Excel…' : 'Export Excel'}
      </button>
      </div>
      {error && <p className="report-export-error" role="alert">{error}</p>}
    </div>
  )
}

export default ReportExportButtons
