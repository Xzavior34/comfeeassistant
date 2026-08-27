import { prisma } from '../db';
import { processingJobStore } from './processingJobStore';
import { ClinicalExtractionEngine, ModelClient } from '../clinical/extractionEngine';
import { buildNarrative } from '../clinical/narrative';
import { auditLogger } from './auditLogger';
import { getClinicalModelClient } from '../providers/llm/modelClient';

/**
 * Generates a clinical assessment note from a frozen transcript.
 *
 * Processing mode is a deployment concern, not a product one, so it is abstracted here:
 *
 *   INLINE  the web service runs the work itself, immediately after persisting the job.
 *           This is the zero-cost configuration and needs no queue, no Redis and no
 *           background worker.
 *   QUEUE   the job is handed to a durable queue for a dedicated worker. Available when
 *           paid infrastructure justifies it; the calling code is identical.
 *
 * In both modes the job row is written to the database BEFORE any work starts. That is what
 * makes a refresh, a navigation away, or a service restart survivable: the clinician's
 * session is recoverable from persisted state rather than living in a held HTTP request.
 */

export type ProcessingMode = 'inline' | 'queue';

export function getProcessingMode(): ProcessingMode {
  return process.env.PROCESSING_MODE === 'queue' ? 'queue' : 'inline';
}

export interface StartDocumentationInput {
  meetingId: string;
  organisationId: string;
  transcript: string;
  clinicianName: string;
  clientReference: string;
  templateType: 'INITIAL_ASSESSMENT' | 'REVIEW';
  sessionFormat: 'FACE_TO_FACE' | 'VIRTUAL';
  actorId: string;
}

export class DocumentationService {
  constructor(private modelClient?: ModelClient) {}

  /**
   * Persists the job, then starts the work.
   *
   * Returns as soon as the job exists. The HTTP request is not held open for the duration of
   * generation: a long consultation can take minutes, and a proxy or a phone changing
   * network would drop that connection and strand the work.
   */
  async start(input: StartDocumentationInput): Promise<{ jobId: string }> {
    const job = await processingJobStore.create(input.meetingId, input.organisationId);

    auditLogger.log({
      organisationId: input.organisationId,
      actorId: input.actorId,
      eventType: 'DOCUMENTATION_REQUESTED',
      resourceType: 'Meeting',
      resourceId: input.meetingId,
      // Length only. Transcript content never enters an audit record or a log line.
      details: { jobId: job.id, transcriptChars: input.transcript.length }
    });

    if (getProcessingMode() === 'queue') {
      const { queueManager } = await import('../queues/queueManager');
      if (queueManager.isQueueAvailable()) {
        await queueManager.enqueueDocumentationJob(job.id, input);
        return { jobId: job.id };
      }
      console.warn('[documentation] PROCESSING_MODE=queue but no queue is available; running inline.');
    }

    // Not awaited: the response returns immediately and the client polls the job. Errors are
    // captured onto the job row, never left as an unhandled rejection.
    void this.run(job.id, input).catch(async (err) => {
      console.error('[documentation] Unhandled failure:', err?.message ?? err);
      await processingJobStore.fail(job.id, String(err?.message ?? err));
    });

    return { jobId: job.id };
  }

  /**
   * The actual pipeline. Public so the queue worker can call exactly the same code path in
   * queue mode — the two modes must never diverge in behaviour.
   */
  async run(jobId: string, input: StartDocumentationInput): Promise<void> {
    const model = this.modelClient ?? getClinicalModelClient();

    try {
      await processingJobStore.markRunning(jobId);

      const engine = new ClinicalExtractionEngine(model);

      const result = await engine.extract(input.transcript, {
        onProgress: (stage, progress) => {
          void processingJobStore.progress(jobId, stage, progress);
        }
      });

      await processingJobStore.progress(jobId, 'Preparing review', 90);

      const narrative = buildNarrative(result.extraction);

      // Cast for the same reason as processingJobStore: narrativeJson and the extended
      // NoteStatus values exist in schema.prisma but not in a client generated before the
      // migration. `prisma generate` runs in the build command, so this is inert on deploy.
      const note = await prisma.clinicalNote.create({
        data: {
          meetingId: input.meetingId,
          structuredJson: result.extraction as any,
          narrativeJson: narrative as any,
          // AI output is never presented as clinician-approved.
          status: 'REVIEW_REQUIRED' as any,
          aiModel: model.name ?? 'gemini',
          promptVersion: result.promptVersion,
          versions: {
            create: [
              {
                versionNumber: 1,
                structuredJson: result.extraction as any,
                authorType: 'AI',
                status: 'REVIEW_REQUIRED' as any
              }
            ]
          }
        } as any
      });

      await prisma.meeting.update({
        where: { id: input.meetingId },
        data: { status: 'PENDING_REVIEW' }
      });

      await processingJobStore.succeed(jobId, note.id);

      auditLogger.log({
        organisationId: input.organisationId,
        actorId: 'system',
        eventType: 'DOCUMENTATION_GENERATED',
        resourceType: 'ClinicalNote',
        resourceId: note.id,
        details: {
          jobId,
          facts: result.extraction.facts.length,
          reviewFlags: result.extraction.review_flags.length,
          chunks: result.chunksProcessed,
          repairAttempts: result.repairAttempts,
          ungroundedDropped: result.ungroundedDropped.length
        }
      });
    } catch (err: any) {
      // The transcript is already persisted on the meeting, so a failure here costs the
      // clinician a retry, never the consultation.
      const message = err?.message ?? String(err);
      console.error(`[documentation] Job ${jobId} failed: ${message}`);
      await processingJobStore.fail(jobId, message);

      await prisma.meeting
        .update({ where: { id: input.meetingId }, data: { status: 'FAILED' } })
        .catch(() => undefined);
    }
  }
}

export const documentationService = new DocumentationService();
