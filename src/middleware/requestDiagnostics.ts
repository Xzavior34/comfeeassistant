import { Request } from 'express';

/**
 * Safe request diagnostics.
 *
 * When a clinician reports "it said Invalid request body", the logs must be enough to find
 * the cause without anyone opening a patient's consultation. This records the shape of a
 * request — route, status, content type and length, which fields failed validation — and
 * never its content.
 *
 * The deny-list is explicit rather than implied, because the cost of getting it wrong is a
 * patient conversation in an ordinary application log.
 */

/** Keys whose values must never be logged, at any nesting depth. */
const NEVER_LOG = new Set([
  'transcript',
  'transcripttext',
  'segments',
  'text',
  'rawtext',
  'audio',
  'audiobase64',
  'sourcequote',
  'source_quote',
  'value',
  'password',
  'token',
  'authorization',
  'jwt',
  'apikey',
  'api_key',
  'secret',
  'servicerolekey'
]);

/** Field names only — used to describe a payload's shape without revealing any of it. */
export function describeShape(body: unknown, depth = 0): string[] {
  if (depth > 2 || body === null || typeof body !== 'object') return [];

  const out: string[] = [];
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const safeKey = key.toLowerCase();

    if (Array.isArray(value)) {
      out.push(`${key}[${value.length}]`);
      continue;
    }
    if (value && typeof value === 'object') {
      out.push(`${key}{${describeShape(value, depth + 1).join(',')}}`);
      continue;
    }
    if (NEVER_LOG.has(safeKey)) {
      // Length is diagnostic; content is not ours to log.
      out.push(`${key}:<${typeof value === 'string' ? `${value.length} chars` : typeof value}>`);
      continue;
    }
    out.push(`${key}=${typeof value === 'string' ? value.slice(0, 40) : String(value)}`);
  }
  return out;
}

export interface RequestDiagnostics {
  finish(status: number, extra?: Record<string, unknown>): void;
}

export function logRequestDiagnostics(req: Request, label: string): RequestDiagnostics {
  const started = Date.now();
  const contentType = req.headers['content-type'] ?? 'none';
  const contentLength = req.headers['content-length'] ?? 'unknown';
  const origin = req.headers.origin ?? 'none';

  return {
    finish(status: number, extra: Record<string, unknown> = {}) {
      // Payload shape is logged only on a client error, where it is the thing being
      // diagnosed. A successful request does not need it.
      const shape =
        status >= 400 && status < 500 ? ` fields=[${describeShape(req.body).join(', ')}]` : '';

      const extras = Object.entries(extra)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join('|')}]` : String(v)}`)
        .join(' ');

      console.log(
        `[req] ${label} status=${status} ms=${Date.now() - started} ` +
          `content-type=${contentType} content-length=${contentLength} origin=${origin} ` +
          `${extras}${shape}`
      );
    }
  };
}
