import { useEffect, useState } from 'react'
import { listDepartments, listInstitutions } from '../../services/profileService.js'

function Organizations() {
  const [institutions, setInstitutions] = useState([])
  const [departments, setDepartments] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    listInstitutions()
      .then(async (items) => {
        const departmentRows = await Promise.all(items.map(async (institution) => [
          institution.id,
          await listDepartments(institution.id),
        ]))
        if (!active) return
        setInstitutions(items)
        setDepartments(Object.fromEntries(departmentRows))
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Universities and departments could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="admin-page">
      <div className="admin-page-heading"><div><span className="eyebrow">ORGANIZATION DIRECTORY</span><h1>Universities &amp; Departments</h1><p>Active organization records used by event and registration forms.</p></div></div>
      <div className="inline-notice organization-permissions-note" role="note">This page is read-only. Add, edit, and activation controls are withheld because the current database permissions for organization writes have not been confirmed. No organization records were changed.</div>
      {error && <div className="form-feedback" role="alert">{error}</div>}
      {loading && <div className="event-skeleton admin-list-skeleton" aria-label="Loading organizations" aria-busy="true" />}
      {!loading && !error && !institutions.length && <div className="empty-state"><h2>No active universities found</h2><p>There are no active institution records available to the current account.</p></div>}
      {!loading && !error && institutions.length > 0 && (
        <div className="organization-list">
          {institutions.map((institution) => (
            <article className="organization-card" key={institution.id}>
              <div><span className="eyebrow">UNIVERSITY</span><h2>{institution.name}</h2></div>
              <div className="organization-departments">
                <h3>Departments</h3>
                {departments[institution.id]?.length
                  ? <ul>{departments[institution.id].map((department) => <li key={department.id}>{department.name}</li>)}</ul>
                  : <p>No active departments.</p>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default Organizations
