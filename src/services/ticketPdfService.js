function displayDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date to be announced'
    : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function ticketStatus(ticket) {
  if (ticket.ticket_status === 'checked_in') return 'CHECKED IN'
  if (ticket.ticket_status === 'revoked') return 'REVOKED'
  return 'VALID FOR ENTRY'
}

export async function createTicketQrDataUrl(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error('A valid ticket QR credential is not available.')
  }
  const QRCode = await import('qrcode')
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: 'Q',
    margin: 2,
    width: 360,
    color: { dark: '#0B2B1F', light: '#FFFFFF' },
  })
}

export async function downloadTicketPdf(ticket) {
  if (!ticket?.ticket_token || !ticket?.ticket_reference) {
    throw new Error('An eligible ticket QR code is not available.')
  }

  const [{ jsPDF }, qrCode] = await Promise.all([
    import('jspdf'),
    createTicketQrDataUrl(ticket.ticket_token),
  ])

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [220, 140] })
  const width = 220
  const height = 140
  const orange = [242, 140, 40]
  const green = [18, 61, 43]
  const ink = [30, 45, 37]
  const muted = [98, 111, 101]
  const dateText = displayDate(ticket.event_start)
  const issuedText = displayDate(ticket.issued_at)
  const mode = String(ticket.event_mode || '').toLowerCase()
  const venueText = mode === 'online'
    ? ticket.venue || 'Online event'
    : [ticket.venue, mode && mode !== 'offline' ? mode : ''].filter(Boolean).join(' · ')
  const attendeeName = ticket.attendee_name || ticket.participant_name || 'Attendee'
  const attendeeType = ticket.attendee_type === 'guest'
    ? `Guest — ${ticket.relationship || 'Guest'}`
    : ticket.participant_type || 'Main Participant'

  pdf.setFillColor(245, 247, 243)
  pdf.rect(0, 0, width, height, 'F')
  pdf.setFillColor(...green)
  pdf.roundedRect(8, 8, 204, 124, 5, 5, 'F')
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(12, 12, 196, 116, 4, 4, 'F')
  pdf.setFillColor(...green)
  pdf.roundedRect(12, 12, 196, 23, 4, 4, 'F')
  pdf.rect(12, 29, 196, 6, 'F')

  pdf.setDrawColor(255, 255, 255)
  pdf.setLineWidth(0.8)
  pdf.roundedRect(18, 17, 12, 12, 2, 2, 'S')
  pdf.setDrawColor(...orange)
  pdf.line(21, 17, 21, 14)
  pdf.line(27, 17, 27, 14)
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text('EVENTLY', 35, 25)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text('UNIVERSITY EVENT TICKET', 169, 24)

  pdf.setTextColor(...muted)
  pdf.setFontSize(7)
  pdf.setFont('helvetica', 'bold')
  pdf.text('EVENT', 19, 44)
  pdf.setTextColor(...ink)
  pdf.setFontSize(17)
  pdf.setFont('helvetica', 'bold')
  const titleLines = pdf.splitTextToSize(String(ticket.event_title || 'Event'), 122)
  pdf.text(titleLines.slice(0, 2), 19, 52)

  let infoY = 70
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(...muted)
  pdf.text('DATE & TIME', 19, infoY)
  pdf.text('VENUE / MODE', 85, infoY)
  pdf.setTextColor(...ink)
  pdf.setFont('helvetica', 'bold')
  pdf.text(pdf.splitTextToSize(dateText, 62).slice(0, 2), 19, infoY + 6)
  pdf.text(pdf.splitTextToSize(String(venueText || 'Venue to be announced'), 66).slice(0, 2), 85, infoY + 6)

  infoY = 94
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.setTextColor(...muted)
  pdf.text('ATTENDEE', 19, infoY)
  pdf.text('ATTENDEE TYPE', 85, infoY)
  pdf.text('TICKET REFERENCE', 19, 112)
  pdf.text('ISSUED', 85, 112)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(...ink)
  pdf.text(pdf.splitTextToSize(attendeeName, 62).slice(0, 1), 19, infoY + 6)
  pdf.text(pdf.splitTextToSize(attendeeType, 62).slice(0, 2), 85, infoY + 6)
  pdf.setFontSize(8)
  pdf.text(String(ticket.ticket_reference), 19, 119)
  pdf.setFont('helvetica', 'normal')
  pdf.text(issuedText, 85, 119)

  pdf.setFillColor(234, 242, 236)
  pdf.roundedRect(153, 42, 44, 44, 3, 3, 'F')
  pdf.addImage(qrCode, 'PNG', 155, 44, 40, 40)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(...green)
  pdf.text(ticketStatus(ticket), 175, 96, { align: 'center' })
  pdf.setDrawColor(226, 232, 226)
  pdf.line(151, 37, 151, 122)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6)
  pdf.setTextColor(...muted)
  pdf.text('Present this QR code at event entry.', 175, 104, { align: 'center' })
  pdf.setFontSize(5.5)
  pdf.text('The QR contains a private ticket credential. Do not share it.', 175, 110, { align: 'center', maxWidth: 42 })

  const filenameReference = String(ticket.ticket_reference).replace(/[^a-zA-Z0-9-]/g, '')
  pdf.save(`Evently-Ticket-${filenameReference || 'ticket'}.pdf`)
}
