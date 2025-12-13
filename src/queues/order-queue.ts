import { Queue, Worker, Job } from 'bullmq';
import redis from '../config/redis.js';
import { config } from '../config/index.js';
import { OrderModel } from '../models/order.js';
import { MockDexRouter } from '../services/dex-router.js';
import { broadcastStatus } from '../services/websocket-manager.js';

// Create order queue
export const orderQueue = new Queue('orders', {
  connection: redis,
  defaultJobOptions: {
    attempts: config.queue.maxRetries,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100,
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// DEX router instance
const dexRouter = new MockDexRouter();

// Process order job - this is where the main order execution logic happens
export async function processOrder(job: Job<{ orderId: string }>): Promise<void> {
  const { orderId } = job.data;

  try {
    // Fetch order from database
    const order = await OrderModel.getById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Update status to routing
    await OrderModel.updateStatus(orderId, 'routing');
    broadcastStatus({
      orderId,
      status: 'routing',
      timestamp: new Date().toISOString(),
      data: { message: 'Comparing DEX quotes...' },
    });

    // Get best quote from both DEXs
    const { raydiumQuote, meteoraQuote, bestQuote, priceImprovement } =
      await dexRouter.getBestQuote(order.tokenIn, order.tokenOut, order.amount);

    // Log routing decision
    dexRouter.logRoutingDecision(orderId, raydiumQuote, meteoraQuote, bestQuote.dex, priceImprovement);

    // Update order with quotes
    await OrderModel.updateStatus(orderId, 'building', {
      selectedDex: bestQuote.dex,
      raydiumQuote,
      meteoraQuote,
    });

    broadcastStatus({
      orderId,
      status: 'building',
      timestamp: new Date().toISOString(),
      data: {
        selectedDex: bestQuote.dex,
        estimatedOutput: bestQuote.estimatedOutput,
        priceImprovement: priceImprovement.toFixed(3) + '%',
      },
    });

    // Small delay to simulate transaction building
    await new Promise(resolve => setTimeout(resolve, 500));

    // Update status to submitted
    await OrderModel.updateStatus(orderId, 'submitted');
    broadcastStatus({
      orderId,
      status: 'submitted',
      timestamp: new Date().toISOString(),
      data: { message: 'Transaction submitted to blockchain...' },
    });

    // Execute swap on selected DEX
    const swapResult = await dexRouter.executeSwap(
      {
        orderId,
        tokenIn: order.tokenIn,
        tokenOut: order.tokenOut,
        amount: order.amount,
        slippage: order.slippage,
      },
      bestQuote.dex
    );

    // Update order to confirmed
    await OrderModel.updateStatus(orderId, 'confirmed', {
      executedPrice: swapResult.executedPrice,
      amountOut: swapResult.amountOut,
      txHash: swapResult.txHash,
    });

    broadcastStatus({
      orderId,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      data: {
        txHash: swapResult.txHash,
        executedPrice: swapResult.executedPrice,
        amountOut: swapResult.amountOut,
        dex: swapResult.dex,
      },
    });

    console.log(`✓ Order ${orderId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`✗ Order ${orderId} failed:`, errorMessage);

    // Update order to failed
    await OrderModel.updateStatus(orderId, 'failed', {
      errorMessage,
      retryCount: job.attemptsMade,
    });

    broadcastStatus({
      orderId,
      status: 'failed',
      timestamp: new Date().toISOString(),
      data: {
        error: errorMessage,
        retryCount: job.attemptsMade,
        willRetry: job.attemptsMade < config.queue.maxRetries,
      },
    });

    throw error; // Re-throw for BullMQ retry logic
  }
}

// Worker will be initialized later to avoid immediate connection
export let orderWorker: Worker;

/**
 * Initialize the order worker
 */
export function initWorker(): void {
  orderWorker = new Worker('orders', processOrder, {
    connection: redis,
    concurrency: config.queue.concurrency,
    limiter: {
      max: 100, // Max 100 jobs per minute
      duration: 60000,
    },
  });

  // Worker event handlers
  orderWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  orderWorker.on('failed', (job, error) => {
    if (job) {
      console.error(`Job ${job.id} failed after ${job.attemptsMade} attempts:`, error.message);
    }
  });

  orderWorker.on('error', (error) => {
    console.error('Worker error:', error);
  });
}

/**
 * Add order to queue
 */
export async function addOrderToQueue(orderId: string): Promise<void> {
  await orderQueue.add('process-order', { orderId }, {
    jobId: orderId, // Use orderId as jobId to prevent duplicates
  });
  console.log(`Order ${orderId} added to queue`);
}

/**
 * Get queue metrics
 */
export async function getQueueMetrics() {
  const [waiting, active, completed, failed] = await Promise.all([
    orderQueue.getWaitingCount(),
    orderQueue.getActiveCount(),
    orderQueue.getCompletedCount(),
    orderQueue.getFailedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    total: waiting + active + completed + failed,
  };
}
