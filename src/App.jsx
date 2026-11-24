import { lazy, Suspense, useEffect, useState } from 'react'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import VolunteerLayout from './layouts/VolunteerLayout.jsx'
import './App.css'
import './phase3.css'

const Home = lazy(() => import('./pages/public/Home.jsx'))
const Events = lazy(() => import('./pages/public/Events.jsx'))
const EventDetails = lazy(() => import('./pages/public/EventDetails.jsx'))
const EventRegistration = lazy(() => import('./pages/public/EventRegistration.jsx'))
const Login = lazy(() => import('./pages/auth/Login.jsx'))
const Register = lazy(() => import('./pages/auth/Register.jsx'))
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard.jsx'))
const AdminEvents = lazy(() => import('./pages/admin/Events.jsx'))
const CreateEvent = lazy(() => import('./pages/admin/CreateEvent.jsx'))
const EditEvent = lazy(() => import('./pages/admin/EditEvent.jsx'))
const EventPreview = lazy(() => import('./pages/admin/EventPreview.jsx'))
const EventRegistrations = lazy(() => import('./pages/admin/EventRegistrations.jsx'))
const AdminRegistrations = lazy(() => import('./pages/admin/AllRegistrations.jsx'))
const AdminPayments = lazy(() => import('./pages/admin/Payments.jsx'))
const AdminTickets = lazy(() => import('./pages/admin/Tickets.jsx'))
const AdminDistributions = lazy(() => import('./pages/admin/Distributions.jsx'))
const RegistrationReports = lazy(() => import('./pages/admin/Reports.jsx'))
const PaymentReports = lazy(() => import('./pages/admin/PaymentReports.jsx'))
const RevenueReports = lazy(() => import('./pages/admin/RevenueReports.jsx'))
const ParticipantSearch = lazy(() => import('./pages/admin/Participants.jsx'))
const BenefitReports = lazy(() => import('./pages/admin/Benefits.jsx'))
const VolunteerReports = lazy(() => import('./pages/admin/Volunteers.jsx'))
const VolunteerManagement = lazy(() => import('./pages/admin/VolunteerManagement.jsx'))
const Organizations = lazy(() => import('./pages/admin/Organizations.jsx'))
const AdminSettings = lazy(() => import('./pages/admin/Settings.jsx'))
const AdminAccess = lazy(() => import('./pages/admin/AdminAccess.jsx'))
const UserDashboard = lazy(() => import('./pages/user/Dashboard.jsx'))
const MyEvents = lazy(() => import('./pages/user/MyEvents.jsx'))
const VolunteerDashboard = lazy(() => import('./pages/volunteer/Dashboard.jsx'))
const VolunteerScanner = lazy(() => import('./pages/volunteer/Scanner.jsx'))
const VolunteerDistributionScanner = lazy(() => import('./pages/volunteer/DistributionScanner.jsx'))
const VolunteerHistory = lazy(() => import('./pages/volunteer/DistributionHistory.jsx'))
const PaymentPage = lazy(() => import('./pages/payments/PaymentPage.jsx'))
const PaymentReceipt = lazy(() => import('./pages/payments/PaymentReceipt.jsx'))
const TicketScanner = lazy(() => import('./pages/tickets/TicketScanner.jsx'))
const adminRoles = ['super_admin']
const redirectNonAdmin = (roles) => (
  roles.includes('participant') ? '/dashboard' : roles.includes('volunteer') ? '/volunteer/distributions' : '/'
)

function PageLoading() {
  return <section className="container event-page-state" aria-live="polite">Loading Evently…</section>
}

function AdminRoute({ children }) {
  return (
    <ProtectedRoute roles={adminRoles} unauthorizedRedirect={redirectNonAdmin}>
      <AdminLayout>{children}</AdminLayout>
    </ProtectedRoute>
  )
}

