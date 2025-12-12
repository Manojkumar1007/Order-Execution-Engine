import { FastifyRequest, FastifyReply } from 'fastify';
import { OrderModel } from '../models/order.js';
import { registerConnection, broadcastStatus } from '../services/websocket-manager.js';
import { addOrderToQueue } from '../queues/order-queue.js';

interface OrderSubmitBody {
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
}

/**
 * Validate order submission request
 */
function validateOrderRequest(body: any): { valid: boolean; error?: string } {
  if (!body.tokenIn || typeof body.tokenIn !== 'string') {
    return { valid: false, error: 'tokenIn is required and must be a string' };
  }

  if (!body.tokenOut || typeof body.tokenOut !== 'string') {
    return { valid: false, error: 'tokenOut is required and must be a string' };
  }

  if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0) {
    return { valid: false, error: 'amount is required and must be a positive number' };
  }

  if (body.slippage === undefined || typeof body.slippage !== 'number' || body.slippage < 0 || body.slippage > 1) {
    return { valid: false, error: 'slippage is required and must be between 0 and 1' };
  }

  if (body.tokenIn === body.tokenOut) {
    return { valid: false, error: 'tokenIn and tokenOut must be different' };
  }

  return { valid: true };
}

/**
 * POST /api/orders/execute
 * Submit a new market order and upgrade to WebSocket for status updates
 */
export async function executeOrder(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as OrderSubmitBody;

  // Validate request
  const validation = validateOrderRequest(body);
  if (!validation.valid) {
    return reply.code(400).send({
      error: 'Invalid request',
      message: validation.error,
    });
  }

  try {
    // Create order in database
    const order = await OrderModel.create(
      body.tokenIn,
      body.tokenOut,
      body.amount,
      body.slippage
    );

    // Check if client wants WebSocket upgrade
    if (request.headers.upgrade === 'websocket') {
      // Upgrade to WebSocket
      await reply.hijack();
      
      request.server.websocketServer.handleUpgrade(request.raw, request.raw.socket, Buffer.alloc(0), (ws) => {
        // Register WebSocket connection for this order
        registerConnection(order.id, ws);

        // Send initial status
        broadcastStatus({
          orderId: order.id,
          status: 'pending',
          timestamp: new Date().toISOString(),
          data: {
            tokenIn: order.tokenIn,
            tokenOut: order.tokenOut,
            amount: order.amount,
            slippage: order.slippage,
          },
        });

        // Add order to processing queue
        addOrderToQueue(order.id).catch(error => {
          console.error(`Failed to add order ${order.id} to queue:`, error);
          broadcastStatus({
            orderId: order.id,
            status: 'failed',
            timestamp: new Date().toISOString(),
            data: { error: 'Failed to queue order' },
          });
        });
      });
    } else {
      // Regular HTTP response
      reply.code(201).send({
        orderId: order.id,
        status: order.status,
        message: 'Order created successfully. Connect via WebSocket for real-time updates.',
        websocketUrl: `/api/orders/execute?orderId=${order.id}`,
      });

      // Still add to queue
      await addOrderToQueue(order.id);
    }
  } catch (error) {
    console.error('Error creating order:', error);
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to create order',
    });
  }
}

/**
 * GET /api/orders/:orderId
 * Get order status and details
 */
export async function getOrder(request: FastifyRequest, reply: FastifyReply) {
  const { orderId } = request.params as { orderId: string };

  try {
    const order = await OrderModel.getById(orderId);

    if (!order) {
      return reply.code(404).send({
        error: 'Not found',
        message: 'Order not found',
      });
    }

    return reply.send({
      orderId: order.id,
      tokenIn: order.tokenIn,
      tokenOut: order.tokenOut,
      amount: order.amount,
      slippage: order.slippage,
      status: order.status,
      selectedDex: order.selectedDex,
      executedPrice: order.executedPrice,
      amountOut: order.amountOut,
      txHash: order.txHash,
      errorMessage: order.errorMessage,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch order',
    });
  }
}

/**
 * GET /api/orders
 * Get recent orders
 */
export async function getOrders(request: FastifyRequest, reply: FastifyReply) {
  const { limit } = request.query as { limit?: string };
  const limitNum = limit ? parseInt(limit, 10) : 50;

  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return reply.code(400).send({
      error: 'Invalid request',
      message: 'limit must be between 1 and 100',
    });
  }

  try {
    const orders = await OrderModel.getRecent(limitNum);
    return reply.send({
      orders: orders.map(order => ({
        orderId: order.id,
        tokenIn: order.tokenIn,
        tokenOut: order.tokenOut,
        amount: order.amount,
        status: order.status,
        selectedDex: order.selectedDex,
        txHash: order.txHash,
        createdAt: order.createdAt,
      })),
      count: orders.length,
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch orders',
    });
  }
}
