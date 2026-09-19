"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentationService = exports.DocumentationService = void 0;
exports.getProcessingMode = getProcessingMode;
const db_1 = require("../db");
const processingJobStore_1 = require("./processingJobStore");
const extractionEngine_1 = require("../clinical/extractionEngine");
const narrative_1 = require("../clinical/narrative");
const auditLogger_1 = require("./auditLogger");
const modelClient_1 = require("../providers/llm/modelClient");
function getProcessingMode() {
    return process.env.PROCESSING_MODE === 'queue' ? 'queue' : 'inline';
}
class DocumentationService {
    modelClient;
    constructor(modelClient) {
        this.modelClient = modelClient;
    }
    /**
     * Persists the job, then starts the work.
     *
     * Returns as soon as the job exists. The HTTP request is not held open for the duration of
     * generation: a long consultation can take minutes, and a proxy or a phone changing
     * network would drop that connection and strand the work.
     */
    async start(input) {
        const job = await processingJobStore_1.processingJobStore.create(input.meetingId, input.organisationId);
        auditLogger_1.auditLogger.log({
            organisationId: input.organisationId,
            actorId: input.actorId,
            eventType: 'DOCUMENTATION_REQUESTED',
            resourceType: 'Meeting',
            resourceId: input.meetingId,
            // Length only. Transcript content never enters an audit record or a log line.
            details: { jobId: job.id, transcriptChars: input.transcript.length }
        });
        if (getProcessingMode() === 'queue') {
            const { queueManager } = await Promise.resolve().then(() => __importStar(require('../queues/queueManager')));
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
            await processingJobStore_1.processingJobStore.fail(job.id, String(err?.message ?? err));
        });
        return { jobId: job.id };
    }
    /**
     * The actual pipeline. Public so the queue worker can call exactly the same code path in
     * queue mode — the two modes must never diverge in behaviour.
     */
    async run(jobId, input) {
        const model = this.modelClient ?? (0, modelClient_1.getClinicalModelClient)();
        try {
            await processingJobStore_1.processingJobStore.markRunning(jobId);
            const engine = new extractionEngine_1.ClinicalExtractionEngine(model);
            const result = await engine.extract(input.transcript, {
                onProgress: (stage, progress) => {
                    void processingJobStore_1.processingJobStore.progress(jobId, stage, progress);
                }
            });
            await processingJobStore_1.processingJobStore.progress(jobId, 'Preparing review', 90);
            const narrative = (0, narrative_1.buildNarrative)(result.extraction);
            // Cast for the same reason as processingJobStore: narrativeJson and the extended
            // NoteStatus values exist in schema.prisma but not in a client generated before the
            // migration. `prisma generate` runs in the build command, so this is inert on deploy.
            const note = await db_1.prisma.clinicalNote.create({
                data: {
                    meetingId: input.meetingId,
                    structuredJson: result.extraction,
                    narrativeJson: narrative,
                    // AI output is never presented as clinician-approved.
                    status: 'REVIEW_REQUIRED',
                    aiModel: model.name ?? 'gemini',
                    promptVersion: result.promptVersion,
                    versions: {
                        create: [
                            {
                                versionNumber: 1,
                                structuredJson: result.extraction,
                                authorType: 'AI',
                                status: 'REVIEW_REQUIRED'
                            }
                        ]
                    }
                }
            });
            await db_1.prisma.meeting.update({
                where: { id: input.meetingId },
                data: { status: 'PENDING_REVIEW' }
            });
            await processingJobStore_1.processingJobStore.succeed(jobId, note.id);
            auditLogger_1.auditLogger.log({
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
        }
        catch (err) {
            // The transcript is already persisted on the meeting, so a failure here costs the
            // clinician a retry, never the consultation.
            const message = err?.message ?? String(err);
            console.error(`[documentation] Job ${jobId} failed: ${message}`);
            await processingJobStore_1.processingJobStore.fail(jobId, message);
            await db_1.prisma.meeting
                .update({ where: { id: input.meetingId }, data: { status: 'FAILED' } })
                .catch(() => undefined);
        }
    }
}
exports.DocumentationService = DocumentationService;
exports.documentationService = new DocumentationService();
