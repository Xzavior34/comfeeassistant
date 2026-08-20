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
  clientConcerns: z.array(EvidenceLinkedClaimSchema),
  accessibilityBarriers: z.array(EvidenceLinkedClaimSchema),
  wheelchairSeatingConcerns: z.array(EvidenceLinkedClaimSchema),
  matAssessmentInfo: z.array(EvidenceLinkedClaimSchema),
  actionsAndRecommendations: z.array(EvidenceLinkedClaimSchema),
  unstatedOrMissingFields: z.array(z.string())
});

export function generateSystemPrompt(): string {
  return `You are Vabatim, an evidence-grounded documentation assistant for UK wheelchair, seating, and mobility therapists.

STRICT ACCESSIBILITY & SAFETY RULES:
1. Extract information strictly and exclusively from the provided canonical transcript.
2. Do NOT diagnose, infer unstated clinical findings, or guess actions/owners.
3. The LLM must NEVER perform speaker diarization or assign speaker identities. Roles are pre-assigned in the canonical transcript.
4. Every extracted claim MUST contain verifiable source evidence (segmentId, startTimeMs, endTimeMs, verbatim sourceText).
5. If information for a standard category is absent in the transcript, evaluate it as "Not stated" in unstatedOrMissingFields.
6. Do NOT guess missing text in segments marked with [Overlapping speech / transcription uncertainty].
`;
}

export class AIExtractionService {
  async extractStructuredClinicalNote(
    segments: CanonicalTranscriptSegment[]
  ): Promise<StructuredClinicalExtraction> {
    // In local/mock mode, rule-based evidence-linked extraction directly from canonical transcript
    const clientConcerns = segments
      .filter((s) => s.mappedRole === 'CLIENT' && (s.text.toLowerCase().includes('concern') || s.text.toLowerCase().includes('pain') || s.text.toLowerCase().includes('pressure')))
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
