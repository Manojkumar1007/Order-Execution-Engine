import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { initDatabase } from './config/database.js';
import redis from './config/redis.js';
import { executeOrder, getOrder, getOrders } from './routes/orders.js';
import { getQueueMetrics, initWorker } from './queues/order-queue.js';

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: config.server.env === 'development' ? 'info' : 'warn',
  },
});

// Register WebSocket plugin
await fastify.register(websocket, {
  options: {
    maxPayload: 1048576, // 1MB
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register Static files
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/', // optional: default '/'
});

// Health check endpoint
fastify.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.server.env,
  };
});

// Queue metrics endpoint
fastify.get('/api/metrics', async () => {
  const metrics = await getQueueMetrics();
  return {
    queue: metrics,
    timestamp: new Date().toISOString(),
  };
});

// Order routes
// Order routes
fastify.post('/api/orders/execute', executeOrder);
fastify.get('/api/orders', getOrders);
fastify.get('/api/orders/:orderId', getOrder);
// WebSocket route
fastify.get('/api/orders/:orderId/ws', { websocket: true }, (connection, req) => {
  return import('./routes/orders.js').then(m => m.subscribeToOrder(connection, req));
});



// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('\nShutting down gracefully...');

  try {
    await fastify.close();
    await redis.quit();
    console.log('✓ Server closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const start = async () => {
  try {
    // Connect to Redis if not already connected
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }

    // Initialize database
    await initDatabase();

    // Initialize worker
    initWorker();

    // Start server
    await fastify.listen({
      port: config.server.port,
      host: '0.0.0.0',
    });

    console.log(`
Server started successfully!
Environment: ${config.server.env}
Port: ${config.server.port}
WebSocket: Enabled
Queue Concurrency: ${config.queue.concurrency}
Max Retries: ${config.queue.maxRetries}
Database URI: ${config.database.url}
REDIS URI: ${config.redis.url}

Available endpoints:
  POST /api/orders/execute
  GET  /api/orders/:orderId
  GET  /api/orders
  GET  /api/metrics
  GET  /health
    `);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
