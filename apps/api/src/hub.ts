import type { WebSocket } from 'ws';
import type { ServerMessage } from '@ai-map/shared';

const clients = new Set<WebSocket>();

export function addClient(socket: WebSocket): void {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

export function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}
