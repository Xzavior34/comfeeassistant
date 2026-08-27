import { CorsOptions } from 'cors';

/**
 * CORS allowlist.
 *
 * Two failure modes are being avoided here. The first is the one that took production down:
 * an allowlist assembled purely from environment variables silently reduces to localhost
 * when those variables are unset, and every browser request from the deployed frontend is
 * rejected. The known production origins are therefore compiled in as a floor, and
 * environment configuration extends that floor rather than replacing it.
 *
 * The second is over-correcting to `origin: '*'`, which on authenticated clinical endpoints
 * would let any website on the internet issue requests with the clinician's credentials.
 * That is never done here.
 */

/**
 * Origins that are always permitted. These are the project's own deployed frontends; losing
 * them to a missing environment variable is a production outage, not a security control.
 */
const BUILT_IN_ORIGINS = [
  'https://comfeeassistant.vercel.app'
];

/** Development origins, permitted only outside production. */
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

/** Vercel generates a unique hostname per preview deployment. */
const VERCEL_PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const appBase = (env.APP_BASE_URL ?? '').trim().replace(/\/$/, '');

  const origins = [...BUILT_IN_ORIGINS, ...configured];
  if (appBase && /^https?:\/\//.test(appBase)) origins.push(appBase);

  if (env.NODE_ENV !== 'production') origins.push(...DEV_ORIGINS);

  return Array.from(new Set(origins));
}

export function isOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  // No Origin header: same-origin navigation, a health check, or a server-to-server call.
  // These are not cross-origin browser requests and CORS does not apply to them.
  if (!origin) return true;

  const normalised = origin.replace(/\/$/, '');
  if (buildAllowedOrigins(env).includes(normalised)) return true;

  // Preview deployments of this project's own frontend, enabled explicitly.
  if (env.ALLOW_VERCEL_PREVIEWS === 'true' && VERCEL_PREVIEW.test(normalised)) return true;

  return false;
}

export function buildCorsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, env)) return callback(null, true);

      // Logged as metadata only. The rejection is surfaced as a clean 403 by the middleware
      // below rather than thrown, because throwing produced an opaque 500 through the global
      // error handler and told nobody which origin was refused.
      console.warn(`[cors] Rejected origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    // Preflight must succeed for the browser to send the real request at all.
    optionsSuccessStatus: 204
  };
}

/**
 * Turns a disallowed origin into an explicit, diagnosable 403.
 *
 * Placed after the cors middleware, which by design simply omits the
 * Access-Control-Allow-Origin header for a rejected origin. Without this the request
 * proceeds server-side and only fails in the browser, which makes the cause hard to see
 * from the API logs.
 */
export function rejectDisallowedOrigin(env: NodeJS.ProcessEnv = process.env) {
  return (req: any, res: any, next: any) => {
    const origin = req.headers.origin as string | undefined;
    if (isOriginAllowed(origin, env)) return next();

    return res.status(403).json({
      error: 'Origin not allowed',
      message:
        'This origin is not permitted to call the Vabatim API. If this is your frontend, add ' +
        'its URL to CORS_ORIGIN on the API service.',
      origin
    });
  };
}
