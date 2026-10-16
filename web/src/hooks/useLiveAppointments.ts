import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'offline';

interface AppointmentEvent {
  type: 'created' | 'cancelled' | 'updated';
  businessId: number;
  staffId: number;
  appointmentId: number;
}

/**
 * Keeps a WebSocket open to /api/ws while the panel is visible.
 * When an appointment of this business changes anywhere (another browser,
 * another server instance), the calendar and stats are refetched.
 * Reconnects automatically with a growing delay if the connection drops.
 */
export function useLiveAppointments(businessId: number, onEvent?: (event: AppointmentEvent) => void) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      setStatus('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'subscribe', businessId }));
      socket.onmessage = (message) => {
        const data = JSON.parse(message.data);
        if (data.type === 'subscribed') {
          attempt = 0;
          setStatus('live');
        }
        if (data.type === 'appointment') {
          queryClient.invalidateQueries({ queryKey: ['panel-appointments', businessId] });
          queryClient.invalidateQueries({ queryKey: ['stats', businessId] });
          onEventRef.current?.(data.event);
        }
      };
      socket.onclose = (event) => {
        if (stopped) return;
        setStatus('offline');
        if (event.code === 4401) return; // not signed in: retrying will not help
        const delay = Math.min(30_000, 1000 * 2 ** attempt++);
        retryTimer = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      // Closing a socket that is still connecting logs a browser warning; close it once it opens instead.
      if (socket?.readyState === WebSocket.CONNECTING) {
        const pending = socket;
        pending.onopen = () => pending.close();
      } else {
        socket?.close();
      }
    };
  }, [businessId, queryClient]);

  return status;
}
