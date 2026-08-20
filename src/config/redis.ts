import { Redis as UpstashRedis } from '@upstash/redis';
import { env } from './env';

/**
 * Upstash Redis REST Client (for lightweight key-value state & rate limiting)
 */
export function createUpstashRestClient(): UpstashRedis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return new UpstashRedis({ url, token });
  }

  return null;
}

/**
 * BullMQ Redis Connection Options (for background queue processing via rediss://)
 */
export function getBullMQRedisOptions() {
  const redisUrl = env.REDIS_URL;
  if (!redisUrl) {
    return { host: 'localhost', port: 6379 };
  }

  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined
    };
  } catch (err) {
    return { host: 'localhost', port: 6379 };
  }
}
