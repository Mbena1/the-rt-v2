export function formatRelativeTime(dateString) {
  if (!dateString) return '—'
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return diffMin + 'm ago'
  if (diffHour < 24) return diffHour + 'h ago'
  if (diffDay < 7) return diffDay + 'd ago'
  return date.toLocaleDateString()
}

export function formatDateTime(dateString) {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getStatusBadgeClass(status) {
  switch (status) {
    case 'active':
    case 'monitoring':
    case 'completed':
      return 'badge-success'
    case 'pending':
    case 'scheduled':
      return 'badge-info'
    case 'processing':
      return 'badge-warning'
    case 'error':
    case 'failed':
    case 'disconnected':
      return 'badge-error'
    case 'paused':
      return 'badge-neutral'
    default:
      return 'badge-neutral'
  }
}

export function getActionIcon(action) {
  switch (action) {
    case 'retweet': return 'Repeat'
    case 'like': return 'Heart'
    case 'reply': return 'MessageCircle'
    default: return 'Activity'
  }
}
