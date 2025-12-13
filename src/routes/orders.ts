import { FastifyRequest, FastifyReply } from 'fastify';
import { OrderModel } from '../models/order.js';
import { registerConnection } from '../services/websocket-manager.js';
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
 * Submit a new market order
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

    // Add to queue
    await addOrderToQueue(order.id);

    // Return response
    return reply.code(201).send({
      orderId: order.id,
      status: order.status,
      message: 'Order created successfully',
      websocketUrl: `/api/orders/${order.id}/ws`,
    });
  } catch (error) {
    console.error('Error creating order:', error);
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to create order',
    });
  }
}

/**
 * WebSocket handler for order updates
 * GET /api/orders/:orderId/ws
 */
export async function subscribeToOrder(connection: any, request: FastifyRequest) {
  const { orderId } = request.params as { orderId: string };

  // Handle both { socket } wrapper and direct socket (just in case)
  const socket = connection.socket || connection;

  try {
    if (!socket) {
      throw new Error('Socket is undefined');
    }

    // Verify order exists
    const order = await OrderModel.getById(orderId);
    if (!order) {
      socket.send(JSON.stringify({
        error: 'Order not found',
        orderId,
      }));
      socket.close();
      return;
    }

    // Register connection
    registerConnection(orderId, socket);

    // Send current status immediately
    socket.send(JSON.stringify({
      orderId: order.id,
      status: order.status,
      timestamp: new Date().toISOString(),
      data: {
        tokenIn: order.tokenIn,
        tokenOut: order.tokenOut,
        amount: order.amount,
        slippage: order.slippage,
        txHash: order.txHash,
        error: order.errorMessage,
      },
    }));

    // Keep connection alive
    // (Actual keep-alive logic might be needed depending on infrastructure,
    // but for this demo, we just rely on TCP)

  } catch (error) {
    console.error(`WebSocket error for order ${orderId}:`, error);
    if (socket && typeof socket.close === 'function') {
      socket.close();
    }
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
