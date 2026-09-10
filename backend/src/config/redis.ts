import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';

const redisOptions: RedisOptions = {
  host: env.REDIS_HOST || '127.0.0.1',
  port: env.REDIS_PORT || 6379,
  family: 4,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
};


export const bullMqConnectionOptions: RedisOptions = {
  host: env.REDIS_HOST || '127.0.0.1',
  port: env.REDIS_PORT || 6379,
  family: 4,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
};

export const redisConnection = new Redis(bullMqConnectionOptions);

redisConnection.on('connect', () => {
  console.log('⚡ Connected to Redis successfully');
});

redisConnection.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

