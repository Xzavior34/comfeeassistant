import { getSpeechProvider } from '../providers/speech';
import { normalizeToCanonicalTranscript } from '../services/canonicalTranscript';
import { AIExtractionService } from '../services/aiExtraction';
import { GroundingValidator } from '../services/groundingValidator';
import { DocumentGeneratorService } from '../services/documentGenerator';
import { auditLogger } from '../services/auditLogger';
import { MeetingState } from '@prisma/client';
import { validateStateTransition } from '../state/meetingStateMachine';

export class QueueManager {
  private speech = getSpeechProvider();
  private ai = new AIExtractionService();
  private validator = new GroundingValidator();
  private docGen = new DocumentGeneratorService();

  async processFullMeetingPipeline(meetingId: string, audioUri: string, clinicianName: string, clientRef: string) {
    console.log(`[QueueManager]: Starting async pipeline for meeting ${meetingId}...`);

    // 1. Audio Processing & Speech Recognition
    auditLogger.log({
      organisationId: 'NHS-UK-TRUST-01',
      actorId: 'system',
      eventType: 'TRANSCRIPTION_STARTED',
      resourceType: 'Meeting',
      resourceId: meetingId
    });

    const rawTranscript = await this.speech.transcribe(audioUri, { expectedSpeakerCount: 2, enableDiarization: true });

    // 2. Canonicalization
    const canonicalSegments = normalizeToCanonicalTranscript(meetingId, rawTranscript);

    // 3. AI Extraction
    const extractedNote = await this.ai.extractStructuredClinicalNote(canonicalSegments);

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

    auditLogger.log({
      organisationId: 'NHS-UK-TRUST-01',
      actorId: 'system',
      eventType: 'NOTE_GENERATED',
      resourceType: 'ClinicalNote',
      resourceId: meetingId,
      details: { groundedCount: validationResult.groundedClaimsCount, pdfSizeBytes: pdfBuffer.length }
    });

    return {
      meetingId,
      status: MeetingState.PENDING_REVIEW,
      canonicalSegments,
      validatedNote: validationResult.validatedNote,
      validationResult,
      pdfBuffer,
      docxBuffer
    };
  }
}

export const queueManager = new QueueManager();
