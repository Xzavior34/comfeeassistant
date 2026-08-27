import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Signed, time-limited document links.
 *
 * The previous token was `base64url("<key>:<expiry>")` with no signature at all. Anyone
 * could construct one for any document key and any expiry they liked, which made every
 * clinical document in the system retrievable without authentication. The expiry check gave
 * the appearance of a security control while enforcing nothing.
 *
 * Tokens are now HMAC-signed with the server secret and verified in constant time.
 */

const SEPARATOR = '.';

function secret(): string {
  return env.JWT_SECRET;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createSignedLinkToken(documentKey: string, expiresInSeconds: number): string {
  const expiry = Date.now() + expiresInSeconds * 1000;
  const payload = Buffer.from(`${documentKey}:${expiry}`).toString('base64url');
  return `${payload}${SEPARATOR}${sign(payload)}`;
}

export type VerifyResult =
  | { valid: true; documentKey: string; expiry: number }
  | { valid: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };

export function verifySignedLinkToken(token: string): VerifyResult {
  if (typeof token !== 'string' || !token.includes(SEPARATOR)) {
    return { valid: false, reason: 'MALFORMED' };
  }

  const [payload, signature] = token.split(SEPARATOR);
  if (!payload || !signature) return { valid: false, reason: 'MALFORMED' };

  const expected = sign(payload);

  // Constant-time comparison: a length-sensitive or short-circuiting compare leaks how much
  // of a guessed signature was correct.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf-8');
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }

  const separatorIndex = decoded.lastIndexOf(':');
  if (separatorIndex <= 0) return { valid: false, reason: 'MALFORMED' };

  const documentKey = decoded.slice(0, separatorIndex);
  const expiry = Number(decoded.slice(separatorIndex + 1));

  if (!Number.isFinite(expiry)) return { valid: false, reason: 'MALFORMED' };
  // Signature is checked before expiry, so a forged token never reports as merely "expired".
  if (Date.now() > expiry) return { valid: false, reason: 'EXPIRED' };

  return { valid: true, documentKey, expiry };
}
