import { redisConnection } from '../config/redis';
import { env } from '../config/env';

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  remaining?: number;
  nextHourDate?: Date;
  nextHourIso?: string;
  delayMs?: number;
}

const CHECK_AND_INCR_LUA = `
local key = KEYS[1]
local maxLimit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key) or "0")
if current >= maxLimit then
  return {0, current}
end

local newCount = redis.call('INCR', key)
if newCount == 1 then
  redis.call('EXPIRE', key, ttl)
end
return {1, newCount}
`;

export const rateLimiterService = {
  /**
   * Helper to format current hour bucket string e.g. "2026-09-10T19"
   */
  getCurrentHourKey(date: Date = new Date()): string {
    return date.toISOString().slice(0, 13);
  },

  /**
   * Calculate next hour start timestamp and remaining delay in milliseconds.
   */
  getNextHourWindow(now: Date = new Date()): { nextHour: Date; delayMs: number } {
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    // Add 500ms safety buffer so the job lands securely inside the new window
    const delayMs = Math.max(1000, nextHour.getTime() - now.getTime() + 500);
    return { nextHour, delayMs };
  },

  /**
   * Atomically checks if the sender is under their hourly limit and increments if so.
   * Key pattern: rate_limit:senderId:currentHour
   */
  async checkAndIncrementSenderLimit(
    senderId: string,
    maxLimitOverride?: number
  ): Promise<RateLimitCheckResult> {
    const maxLimit = maxLimitOverride !== undefined ? maxLimitOverride : env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    const now = new Date();
    const hourBucket = this.getCurrentHourKey(now);
    const redisKey = `rate_limit:${senderId}:${hourBucket}`;
    const ttlSeconds = 7200; // 2 hours TTL so memory is automatically reclaimed

    try {
      // Execute atomic Lua check-and-increment
      const [allowedNum, count] = (await redisConnection.eval(
        CHECK_AND_INCR_LUA,
        1,
        redisKey,
        maxLimit.toString(),
        ttlSeconds.toString()
      )) as [number, number];

      if (allowedNum === 1) {
        return {
          allowed: true,
          currentCount: count,
          maxLimit,
          remaining: Math.max(0, maxLimit - count),
        };
      }

      // Quota exceeded: calculate next hour window for non-destructive rescheduling
      const { nextHour, delayMs } = this.getNextHourWindow(now);
      return {
        allowed: false,
        currentCount: count,
        maxLimit,
        nextHourDate: nextHour,
        nextHourIso: nextHour.toISOString(),
        delayMs,
      };
    } catch (error: any) {
      console.error(`⚠️ [RateLimiter] Redis error checking limit for sender ${senderId}:`, error.message);
      // Resilient degradation: allow through if Redis error occurs to prevent dropping
      return {
        allowed: true,
        currentCount: 1,
        maxLimit,
        remaining: maxLimit - 1,
      };
    }
  },

  /**
   * Enforces minimum spacing between consecutive emails from the same sender.
   * Uses Redis timestamp key: last_sent:senderId
   */
  async enforceMinDelay(senderId: string, minDelaySecOverride?: number): Promise<number> {
    const minDelaySeconds =
      minDelaySecOverride !== undefined ? minDelaySecOverride : env.MIN_EMAIL_DELAY_SECONDS;
    if (minDelaySeconds <= 0) return 0;

    const minDelayMs = minDelaySeconds * 1000;
    const lastSentKey = `last_sent:${senderId}`;

    try {
      const lastSentVal = await redisConnection.get(lastSentKey);
      let waitedMs = 0;

      if (lastSentVal) {
        const lastSentTimestamp = parseInt(lastSentVal, 10);
        const elapsed = Date.now() - lastSentTimestamp;
        if (elapsed < minDelayMs) {
          waitedMs = minDelayMs - elapsed;
          console.log(
            `⏱️ [RateLimiter] Enforcing MIN_EMAIL_DELAY_SECONDS (${minDelaySeconds}s) for sender ${senderId}. Waiting ${waitedMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitedMs));
        }
      }

      await redisConnection.set(lastSentKey, Date.now().toString(), 'EX', 86400);
      return waitedMs;
    } catch (error: any) {
      console.warn(`⚠️ [RateLimiter] Error enforcing min delay for sender ${senderId}:`, error.message);
      return 0;
    }
  },

  /**
   * Get current rate limit status for inspection or APIs.
   */
  async getSenderRateLimitStatus(senderId: string): Promise<{
    currentHour: string;
    used: number;
    maxLimit: number;
    remaining: number;
    resetsAt: string;
  }> {
    const now = new Date();
    const hourBucket = this.getCurrentHourKey(now);
    const redisKey = `rate_limit:${senderId}:${hourBucket}`;
    const usedVal = await redisConnection.get(redisKey);
    const used = usedVal ? parseInt(usedVal, 10) : 0;
    const { nextHour } = this.getNextHourWindow(now);

    return {
      currentHour: hourBucket,
      used,
      maxLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      remaining: Math.max(0, env.MAX_EMAILS_PER_HOUR_PER_SENDER - used),
      resetsAt: nextHour.toISOString(),
    };
  },

  /**
   * Clears the sender's current hourly rate limit counter (useful for testing).
   */
  async resetSenderRateLimit(senderId: string): Promise<void> {
    const hourBucket = this.getCurrentHourKey();
    const redisKey = `rate_limit:${senderId}:${hourBucket}`;
    const lastSentKey = `last_sent:${senderId}`;
    await redisConnection.del(redisKey, lastSentKey);
  },
};
