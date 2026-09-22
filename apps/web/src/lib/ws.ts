import type { ServerMessage } from '@ai-map/shared';

/** Connects to /ws with automatic reconnect. `onOpen` fires on every (re)connect so callers can resync. */
export function connectRealtime(onMessage: (m: ServerMessage) => void, onStatus: (online: boolean) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/api/v1/events`);
    socket.onopen = () => {
      delay = 1000;
      onStatus(true);
    };
    socket.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string) as ServerMessage);
      } catch {
        // ignore malformed messages
      }
    };
    socket.onclose = () => {
      onStatus(false);
      if (closed) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  open();

  return () => {
    closed = true;
    clearTimeout(timer);
    socket?.close();
  };
}
