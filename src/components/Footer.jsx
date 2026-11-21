import { Brand } from './Navbar.jsx'

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-main">
          <div className="footer-brand">
            <Brand inverse />
            <p>One platform to discover and experience university events.</p>
          </div>
          <div className="footer-column">
            <h2>Explore</h2>
            <a href="/">Home</a>
            <a href="/events">Events</a>
            <a href="/#about">About</a>
          </div>
          <div className="footer-column">
            <h2>Account</h2>
            <a href="/login">Login</a>
            <a href="/register">Register</a>
          </div>
          <div className="footer-column">
            <h2>Platform</h2>
            <a href="/events">For Students</a>
            <a href="/register">For Universities</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 EVENTLY. All rights reserved.</span>
          <span>Every Event. One Platform.</span>
        </div>
      </div>
    </footer>
  )
}

export default Footer