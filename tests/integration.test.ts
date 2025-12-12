import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OrderModel } from '../src/models/order.js';
import { MockDexRouter } from '../src/services/dex-router.js';
import { broadcastStatus } from '../src/services/websocket-manager.js';
import pool, { initDatabase } from '../src/config/database.js';
import redis from '../src/config/redis.js';
import { orderQueue, addOrderToQueue, getQueueMetrics, initWorker } from '../src/queues/order-queue.js';

describe('Integration Tests', () => {
  beforeAll(async () => {
    // Connect to Redis
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
    
    // Initialize database
    await initDatabase();
    
    // Initialize worker
    initWorker();
    
    // Wait a bit for worker to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM orders WHERE token_in = $1', ['TEST_INT']);
    
    // Clean up queue
    await orderQueue.obliterate({ force: true });
    
    // Close connections
    await redis.quit();
    await pool.end();
  });

  describe('End-to-End Order Flow', () => {
    it('should process a complete order from submission to confirmation', async () => {
      // Create order
      const order = await OrderModel.create('TEST_INT', 'USDC', 1.5, 0.01);
      
      expect(order.status).toBe('pending');
      expect(order.id).toBeDefined();

      // Add to queue
      await addOrderToQueue(order.id);

      // Wait for processing (mock execution takes ~3-4 seconds)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check final status
      const processed = await OrderModel.getById(order.id);
      
      expect(processed).toBeDefined();
      expect(processed?.status).toBe('confirmed');
      expect(processed?.selectedDex).toBeDefined();
      expect(processed?.txHash).toBeDefined();
      expect(processed?.executedPrice).toBeGreaterThan(0);
      expect(processed?.amountOut).toBeGreaterThan(0);
    }, 10000);

    it('should handle concurrent orders correctly', async () => {
      // Create 3 orders
      const orders = await Promise.all([
        OrderModel.create('TEST_INT', 'USDC', 1.0, 0.01),
        OrderModel.create('TEST_INT', 'USDT', 2.0, 0.015),
        OrderModel.create('TEST_INT', 'RAY', 0.5, 0.02),
      ]);

      expect(orders.length).toBe(3);

      // Add all to queue
      await Promise.all(orders.map(o => addOrderToQueue(o.id)));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Check all are processed
      const processed = await Promise.all(
        orders.map(o => OrderModel.getById(o.id))
      );

      for (const order of processed) {
        expect(order).toBeDefined();
        expect(order?.status).toBe('confirmed');
        expect(order?.txHash).toBeDefined();
      }
    }, 15000);
  });

  describe('DEX Router Integration', () => {
    it('should select different DEXs based on quotes', async () => {
      const router = new MockDexRouter();
      
      // Get multiple quotes to see variance
      const results = await Promise.all([
        router.getBestQuote('SOL', 'USDC', 1.0),
        router.getBestQuote('SOL', 'USDC', 1.0),
        router.getBestQuote('SOL', 'USDC', 1.0),
      ]);

      // Should have selected DEXs (may be different due to randomness)
      const dexes = results.map(r => r.bestQuote.dex);
      expect(dexes.length).toBe(3);
      
      // At least one should be defined
      expect(dexes.every(dex => dex === 'raydium' || dex === 'meteora')).toBe(true);
    });

    it('should provide price improvement data', async () => {
      const router = new MockDexRouter();
      const result = await router.getBestQuote('SOL', 'USDC', 1.0);

      expect(result.priceImprovement).toBeGreaterThanOrEqual(0);
      expect(result.raydiumQuote.estimatedOutput).toBeGreaterThan(0);
      expect(result.meteoraQuote.estimatedOutput).toBeGreaterThan(0);
      expect(result.bestQuote.estimatedOutput).toBeGreaterThanOrEqual(
        Math.min(result.raydiumQuote.estimatedOutput, result.meteoraQuote.estimatedOutput)
      );
    });
  });

  describe('Queue Metrics', () => {
    it('should track queue statistics', async () => {
      const metrics = await getQueueMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics.waiting).toBe('number');
      expect(typeof metrics.active).toBe('number');
      expect(typeof metrics.completed).toBe('number');
      expect(typeof metrics.failed).toBe('number');
      expect(metrics.total).toBe(metrics.waiting + metrics.active + metrics.completed + metrics.failed);
    });
  });

  describe('WebSocket Manager', () => {
    it('should broadcast status updates without error', () => {
      const update = {
        orderId: 'test-integration-order',
        status: 'routing',
        timestamp: new Date().toISOString(),
        data: { message: 'Test message' },
      };

      // Should not throw even without active connections
      expect(() => broadcastStatus(update)).not.toThrow();
    });
  });

  describe('Database Persistence', () => {
    it('should persist orders with all fields', async () => {
      const order = await OrderModel.create('TEST_INT', 'USDC', 5.5, 0.025);

      // Update with execution details
      await OrderModel.updateStatus(order.id, 'confirmed', {
        selectedDex: 'meteora',
        executedPrice: 100.25,
        amountOut: 550.5,
        txHash: 'test-tx-hash-123',
      });

      // Retrieve from database
      const retrieved = await OrderModel.getById(order.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.selectedDex).toBe('meteora');
      expect(retrieved?.executedPrice).toBe(100.25);
      expect(retrieved?.amountOut).toBe(550.5);
      expect(retrieved?.txHash).toBe('test-tx-hash-123');
    });

    it('should handle retry count updates', async () => {
      const order = await OrderModel.create('TEST_INT', 'USDC', 1.0, 0.01);

      await OrderModel.updateStatus(order.id, 'failed', {
        errorMessage: 'Test error',
        retryCount: 2,
      });

      const retrieved = await OrderModel.getById(order.id);

      expect(retrieved?.status).toBe('failed');
      expect(retrieved?.errorMessage).toBe('Test error');
      expect(retrieved?.retryCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent order gracefully', async () => {
      const order = await OrderModel.getById('non-existent-id');
      expect(order).toBeNull();
    });

    it('should handle cache misses and fallback to database', async () => {
      const order = await OrderModel.create('TEST_INT', 'USDC', 1.0, 0.01);
      
      // Clear cache
      await redis.del(`order:${order.id}`);
      
      // Should still retrieve from database
      const retrieved = await OrderModel.getById(order.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(order.id);
    });
  });
});
