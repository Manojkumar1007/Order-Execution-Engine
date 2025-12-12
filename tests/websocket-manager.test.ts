import { describe, it, expect } from 'vitest';
import { broadcastStatus, registerConnection, getActiveConnectionCount } from '../src/services/websocket-manager.js';

describe('WebSocket Manager', () => {
  describe('broadcastStatus', () => {
    it('should create valid status update structure', () => {
      const update = {
        orderId: 'test-order-123',
        status: 'pending',
        timestamp: new Date().toISOString(),
        data: { test: 'data' },
      };

      // Should not throw
      expect(() => broadcastStatus(update)).not.toThrow();
    });
  });

  describe('getActiveConnectionCount', () => {
    it('should return number of active connections', () => {
      const count = getActiveConnectionCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });
});
