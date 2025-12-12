import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OrderModel } from '../src/models/order.js';
import pool, { initDatabase } from '../src/config/database.js';
import redis from '../src/config/redis.js';

describe('OrderModel', () => {
  beforeAll(async () => {
    await redis.connect();
    await initDatabase();
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM orders WHERE token_in = $1', ['TEST']);
    await redis.quit();
    await pool.end();
  });

  describe('create', () => {
    it('should create a new order with pending status', async () => {
      const order = await OrderModel.create('TEST', 'USDC', 1.0, 0.01);

      expect(order).toBeDefined();
      expect(order.id).toBeDefined();
      expect(order.tokenIn).toBe('TEST');
      expect(order.tokenOut).toBe('USDC');
      expect(order.amount).toBe(1.0);
      expect(order.slippage).toBe(0.01);
      expect(order.status).toBe('pending');
      expect(order.retryCount).toBe(0);
      expect(order.createdAt).toBeInstanceOf(Date);
    });

    it('should cache order in Redis', async () => {
      const order = await OrderModel.create('TEST', 'USDC', 2.0, 0.02);
      
      const cached = await redis.get(`order:${order.id}`);
      expect(cached).toBeDefined();
      
      const cachedOrder = JSON.parse(cached!);
      expect(cachedOrder.id).toBe(order.id);
      expect(cachedOrder.amount).toBe(2.0);
    });
  });

  describe('getById', () => {
    it('should retrieve order from cache', async () => {
      const created = await OrderModel.create('TEST', 'USDC', 1.5, 0.01);
      
      // Should hit cache
      const retrieved = await OrderModel.getById(created.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.amount).toBe(1.5);
    });

    it('should return null for non-existent order', async () => {
      const retrieved = await OrderModel.getById('non-existent-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update order status', async () => {
      const order = await OrderModel.create('TEST', 'USDC', 1.0, 0.01);
      
      await OrderModel.updateStatus(order.id, 'routing');
      
      const updated = await OrderModel.getById(order.id);
      expect(updated?.status).toBe('routing');
    });

    it('should update additional fields', async () => {
      const order = await OrderModel.create('TEST', 'USDC', 1.0, 0.01);
      
      await OrderModel.updateStatus(order.id, 'confirmed', {
        selectedDex: 'raydium',
        executedPrice: 100.5,
        amountOut: 99.5,
        txHash: 'abc123',
      });
      
      const updated = await OrderModel.getById(order.id);
      expect(updated?.status).toBe('confirmed');
      expect(updated?.selectedDex).toBe('raydium');
      expect(updated?.executedPrice).toBe(100.5);
      expect(updated?.amountOut).toBe(99.5);
      expect(updated?.txHash).toBe('abc123');
    });

    it('should invalidate Redis cache on update', async () => {
      const order = await OrderModel.create('TEST', 'USDC', 1.0, 0.01);
      
      // Ensure cached
      await OrderModel.getById(order.id);
      
      // Update
      await OrderModel.updateStatus(order.id, 'routing');
      
      // Cache should be invalidated
      const cached = await redis.get(`order:${order.id}`);
      expect(cached).toBeNull();
    });
  });

  describe('getRecent', () => {
    it('should retrieve recent orders', async () => {
      await OrderModel.create('TEST', 'USDC', 1.0, 0.01);
      await OrderModel.create('TEST', 'USDC', 2.0, 0.01);
      
      const recent = await OrderModel.getRecent(10);
      
      expect(recent).toBeDefined();
      expect(Array.isArray(recent)).toBe(true);
      expect(recent.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      const recent = await OrderModel.getRecent(2);
      
      expect(recent.length).toBeLessThanOrEqual(2);
    });

    it('should return orders in descending order by creation time', async () => {
      const recent = await OrderModel.getRecent(10);
      
      if (recent.length > 1) {
        for (let i = 0; i < recent.length - 1; i++) {
          expect(recent[i].createdAt.getTime()).toBeGreaterThanOrEqual(
            recent[i + 1].createdAt.getTime()
          );
        }
      }
    });
  });
});
