import { WebSocket } from 'ws';

// Store active WebSocket connections per order
const connections = new Map<string, Set<WebSocket>>();

export interface StatusUpdate {
  orderId: string;
  status: string;
  timestamp: string;
  data?: any;
}

/**
 * Register a WebSocket connection for an order
 */
export function registerConnection(orderId: string, ws: WebSocket): void {
  if (!connections.has(orderId)) {
    connections.set(orderId, new Set());
  }
  connections.get(orderId)!.add(ws);

  // Remove connection on close
  ws.on('close', () => {
    const orderConnections = connections.get(orderId);
    if (orderConnections) {
      orderConnections.delete(ws);
      if (orderConnections.size === 0) {
        connections.delete(orderId);
      }
    }
  });
}

/**
 * Broadcast status update to all connections for an order
 */
export function broadcastStatus(update: StatusUpdate): void {
  const orderConnections = connections.get(update.orderId);
  if (!orderConnections || orderConnections.size === 0) {
    return;
  }

  const message = JSON.stringify(update);
  
  for (const ws of orderConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch (error) {
        console.error(`Error sending to WebSocket for order ${update.orderId}:`, error);
      }
    }
  }
}

/**
 * Close all connections for an order
 */
export function closeConnections(orderId: string): void {
  const orderConnections = connections.get(orderId);
  if (!orderConnections) {
    return;
  }

  for (const ws of orderConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
  
  connections.delete(orderId);
}

/**
 * Get count of active connections
 */
export function getActiveConnectionCount(): number {
  let count = 0;
  for (const orderConnections of connections.values()) {
    count += orderConnections.size;
  }
  return count;
}
