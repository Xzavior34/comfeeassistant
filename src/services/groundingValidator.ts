import { CanonicalTranscriptSegment, StructuredClinicalExtraction, EvidenceLinkedClaim } from '../types';

export interface GroundingValidationResult {
  isValid: boolean;
  totalClaimsEvaluated: number;
  groundedClaimsCount: number;
  rejectedClaims: { claimValue: string; reason: string }[];
  validatedNote: StructuredClinicalExtraction;
}

export class GroundingValidator {
  validate(
    extractedNote: StructuredClinicalExtraction,
    canonicalSegments: CanonicalTranscriptSegment[]
  ): GroundingValidationResult {
    const segmentMap = new Map<string, CanonicalTranscriptSegment>();
    for (const seg of canonicalSegments) {
      segmentMap.set(seg.id, seg);
    }

    let totalClaimsEvaluated = 0;
    let groundedClaimsCount = 0;
    const rejectedClaims: { claimValue: string; reason: string }[] = [];

    const categories: ('clientConcerns' | 'accessibilityBarriers' | 'wheelchairSeatingConcerns' | 'matAssessmentInfo' | 'actionsAndRecommendations')[] = [
      'clientConcerns',
      'accessibilityBarriers',
      'wheelchairSeatingConcerns',
      'matAssessmentInfo',
      'actionsAndRecommendations'
    ];

    const validatedNote: StructuredClinicalExtraction = { ...extractedNote };

    for (const category of categories) {
      const claims = extractedNote[category] as EvidenceLinkedClaim[];
      const validatedClaims: EvidenceLinkedClaim[] = [];

      for (const claim of claims) {
        if (claim.value === 'Not stated') {
          validatedClaims.push(claim);
          continue;
        }

        totalClaimsEvaluated++;

        if (!claim.evidence || claim.evidence.length === 0) {
          rejectedClaims.push({ claimValue: claim.value, reason: 'Missing source evidence reference' });
          continue;
        }

        let allEvidenceValid = true;
        for (const ev of claim.evidence) {
          const targetSeg = segmentMap.get(ev.segmentId);

          if (!targetSeg) {
            rejectedClaims.push({ claimValue: claim.value, reason: `Referenced segment ID ${ev.segmentId} does not exist in canonical transcript` });
            allEvidenceValid = false;
            break;
          }

          if (ev.startTimeMs < targetSeg.startTimeMs || ev.endTimeMs > targetSeg.endTimeMs) {
            rejectedClaims.push({ claimValue: claim.value, reason: `Timestamp bounds [${ev.startTimeMs}-${ev.endTimeMs}ms] out of segment bounds [${targetSeg.startTimeMs}-${targetSeg.endTimeMs}ms]` });
            allEvidenceValid = false;
            break;
          }

          // Verbatim segment text alignment check
          if (!targetSeg.text.includes(ev.sourceText) && !ev.sourceText.includes(targetSeg.text)) {
            rejectedClaims.push({ claimValue: claim.value, reason: `Evidence sourceText "${ev.sourceText}" not aligned with transcript segment text "${targetSeg.text}"` });
            allEvidenceValid = false;
            break;
          }

          // Semantic Grounding Check: Ensure key terms in claim.value are backed by ev.sourceText
          const claimKeywords = claim.value.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          const sourceTextLower = ev.sourceText.toLowerCase();
          const unsupportedKeywords = claimKeywords.filter(kw => !sourceTextLower.includes(kw));

          // If more than 50% of significant claim terms are absent in source text, reject claim
          if (claimKeywords.length > 0 && unsupportedKeywords.length / claimKeywords.length > 0.5) {
            rejectedClaims.push({
              claimValue: claim.value,
              reason: `Claim asserts ungrounded concepts [${unsupportedKeywords.join(', ')}] not aligned with transcript segment text "${ev.sourceText}"`
            });
            allEvidenceValid = false;
            break;
          }
        }

        if (allEvidenceValid) {
          groundedClaimsCount++;
          validatedClaims.push(claim);
        }
      }

      validatedNote[category] = validatedClaims.length > 0 ? validatedClaims : [{ value: 'Not stated', evidence: [], confidence: 'LOW' }];
    }

    const isValid = rejectedClaims.length === 0;

    return {
      isValid,
      totalClaimsEvaluated,
      groundedClaimsCount,
      rejectedClaims,
      validatedNote
    };
  }
}
