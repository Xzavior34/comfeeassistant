import { prisma } from '../db';

/**
 * Persistence for documentation-generation jobs.
 *
 * Isolated behind this module for one specific reason: the Prisma client generated in a
 * given checkout may predate the migration that adds ProcessingJob. Rather than scattering
 * casts across the codebase, every untyped access lives here and everything else consumes a
 * properly typed interface. Once `prisma generate` has run against the current schema — which
 * the build command does on every deploy — the casts are inert.
 */

export type ProcessingJobState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface ProcessingJob {
  id: string;
  meetingId: string;
  organisationId: string;
  state: ProcessingJobState;
  stage: string;
  progress: number;
  attempts: number;
  lastError: string | null;
  clinicalNoteId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

// See the note above: the delegate is absent from the generated types until the migration
// has been applied and the client regenerated.
const jobs = () => (prisma as any).processingJob;

export const processingJobStore = {
  async create(meetingId: string, organisationId: string): Promise<ProcessingJob> {
    return jobs().create({
      data: { meetingId, organisationId, state: 'PENDING', stage: 'Queued', progress: 0 }
    });
  },

  async get(id: string): Promise<ProcessingJob | null> {
    return jobs().findUnique({ where: { id } });
  },

  /** The most recent job for a meeting, so a returning clinician sees current state. */
  async latestForMeeting(meetingId: string): Promise<ProcessingJob | null> {
    return jobs().findFirst({ where: { meetingId }, orderBy: { createdAt: 'desc' } });
  },

  async markRunning(id: string): Promise<void> {
    await jobs().update({
      where: { id },
      data: {
        state: 'RUNNING',
        startedAt: new Date(),
        stage: 'Preparing clinical documentation',
        progress: 5,
        attempts: { increment: 1 }
      }
    });
  },

  async progress(id: string, stage: string, progress: number): Promise<void> {
    // Progress reporting must never be able to fail a job. A lost progress update is
    // cosmetic; an exception here would abort a consultation's documentation.
    try {
      await jobs().update({ where: { id }, data: { stage, progress: Math.min(99, Math.max(0, progress)) } });
    } catch (err) {
      console.warn('[processingJobStore] Progress update failed (non-fatal).');
    }
  },

  async succeed(id: string, clinicalNoteId: string): Promise<void> {
    await jobs().update({
      where: { id },
      data: {
        state: 'SUCCEEDED',
        stage: 'Ready for review',
        progress: 100,
        clinicalNoteId,
        finishedAt: new Date()
      }
    });
  },

  async fail(id: string, message: string): Promise<void> {
    await jobs().update({
      where: { id },
      data: {
        state: 'FAILED',
        stage: 'Failed',
        // Never persist transcript content in an error field.
        lastError: message.slice(0, 500),
        finishedAt: new Date()
      }
    });
  },

  /**
   * Jobs left RUNNING with no recent update.
   *
   * On free hosting the web service can be stopped mid-job. Without this, such a job would
   * show "Generating…" forever. Finding them lets the clinician retry rather than wonder.
   */
  async findStalled(olderThanMs = 10 * 60 * 1000): Promise<ProcessingJob[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    return jobs().findMany({
      where: { state: 'RUNNING', updatedAt: { lt: cutoff } },
      take: 50
    });
  },

  async reopenForRetry(id: string): Promise<void> {
    await jobs().update({
      where: { id },
      data: { state: 'PENDING', stage: 'Queued for retry', progress: 0, lastError: null, finishedAt: null }
    });
  }
};