function App() {
  const [route, setRoute] = useState(`${window.location.pathname}${window.location.search}`)

  useEffect(() => {
    const updateRoute = () => {
      setRoute(`${window.location.pathname}${window.location.search}`)
    }
    window.addEventListener('popstate', updateRoute)
    return () => window.removeEventListener('popstate', updateRoute)
  }, [])

  const path = route.split('?')[0].replace(/\/+$/, '') || '/'

  if (path === '/login') return <Suspense fallback={<PageLoading />}><Login /></Suspense>
  if (path === '/register') return <Suspense fallback={<PageLoading />}><Register /></Suspense>

  const eventRegisterMatch = path.match(/^\/events\/([^/]+)\/register$/)
  const eventDetailsMatch = path.match(/^\/events\/([^/]+)$/)
  const editEventMatch = path.match(/^\/admin\/events\/([^/]+)\/edit$/)
  const previewEventMatch = path.match(/^\/admin\/events\/([^/]+)\/preview$/)
  const registrationsMatch = path.match(/^\/admin\/events\/([^/]+)\/registrations$/)
  const paymentReceiptMatch = path.match(/^\/payments\/receipt\/([0-9]+)\/([0-9a-f-]+)$/i)
  const paymentMatch = path.match(/^\/payments\/([0-9]+)$/)
  const decodeSegment = (value) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return ''
    }
  }

  let page
  if (path === '/') {
    page = <Home />
  } else if (path === '/events') {
    page = <Events />
  } else if (eventRegisterMatch) {
    const slug = decodeSegment(eventRegisterMatch[1])
    page = <ProtectedRoute roles={['participant']}><EventRegistration key={slug} slug={slug} /></ProtectedRoute>
  } else if (eventDetailsMatch) {
    const slug = decodeSegment(eventDetailsMatch[1])
    page = <EventDetails key={slug} slug={slug} />
  } else if (path === '/admin') {
    page = <AdminRoute><AdminDashboard /></AdminRoute>
  } else if (path === '/admin/events') {
    page = <AdminRoute><AdminEvents /></AdminRoute>
  } else if (path === '/admin/events/create') {
    page = <AdminRoute><CreateEvent /></AdminRoute>
  } else if (editEventMatch) {
    const eventId = decodeSegment(editEventMatch[1])
    page = <AdminRoute><EditEvent key={eventId} eventId={eventId} /></AdminRoute>
  } else if (previewEventMatch) {
    const eventId = decodeSegment(previewEventMatch[1])
    page = <AdminRoute><EventPreview eventId={eventId} /></AdminRoute>
  } else if (registrationsMatch) {
    const eventId = decodeSegment(registrationsMatch[1])
    page = <AdminRoute><EventRegistrations key={eventId} eventId={eventId} /></AdminRoute>
  } else if (path === '/admin/registrations') {
    page = <AdminRoute><AdminRegistrations /></AdminRoute>
  } else if (path === '/admin/payments') {
    page = <AdminRoute><AdminPayments /></AdminRoute>
  } else if (path === '/admin/tickets') {
    page = <AdminRoute><AdminTickets /></AdminRoute>
  } else if (path === '/admin/distributions') {
    page = <AdminRoute><AdminDistributions /></AdminRoute>
  } else if (path === '/admin/reports/registrations') {
    page = <AdminRoute><RegistrationReports /></AdminRoute>
  } else if (path === '/admin/reports/payments') {
    page = <AdminRoute><PaymentReports /></AdminRoute>
  } else if (path === '/admin/reports/revenue') {
    page = <AdminRoute><RevenueReports /></AdminRoute>
  } else if (path === '/admin/reports/benefits') {
    page = <AdminRoute><BenefitReports /></AdminRoute>
  } else if (path === '/admin/reports/volunteers') {
    page = <AdminRoute><VolunteerReports /></AdminRoute>
  } else if (path === '/admin/volunteer-management') {
    page = <AdminRoute><VolunteerManagement /></AdminRoute>
  } else if (path === '/admin/participants') {
    page = <AdminRoute><ParticipantSearch /></AdminRoute>
  } else if (path === '/admin/ticket-scanner') {
    page = <AdminRoute><TicketScanner /></AdminRoute>
  } else if (path === '/admin/organizations') {
    page = <AdminRoute><Organizations /></AdminRoute>
  } else if (path === '/admin/settings') {
    page = <AdminRoute><AdminSettings /></AdminRoute>
  } else if (path === '/admin/access') {
    page = <AdminRoute><AdminAccess /></AdminRoute>
  } else if (paymentReceiptMatch) {
    page = <ProtectedRoute roles={['participant']}><PaymentReceipt registrationId={paymentReceiptMatch[1]} paymentId={paymentReceiptMatch[2]} /></ProtectedRoute>
  } else if (paymentMatch) {
    page = <ProtectedRoute roles={['participant']}><PaymentPage registrationId={paymentMatch[1]} /></ProtectedRoute>
  } else if (path === '/dashboard') {
    page = <ProtectedRoute roles={['participant']}><UserDashboard /></ProtectedRoute>
  } else if (path === '/dashboard/my-events') {
    page = <ProtectedRoute roles={['participant']}><MyEvents /></ProtectedRoute>
  } else if (path === '/volunteer') {
    page = (
      <ProtectedRoute roles={['volunteer']}>
        <VolunteerLayout><VolunteerDashboard /></VolunteerLayout>
      </ProtectedRoute>
    )
  } else if (path === '/volunteer/scanner') {
    page = (
      <ProtectedRoute roles={['volunteer']}>
        <VolunteerLayout><VolunteerScanner /></VolunteerLayout>
      </ProtectedRoute>
    )
  } else if (path === '/volunteer/distributions') {
    page = (
      <ProtectedRoute roles={['volunteer']}>
        <VolunteerLayout><VolunteerDistributionScanner /></VolunteerLayout>
      </ProtectedRoute>
    )
  } else if (path === '/volunteer/history') {
    page = (
      <ProtectedRoute roles={['volunteer']}>
        <VolunteerLayout><VolunteerHistory /></VolunteerLayout>
      </ProtectedRoute>
    )
  } else {
    page = (
      <section className="not-found container">
        <span className="eyebrow">PAGE NOT FOUND</span>
        <h1>Looks like this page has moved.</h1>
        <p>Let’s get you back to discovering something memorable.</p>
        <a className="button button-primary" href="/events">Explore events</a>
      </section>
    )
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <>
      <Navbar />
      <main>{page}</main>
      <Footer />
      </>
    </Suspense>
  )
}

export default App
