import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';

/**
 * Parses and resolves Redis connection options, strictly prioritizing REDIS_URL.
 * Supports standard redis://, secure rediss:// (TLS), authentication, custom ports, and db indices.
 * Falls back to REDIS_HOST / REDIS_PORT or localhost:6379 for local development.
 */
function resolveRedisConfig(): {
  connectionOptions: RedisOptions;
  connectionUrl?: string;
  summary: string;
} {
  const rawUrl = (process.env.REDIS_URL || env.REDIS_URL || '').trim();

  const commonOptions: RedisOptions = {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
  };

  // If REDIS_URL is provided
  if (rawUrl && (rawUrl.startsWith('redis://') || rawUrl.startsWith('rediss://'))) {
    try {
      const parsed = new URL(rawUrl);
      const isTls = parsed.protocol === 'rediss:';
      const host = parsed.hostname || '127.0.0.1';
      const port = parsed.port ? parseInt(parsed.port, 10) : (isTls ? 6380 : 6379);

      const options: RedisOptions = {
        ...commonOptions,
        host,
        port,
        username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        db: parsed.pathname && parsed.pathname.length > 1 ? parseInt(parsed.pathname.slice(1), 10) : undefined,
        tls: isTls ? { rejectUnauthorized: false } : undefined,
      };

      return {
        connectionOptions: options,
        connectionUrl: rawUrl,
        summary: `${host}:${port}${isTls ? ' (TLS)' : ''}`,
      };
    } catch (err) {
      console.warn('⚠️ [Redis Config] Failed to parse REDIS_URL with URL parser, falling back to host/port:', err);
    }
  }

  // Fallback to separate REDIS_HOST / REDIS_PORT
  const host = process.env.REDIS_HOST || env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || env.REDIS_PORT || 6379);

  return {
    connectionOptions: {
      ...commonOptions,
      host,
      port,
    },
    summary: `${host}:${port}`,
  };
}

const config = resolveRedisConfig();

export const bullMqConnectionOptions: RedisOptions = config.connectionOptions;
export const redisSummary: string = config.summary;

// Standalone ioredis client used for rate limiting and server health
export const redisConnection = config.connectionUrl
  ? new Redis(config.connectionUrl, config.connectionOptions)
  : new Redis(config.connectionOptions);

redisConnection.on('connect', () => {
  console.log(`⚡ Connected to Redis successfully (${redisSummary})`);
});

redisConnection.on('error', (err) => {
  console.error(`❌ Redis connection error (${redisSummary}):`, err.message);
});

