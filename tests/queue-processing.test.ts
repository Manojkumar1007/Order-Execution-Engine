import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { processOrder, addOrderToQueue, getQueueMetrics, orderQueue } from '../src/queues/order-queue.js';
import { OrderModel } from '../src/models/order.js';
import * as WebsocketManager from '../src/services/websocket-manager.js';
import { Job } from 'bullmq';
import redis from '../src/config/redis.js';
import pool, { initDatabase } from '../src/config/database.js';

// Mock dependencies
vi.mock('../src/services/websocket-manager.js', () => ({
    broadcastStatus: vi.fn(),
    registerConnection: vi.fn(),
}));

// We need to use real Redis/DB for some parts because of deep integration,
// but we can mock the specific calls in processOrder to unit test the logic flow.

describe('Queue Processing Unit Tests', () => {
    beforeAll(async () => {
        if (redis.status !== 'ready' && redis.status !== 'connecting') {
            await redis.connect();
        }
        await initDatabase();
    });

    afterAll(async () => {
        await redis.quit();
        await pool.end();
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        // Clean queue
        await orderQueue.obliterate({ force: true });
    });

    describe('addOrderToQueue', () => {
        it('should add a job to the queue with correct ID', async () => {
            const orderId = 'test-order-123';
            await addOrderToQueue(orderId);

            const job = await orderQueue.getJob(orderId);
            expect(job).toBeDefined();
            expect(job?.id).toBe(orderId);
            expect(job?.data.orderId).toBe(orderId);
        });
    });

    describe('processOrder', () => {
        it('should process a valid order successfully', async () => {
            // Setup data
            const order = await OrderModel.create('SOL', 'USDC', 1.0, 0.05);
            const orderId = order.id;

            const mockJob = {
                id: orderId,
                data: { orderId },
                attemptsMade: 1,
            } as unknown as Job;

            // Spy on updates
            const updateStatusSpy = vi.spyOn(OrderModel, 'updateStatus');

            // Execute
            await processOrder(mockJob);

            // Verify status transitions
            expect(updateStatusSpy).toHaveBeenCalledWith(orderId, 'routing');
            expect(updateStatusSpy).toHaveBeenCalledWith(orderId, 'building', expect.any(Object));
            expect(updateStatusSpy).toHaveBeenCalledWith(orderId, 'submitted');
            expect(updateStatusSpy).toHaveBeenCalledWith(orderId, 'confirmed', expect.any(Object));

            // Verify broadcast
            expect(WebsocketManager.broadcastStatus).toHaveBeenCalledTimes(4); // routing, building, submitted, confirmed

            // Verify final state in DB
            const finalOrder = await OrderModel.getById(orderId);
            expect(finalOrder?.status).toBe('confirmed');
        });

        it('should handle non-existent order gracefully', async () => {
            const orderId = '00000000-0000-0000-0000-000000000000';

            const mockJob = {
                id: orderId,
                data: { orderId },
                attemptsMade: 1,
            } as unknown as Job;

            await expect(processOrder(mockJob)).rejects.toThrow(`Order ${orderId} not found`);
        });
    });

    describe('getQueueMetrics', () => {
        it('should return correct metrics', async () => {
            // Add a few jobs
            await addOrderToQueue('11111111-1111-1111-1111-111111111111');
            await addOrderToQueue('22222222-2222-2222-2222-222222222222');

            const metrics = await getQueueMetrics();

            expect(metrics.waiting).toBeGreaterThanOrEqual(2);
            expect(metrics.total).toBeGreaterThanOrEqual(2);
        });
    });
});
