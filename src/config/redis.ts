import Redis from 'ioredis';
import { config } from './index.js';

// Create Redis client for caching active orders
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null, // Required for BullMQ
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redis.on('connect', () => {
  console.log('✓ Redis connected successfully');
});

export default redis;
