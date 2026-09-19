"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processingJobStore = void 0;
const db_1 = require("../db");
// See the note above: the delegate is absent from the generated types until the migration
// has been applied and the client regenerated.
const jobs = () => db_1.prisma.processingJob;
exports.processingJobStore = {
    async create(meetingId, organisationId) {
        return jobs().create({
            data: { meetingId, organisationId, state: 'PENDING', stage: 'Queued', progress: 0 }
        });
    },
    async get(id) {
        return jobs().findUnique({ where: { id } });
    },
    /** The most recent job for a meeting, so a returning clinician sees current state. */
    async latestForMeeting(meetingId) {
        return jobs().findFirst({ where: { meetingId }, orderBy: { createdAt: 'desc' } });
    },
    async markRunning(id) {
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
    async progress(id, stage, progress) {
        // Progress reporting must never be able to fail a job. A lost progress update is
        // cosmetic; an exception here would abort a consultation's documentation.
        try {
            await jobs().update({ where: { id }, data: { stage, progress: Math.min(99, Math.max(0, progress)) } });
        }
        catch (err) {
            console.warn('[processingJobStore] Progress update failed (non-fatal).');
        }
    },
    async succeed(id, clinicalNoteId) {
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
    async fail(id, message) {
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
    async findStalled(olderThanMs = 10 * 60 * 1000) {
        const cutoff = new Date(Date.now() - olderThanMs);
        return jobs().findMany({
            where: { state: 'RUNNING', updatedAt: { lt: cutoff } },
            take: 50
        });
    },
    async reopenForRetry(id) {
        await jobs().update({
            where: { id },
            data: { state: 'PENDING', stage: 'Queued for retry', progress: 0, lastError: null, finishedAt: null }
        });
    }
};
