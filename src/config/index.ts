import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '5000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/orderengine',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '10', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  },
  mock: {
    quoteDelayMs: parseInt(process.env.MOCK_QUOTE_DELAY_MS || '200', 10),
    executionDelayMs: parseInt(process.env.MOCK_EXECUTION_DELAY_MS || '2500', 10),
  },
};
