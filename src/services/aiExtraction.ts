import { z } from 'zod';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../types';

export const EvidenceReferenceSchema = z.object({
  segmentId: z.string(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  sourceText: z.string()
});

export const EvidenceLinkedClaimSchema = z.object({
  value: z.string(),
  evidence: z.array(EvidenceReferenceSchema),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW'])
});

export const StructuredClinicalExtractionSchema = z.object({
  noteType: z.literal('professional_clinical_note').optional(),
  clientInformation: z.object({
    clientReference: z.string().optional(),
    sessionType: z.string().optional()
  }).optional(),
  reasonForContact: z.array(EvidenceLinkedClaimSchema).optional(),
  clientReportedInformation: z.array(EvidenceLinkedClaimSchema).optional(),
  relevantHistory: z.array(EvidenceLinkedClaimSchema).optional(),
  functionalInformation: z.array(EvidenceLinkedClaimSchema).optional(),
  observations: z.array(EvidenceLinkedClaimSchema).optional(),
  assessmentFindings: z.array(EvidenceLinkedClaimSchema).optional(),
  interventions: z.array(EvidenceLinkedClaimSchema).optional(),
  equipmentAndEnvironment: z.array(EvidenceLinkedClaimSchema).optional(),
  clinicalConsiderations: z.array(EvidenceLinkedClaimSchema).optional(),
  planAndNextSteps: z.array(EvidenceLinkedClaimSchema).optional(),
  informationRequiringReview: z.array(EvidenceLinkedClaimSchema).optional(),

  clientConcerns: z.array(EvidenceLinkedClaimSchema),
  accessibilityBarriers: z.array(EvidenceLinkedClaimSchema),
  wheelchairSeatingConcerns: z.array(EvidenceLinkedClaimSchema),
  matAssessmentInfo: z.array(EvidenceLinkedClaimSchema),
  actionsAndRecommendations: z.array(EvidenceLinkedClaimSchema),
  unstatedOrMissingFields: z.array(z.string())
});

export function generateSystemPrompt(): string {
  return `You are Vabatim, a clinical documentation assistant for UK healthcare professionals and Occupational Therapists.

Your task is to transform a spoken conversation transcript into a detailed, professional clinical note.
You are NOT a diagnostic system. You must NEVER invent clinical information, diagnoses, symptoms, measurements, or recommendations.

STRICT CLINICAL DOCUMENTATION RULES:
1. Extract information strictly and exclusively from the provided canonical transcript.
2. Transform spoken text into clean, professional clinical documentation.
3. Speech-Recognition Typo Correction: You may correct obvious device speech recognition errors ONLY when surrounding context provides strong evidence (e.g., "chair to the bad" -> "chair to the bed").
4. Ambiguous Phrasing: When intended meaning is uncertain or ambiguous, preserve the uncertainty and flag it in informationRequiringReview for clinician review.
5. Evidence Grounding: Every extracted claim MUST contain verifiable source evidence (segmentId, startTimeMs, endTimeMs, verbatim sourceText).
6. Missing Categories: If a category was not discussed in the transcript, evaluate it as "Not stated".
7. Detail Preservation: Do NOT aggressively compress the conversation. Preserve useful clinical detail, timing, frequency, severity, functional impact, client-reported concerns, clinician observations, equipment factors, and discussed next steps.
8. Speaker Roles: Distinguish client-reported information from clinician-observed information based on mapped speaker roles.
`;
}

export class AIExtractionService {
  async extractStructuredClinicalNote(
    segments: CanonicalTranscriptSegment[]
  ): Promise<StructuredClinicalExtraction> {
    // In local/mock mode, rule-based evidence-linked extraction directly from canonical transcript
    const clientConcerns = segments
      .filter((s) => s.mappedRole === 'CLIENT' && (s.text.toLowerCase().includes('concern') || s.text.toLowerCase().includes('pain') || s.text.toLowerCase().includes('pressure') || s.text.toLowerCase().includes('bad')))
      .map((s) => {
        // Speech recognition correction demo for obvious typo "bad" -> "bed"
        let correctedText = s.text;
        if (correctedText.toLowerCase().includes('chair to the bad')) {
          correctedText = correctedText.replace(/chair to the bad/i, 'chair to the bed');
        }
        return {
          value: correctedText,
          evidence: [
            {
              segmentId: s.id,
              startTimeMs: s.startTimeMs,
              endTimeMs: s.endTimeMs,
              sourceText: s.text
            }
          ],
          confidence: 'HIGH' as const
        };
      });

    const accessibilityBarriers = segments
      .filter((s) => s.text.toLowerCase().includes('steps') || s.text.toLowerCase().includes('entrance') || s.text.toLowerCase().includes('narrow') || s.text.toLowerCase().includes('doorway') || s.text.toLowerCase().includes('ramp'))
      .map((s) => ({
        value: s.text,
        evidence: [
          {
            segmentId: s.id,
            startTimeMs: s.startTimeMs,
            endTimeMs: s.endTimeMs,
            sourceText: s.text
          }
        ],
        confidence: 'HIGH' as const
      }));

    const wheelchairSeatingConcerns = segments
      .filter((s) => s.text.toLowerCase().includes('cushion') || s.text.toLowerCase().includes('wheelchair') || s.text.toLowerCase().includes('trunk') || s.text.toLowerCase().includes('pelvic'))
      .map((s) => ({
        value: s.text,
        evidence: [
          {
            segmentId: s.id,
            startTimeMs: s.startTimeMs,
            endTimeMs: s.endTimeMs,
            sourceText: s.text
          }
        ],
        confidence: 'HIGH' as const
      }));

    const matAssessmentInfo = segments
      .filter((s) => s.text.toLowerCase().includes('mat') || s.text.toLowerCase().includes('tilt') || s.text.toLowerCase().includes('obliquity') || s.text.toLowerCase().includes('posture'))
      .map((s) => ({
        value: s.text,
        evidence: [
          {
            segmentId: s.id,
            startTimeMs: s.startTimeMs,
            endTimeMs: s.endTimeMs,
            sourceText: s.text
          }
        ],
        confidence: 'HIGH' as const
      }));

    const actionsAndRecommendations = segments
      .filter((s) => s.mappedRole === 'THERAPIST' && (s.text.toLowerCase().includes('recommend') || s.text.toLowerCase().includes('referral') || s.text.toLowerCase().includes('action')))
      .map((s) => ({
        value: s.text,
        evidence: [
          {
            segmentId: s.id,
            startTimeMs: s.startTimeMs,
            endTimeMs: s.endTimeMs,
            sourceText: s.text
          }
        ],
        confidence: 'HIGH' as const
      }));

    const unstatedOrMissingFields: string[] = [];
    if (clientConcerns.length === 0) unstatedOrMissingFields.push('Client concerns: Not stated');
    if (matAssessmentInfo.length === 0) unstatedOrMissingFields.push('MAT assessment info: Not stated');

    const result: StructuredClinicalExtraction = {
      noteType: 'professional_clinical_note',
      clientReportedInformation: clientConcerns.length ? clientConcerns : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      equipmentAndEnvironment: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      assessmentFindings: matAssessmentInfo.length ? matAssessmentInfo : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      planAndNextSteps: actionsAndRecommendations.length ? actionsAndRecommendations : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      clientConcerns: clientConcerns.length ? clientConcerns : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      accessibilityBarriers: accessibilityBarriers.length ? accessibilityBarriers : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: matAssessmentInfo.length ? matAssessmentInfo : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: actionsAndRecommendations.length ? actionsAndRecommendations : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields
    };

    // Strict runtime validation with Zod
    return StructuredClinicalExtractionSchema.parse(result);
  }
}
