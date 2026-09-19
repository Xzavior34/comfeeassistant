"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUpstashRestClient = createUpstashRestClient;
exports.getBullMQRedisOptions = getBullMQRedisOptions;
const redis_1 = require("@upstash/redis");
const env_1 = require("./env");
/**
 * Upstash Redis REST Client (for lightweight key-value state & rate limiting)
 */
function createUpstashRestClient() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
        return new redis_1.Redis({ url, token });
    }
    return null;
}
/**
 * BullMQ Redis Connection Options (for background queue processing via rediss://)
 *
 * A malformed REDIS_URL used to fall back to `localhost:6379` instead of failing. On the
 * default PROCESSING_MODE=inline deployment that fallback is harmless dead code, since
 * nothing ever calls this. But PROCESSING_MODE=queue exists precisely for someone to switch
 * to later (see queueManager.ts / render.yaml's comments) — and once they do, a bad or
 * missing REDIS_URL would silently point BullMQ at a Redis that isn't there: jobs enqueue
 * without error, sit in PENDING forever, and nothing in the logs says why. env.ts already
 * fails fast at startup for JWT/LLM/speech misconfiguration; queue mode deserves the same
 * treatment rather than a quiet localhost fallback.
 */
function getBullMQRedisOptions() {
    const redisUrl = env_1.env.REDIS_URL;
    const queueModeRequested = process.env.PROCESSING_MODE === 'queue';
    if (!redisUrl) {
        if (queueModeRequested) {
            throw new Error('CRITICAL CONFIGURATION ERROR: PROCESSING_MODE=queue requires a valid REDIS_URL.');
        }
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
    }
    catch (err) {
        if (queueModeRequested) {
            throw new Error(`CRITICAL CONFIGURATION ERROR: REDIS_URL is not a valid URL ("${redisUrl}"), and ` +
                'PROCESSING_MODE=queue cannot run without one.');
        }
        return { host: 'localhost', port: 6379 };
    }
}
