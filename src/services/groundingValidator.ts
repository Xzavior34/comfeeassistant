import { CanonicalTranscriptSegment, StructuredClinicalExtraction, EvidenceLinkedClaim } from '../types';

export interface GroundingValidationResult {
  isValid: boolean;
  totalClaimsEvaluated: number;
  groundedClaimsCount: number;
  rejectedClaims: { claimValue: string; section: string; reason: string }[];
  validatedNote: StructuredClinicalExtraction;
}

const NOT_DOCUMENTED = 'Not documented during this session.';

function notStatedClaim(): EvidenceLinkedClaim {
  return {
    value: NOT_DOCUMENTED,
    evidence: [],
    confidence: 'LOW',
    sourceClassification: 'NOT_STATED'
  } as EvidenceLinkedClaim;
}

function isClaimArray(v: any): boolean {
  return Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object' && typeof v[0].value === 'string';
}

/** Content words used for the overlap test, minus clinical connective vocabulary. */
const STOPWORDS = new Set([
  'about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'with',
  'during', 'today', 'session', 'patient', 'client', 'reports', 'reported', 'observed',
  'noted', 'states', 'stated', 'currently', 'assessment', 'clinician', 'approximately',
  'requires', 'required', 'using', 'because', 'however', 'therefore', 'appears'
]);

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 4 && !STOPWORDS.has(w));
}

/**
 * Validates that every substantive claim in the note is traceable to the transcript.
 *
 * Two defects are corrected here. First, only five legacy flat arrays were checked, so the
 * forty-odd fields that actually appear in the clinical document bypassed grounding
 * entirely; the walk below covers every claim array in the note. Second, the old
 * "semantic" test rejected a claim when more than 60% of its long words were absent from
 * the source string — which passes trivially for verbatim copies and fails almost any
 * genuine clinical summary. It is replaced by a lenient overlap floor that catches
 * fabricated content without punishing correct clinical paraphrase.
 */
export class GroundingValidator {
  validate(
    extractedNote: StructuredClinicalExtraction,
    canonicalSegments: CanonicalTranscriptSegment[]
  ): GroundingValidationResult {
    const segmentMap = new Map<string, CanonicalTranscriptSegment>();
    for (const seg of canonicalSegments) segmentMap.set(seg.id, seg);

    let totalClaimsEvaluated = 0;
    let groundedClaimsCount = 0;
    const rejectedClaims: { claimValue: string; section: string; reason: string }[] = [];

    const validateClaim = (claim: EvidenceLinkedClaim, section: string): boolean => {
      if (
        !claim.value ||
        claim.value === NOT_DOCUMENTED ||
        claim.value === 'Not stated' ||
        claim.value.includes('Not documented') ||
        claim.sourceClassification === 'NOT_STATED'
      ) {
        return true;
      }

      totalClaimsEvaluated++;

      if (!claim.evidence || claim.evidence.length === 0) {
        rejectedClaims.push({ claimValue: claim.value, section, reason: 'Missing source evidence reference' });
        return false;
      }

      for (const ev of claim.evidence) {
        const seg = segmentMap.get(ev.segmentId);

        if (!seg) {
          rejectedClaims.push({
            claimValue: claim.value,
            section,
            reason: `Referenced segment "${ev.segmentId}" does not exist in the canonical transcript`
          });
          return false;
        }

        if (ev.startTimeMs < seg.startTimeMs || ev.endTimeMs > seg.endTimeMs) {
          rejectedClaims.push({
            claimValue: claim.value,
            section,
            reason: `Evidence timestamps [${ev.startTimeMs}-${ev.endTimeMs}ms] fall outside segment bounds [${seg.startTimeMs}-${seg.endTimeMs}ms]`
          });
          return false;
        }
      }

      // Overlap test against the union of all cited source text. A clinical summary may
      // legitimately reword the conversation; what it may not do is share no vocabulary
      // with it at all.
      const sourcePool = claim.evidence.map((e) => e.sourceText ?? '').join(' ').toLowerCase();
      const tokens = contentTokens(claim.value);

      if (tokens.length >= 3) {
        const supported = tokens.filter((t) => sourcePool.includes(t.slice(0, Math.max(4, t.length - 2))));
        if (supported.length / tokens.length < 0.2) {
          rejectedClaims.push({
            claimValue: claim.value,
            section,
            reason: 'Claim shares almost no vocabulary with its cited transcript evidence (possible fabrication)'
          });
          return false;
        }
      }

      groundedClaimsCount++;
      return true;
    };

    const walk = (node: any, path: string): any => {
      if (isClaimArray(node)) {
        const kept = (node as EvidenceLinkedClaim[]).filter((c) => validateClaim(c, path));
        return kept.length > 0 ? kept : [notStatedClaim()];
      }

      if (Array.isArray(node)) return node;

      if (node && typeof node === 'object') {
        const out: any = Array.isArray(node) ? [...node] : { ...node };
        for (const key of Object.keys(out)) {
          if (key === 'warnings' || key === 'clinicianReviewFlags' || key === 'sessionInfo') continue;
          out[key] = walk(out[key], path ? `${path}.${key}` : key);
        }
        return out;
      }

      return node;
    };

    const validatedNote: StructuredClinicalExtraction = walk({ ...extractedNote }, '');

    // sessionInfo holds administrative metadata alongside one claim array; walk that field only.
    if (extractedNote.sessionInfo?.reasonForReferral) {
      validatedNote.sessionInfo = {
        ...extractedNote.sessionInfo,
        reasonForReferral: walk(extractedNote.sessionInfo.reasonForReferral, 'sessionInfo.reasonForReferral')
      };
    }

    const isValid = rejectedClaims.length === 0;

    if (!isValid) {
      validatedNote.warnings = {
        ...(validatedNote.warnings ?? { warningMessages: [] }),
        groundingValidationFailure: true,
        warningMessages: [
          ...(validatedNote.warnings?.warningMessages ?? []),
          `${rejectedClaims.length} statement(s) were removed from the draft because they could not be traced to the transcript.`
        ]
      };

      (validatedNote as any).clinicianReviewFlags = [
        ...((validatedNote as any).clinicianReviewFlags ?? []),
        {
          flagType: 'OTHER',
          description:
            'Ungrounded statements were removed during validation. Sections affected: ' +
            Array.from(new Set(rejectedClaims.map((r) => r.section))).join(', '),
          segmentIds: []
        }
      ];
    }

    return { isValid, totalClaimsEvaluated, groundedClaimsCount, rejectedClaims, validatedNote };
  }
}
