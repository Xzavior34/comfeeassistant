import crypto from 'crypto';

export interface AuditEventPayload {
  organisationId: string;
  actorId: string;
  eventType: string; // AUTH_LOGIN | CONSENT_GRANTED | AUDIO_UPLOADED | TRANSCRIPT_ACCESSED | NOTE_APPROVED | DOC_ACCESSED | RETENTION_DELETED
  resourceType: string;
  resourceId: string;
  details?: Record<string, any>;
  clientIp?: string;
}

export class AuditLogger {
  private lastHash: string = '0000000000000000000000000000000000000000000000000000000000000000';

  log(event: AuditEventPayload): { id: string; recordHash: string } {
    const timestamp = new Date().toISOString();
    const id = `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const dataToHash = `${id}|${event.organisationId}|${event.actorId}|${event.eventType}|${event.resourceType}|${event.resourceId}|${timestamp}|${this.lastHash}`;
    const recordHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

    this.lastHash = recordHash;

    console.log(`[AuditLogger] [${event.eventType}] Actor: ${event.actorId} Resource: ${event.resourceType}:${event.resourceId} Hash: ${recordHash.substring(0, 12)}...`);

    return { id, recordHash };
  }
}

export const auditLogger = new AuditLogger();
