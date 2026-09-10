import crypto from 'crypto';
import { prisma } from '../db';

export interface AuditEventPayload {
  organisationId: string;
  actorId: string;
  eventType: string; // AUTH_LOGIN | CONSENT_GRANTED | AUDIO_UPLOADED | TRANSCRIPT_ACCESSED | NOTE_APPROVED | DOC_ACCESSED | RETENTION_DELETED
  resourceType: string;
  resourceId: string;
  details?: Record<string, any>;
  clientIp?: string;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Tamper-evident audit trail.
 *
 * This used to only console.log each event and keep the hash chain in memory — nothing was
 * ever written to the database. `/api/audit` had no real data to read, so it returned two
 * hardcoded example rows regardless of who asked or which organisation they belonged to: a
 * false assurance of auditability for a product whose whole audit story is "every action is
 * logged." Every event is now persisted to the AuditLog table (which already existed in the
 * schema, unused), and the route below reads real rows instead of fixtures.
 *
 * The hash chain is still best-effort across a restart: it reloads the last known hash from
 * the database at startup, but a log() call made before that load resolves still chains from
 * genesis. That is a much smaller gap than resetting to genesis on every deploy, and closing
 * it fully would mean blocking every audited action on a database round trip, which is worse.
 */
export class AuditLogger {
  private lastHash: string = GENESIS_HASH;

  constructor() {
    prisma.auditLog
      .findFirst({ orderBy: { timestamp: 'desc' } })
      .then((last) => {
        if (last?.recordHash) this.lastHash = last.recordHash;
      })
      .catch((err) => {
        console.error('[AuditLogger] Could not load last hash from the database, starting a fresh chain:', err);
      });
  }

  log(event: AuditEventPayload): { id: string; recordHash: string } {
    const timestamp = new Date();
    const id = `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const dataToHash = `${id}|${event.organisationId}|${event.actorId}|${event.eventType}|${event.resourceType}|${event.resourceId}|${timestamp.toISOString()}|${this.lastHash}`;
    const recordHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

    this.lastHash = recordHash;

    console.log(`[AuditLogger] [${event.eventType}] Actor: ${event.actorId} Resource: ${event.resourceType}:${event.resourceId} Hash: ${recordHash.substring(0, 12)}...`);

    // Best-effort and never awaited by callers: a failure to persist the audit record must
    // never block or fail the clinical action it is describing.
    prisma.auditLog
      .create({
        data: {
          id,
          organisationId: event.organisationId,
          actorId: event.actorId,
          eventType: event.eventType,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          details: event.details,
          clientIp: event.clientIp,
          timestamp,
          recordHash
        }
      })
      .catch((err) => {
        console.error('[AuditLogger] Failed to persist audit event:', err);
      });

    return { id, recordHash };
  }
}

export const auditLogger = new AuditLogger();
