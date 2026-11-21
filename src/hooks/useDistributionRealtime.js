import { useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../lib/supabase.js'
import { subscribeToDistributionUpdates } from '../services/distributionService.js'

const fallbackIntervalMs = 15000

export function useDistributionRealtime({ eventId = '', enabled = true, onChange, onFallback }) {
  const [connectionState, setConnectionState] = useState({ eventId: '', status: 'connecting' })
  const onChangeRef = useRef(onChange)
  const onFallbackRef = useRef(onFallback)
  const currentEventId = String(eventId || '')

  useEffect(() => {
    onChangeRef.current = onChange
    onFallbackRef.current = onFallback
  }, [onChange, onFallback])

  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    let connected = false
    const channel = subscribeToDistributionUpdates({
      eventId: currentEventId,
      onChange: () => {
        if (active) onChangeRef.current?.()
      },
      onStatus: (status) => {
        if (!active) return
        const wasConnected = connected
        connected = status === 'SUBSCRIBED'
        const reconnecting = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)
        setConnectionState({
          eventId: currentEventId,
          status: connected ? 'connected' : reconnecting ? 'reconnecting' : 'connecting',
        })
        if (connected && !wasConnected) onChangeRef.current?.()
      },
    })
    const fallback = window.setInterval(() => {
      if (active && !connected) onFallbackRef.current?.()
    }, fallbackIntervalMs)

    return () => {
      active = false
      window.clearInterval(fallback)
      void getSupabaseClient().removeChannel(channel)
    }
  }, [enabled, currentEventId])

  if (!enabled) return 'offline'
  return connectionState.eventId === currentEventId ? connectionState.status : 'connecting'
}
