"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueManager = exports.QueueManager = exports.QUEUE_NAME = void 0;
const speech_1 = require("../providers/speech");
const canonicalTranscript_1 = require("../services/canonicalTranscript");
const voiceRoleAttribution_1 = require("../services/voiceRoleAttribution");
const llm_1 = require("../providers/llm");
const groundingValidator_1 = require("../services/groundingValidator");
const documentGenerator_1 = require("../services/documentGenerator");
const auditLogger_1 = require("../services/auditLogger");
const client_1 = require("@prisma/client");
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
exports.QUEUE_NAME = 'vabatim-clinical-pipeline';
class QueueManager {
    speech = (0, speech_1.getSpeechProvider)();
    llm = (0, llm_1.getLLMProvider)();
    validator = new groundingValidator_1.GroundingValidator();
    docGen = new documentGenerator_1.DocumentGeneratorService();
    queue = null;
    constructor() {
        // Constructing the Queue opens a Redis connection that keeps the event loop alive.
        // Under test that turns a passing suite into a hang, and a test run should not be
        // reaching the network in any case.
        if (process.env.NODE_ENV === 'test')
            return;
        try {
            const connection = (0, redis_1.getBullMQRedisOptions)();
            this.queue = new bullmq_1.Queue(exports.QUEUE_NAME, { connection });
        }
        catch (err) {
            console.warn('[QueueManager]: Redis queue unavailable - background processing disabled');
        }
    }
    /** True when a durable queue is available to accept background work. */
    isQueueAvailable() {
        return this.queue !== null;
    }
    /**
     * Queue-mode entry point for documentation generation. Present so the interface exists for
     * a future paid deployment; the free MVP runs the same pipeline inline instead.
     */
    async enqueueDocumentationJob(jobId, input) {
        if (!this.queue)
            throw new Error('[QueueManager] No queue available for documentation job.');
        // Without attempts/backoff, BullMQ's default is a single attempt: a transient failure
        // (a momentary 5xx from the speech or LLM provider) failed the job permanently, with
        // only a console log and no automatic retry or visibility that a meeting had stalled.
        return this.queue.add('generate-documentation', { jobId, input }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    }
    async enqueueMeetingJob(meetingId, audioUri, clinicianName, clientRef, templateType = 'INITIAL_ASSESSMENT', sessionFormat = 'FACE_TO_FACE', recognition = {}) {
        if (this.queue) {
            const job = await this.queue.add('process-meeting', {
                meetingId,
                audioUri,
                clinicianName,
                clientRef,
                templateType,
                sessionFormat,
                recognition
            }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
            console.log(`[QueueManager]: Enqueued meeting job ${job.id} for meeting ${meetingId}`);
            return job;
        }
        else {
            console.log(`[QueueManager]: Redis queue offline, executing pipeline synchronously for meeting ${meetingId}`);
            return this.processFullMeetingPipeline(meetingId, audioUri, clinicianName, clientRef, templateType, sessionFormat, recognition);
        }
    }
    async processFullMeetingPipeline(meetingId, audioUri, clinicianName, clientRef, templateType = 'INITIAL_ASSESSMENT', sessionFormat = 'FACE_TO_FACE', recognition = {}) {
        console.log(`[QueueManager]: Starting async pipeline for meeting ${meetingId} (Template: ${templateType})...`);
        // 1. Audio Processing & Speech Recognition
        auditLogger_1.auditLogger.log({
            organisationId: 'NHS-UK-TRUST-01',
            actorId: 'system',
            eventType: 'TRANSCRIPTION_STARTED',
            resourceType: 'Meeting',
            resourceId: meetingId
        });
        const rawTranscript = await this.speech.transcribe(audioUri, {
            expectedSpeakerCount: recognition.expectedSpeakerCount ?? 2,
            enableDiarization: true,
            additionalPhrases: recognition.sessionPhrases ?? []
        });
        // 2. Canonicalisation, with each diarised voice attributed to a clinical role from the
        // conversation itself rather than from a fixed speaker-number convention.
        const { segments: canonicalSegments, attribution } = (0, canonicalTranscript_1.normalizeWithVoiceAttribution)(meetingId, rawTranscript, { knownAssignments: recognition.knownSpeakers });
        console.log(`[QueueManager]: ${(0, voiceRoleAttribution_1.describeAttribution)(attribution)}`);
        // 3. AI Extraction via the configured clinical language model.
        // This pipeline previously called the deterministic keyword extractor directly, so the
        // background path produced a mechanical note while the synchronous route used the LLM.
        const extractedNote = await this.llm.extractStructuredNote(canonicalSegments);
        extractedNote.templateType = templateType;
        // Attribution is inference. The clinician is told what was inferred and asked to confirm
        // it, rather than the note presenting it as established fact.
        extractedNote.voiceAttribution = attribution.assignments;
        if (attribution.requiresClinicianConfirmation) {
            extractedNote.warnings = {
                ...(extractedNote.warnings ?? { warningMessages: [] }),
                warningMessages: [
                    ...(extractedNote.warnings?.warningMessages ?? []),
                    `Speaker attribution was inferred from the conversation and needs confirmation. ${(0, voiceRoleAttribution_1.describeAttribution)(attribution)}`
                ]
            };
            extractedNote.clinicianReviewFlags = [
                ...(extractedNote.clinicianReviewFlags ?? []),
                {
                    flagType: 'UNDER_SPECIFIED',
                    description: `Confirm speaker attribution before approving. ${(0, voiceRoleAttribution_1.describeAttribution)(attribution)}`,
                    segmentIds: []
                }
            ];
        }
        extractedNote.sessionFormat = sessionFormat;
        if (extractedNote.sessionInfo) {
            extractedNote.sessionInfo.clientReference = clientRef;
            extractedNote.sessionInfo.clinicianName = clinicianName;
            extractedNote.sessionInfo.templateType = templateType;
            extractedNote.sessionInfo.sessionFormat = sessionFormat;
        }
        // 4. Grounding Validation
        const validationResult = this.validator.validate(extractedNote, canonicalSegments);
        if (!validationResult.isValid) {
            console.warn(`[QueueManager]: Grounding validation flagged unsupported claims in meeting ${meetingId}. Details:`, validationResult.rejectedClaims);
        }
        // 5. Document Generation (PDF & DOCX)
        const meta = {
            meetingId,
            clinicianName,
            clientReference: clientRef,
            organisationName: 'UK NHS Seating & Mobility Trust',
            meetingDate: new Date().toLocaleDateString('en-GB'),
            approvedAt: 'Pending Clinician Sign-off',
            approvedBy: 'Unapproved Draft',
            documentVersion: 'Draft v1'
        };
        const pdfBuffer = await this.docGen.generatePDF(meta, validationResult.validatedNote);
        const docxBuffer = await this.docGen.generateDOCX(meta, validationResult.validatedNote);
        auditLogger_1.auditLogger.log({
            organisationId: 'NHS-UK-TRUST-01',
            actorId: 'system',
            eventType: 'NOTE_GENERATED',
            resourceType: 'ClinicalNote',
            resourceId: meetingId,
            details: { groundedCount: validationResult.groundedClaimsCount, pdfSizeBytes: pdfBuffer.length }
        });
        return {
            meetingId,
            status: client_1.MeetingState.PENDING_REVIEW,
            canonicalSegments,
            validatedNote: validationResult.validatedNote,
            validationResult,
            pdfBuffer,
            docxBuffer
        };
    }
}
exports.QueueManager = QueueManager;
exports.queueManager = new QueueManager();
