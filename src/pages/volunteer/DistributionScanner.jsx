import TicketScanner from '../tickets/TicketScanner.jsx'

function DistributionScanner({ distributionView, onDistributionViewChange }) {
  return (
    <TicketScanner
      workflow="distribution"
      volunteerWorkspace
      distributionView={distributionView}
      onDistributionViewChange={onDistributionViewChange}
    />
  )
}

export default DistributionScanner
