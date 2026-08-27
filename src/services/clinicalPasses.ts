import { CanonicalTranscriptSegment } from '../types';
import { CLINICAL_PHRASES } from './clinicalLexicon';

/**
 * Two additional model passes that sit either side of extraction.
 *
 * The lexicon repairs mishearings it has a rule for. A great many clinical mishearings have
 * no rule, because the correct word is only recoverable from the surrounding clinical
 * context — "the seat is too narrow at the ice heels" is only resolvable to "ischials" if
 * you know a seating assessment is under way. That is what the repair pass is for.
 *
 * The completeness pass exists because a single generation reliably produces a good first
 * two-thirds of a note and a thin final third. Reviewing the draft against the template and
 * deepening what is thin — strictly from evidence already present — is markedly more
 * effective than asking for more detail up front.
 */

// --------------------------------------------------------------------------- repair

export interface TranscriptCorrection {
  segmentId: string;
  corrected: string;
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export function buildTranscriptRepairPrompt(segments: CanonicalTranscriptSegment[]): string {
  const vocabulary = CLINICAL_PHRASES.join(', ');

  return `You are correcting speech-recognition errors in the transcript of a UK wheelchair
and seating assessment, before it is turned into a clinical record.

A general-purpose speech engine produced this transcript. It systematically mis-hears
clinical terminology as similar-sounding ordinary English. Your only job is to restore what
was almost certainly said.

WHAT YOU MAY CHANGE
Only words that are near-homophones of clinical terminology, and only when the surrounding
clinical context makes the intended word close to certain. Typical errors:
  "public ability"        -> "pelvic obliquity"
  "issue heels"           -> "ischials"
  "high spec foam"        -> "high-specification foam"
  "sacrum" heard as "sacred", "tilt" as "till", "castors" as "casters"
  "roho" heard as "row ho", "MAT assessment" heard as "mat assessment"
  spoken numbers next to a unit: "forty four centimetres" -> "44 cm"

WHAT YOU MUST NOT CHANGE
  - Anything that is merely ungrammatical, colloquial or repetitive. Leave it alone.
  - Any number, unit, side (left/right) or negation. If the transcript says "no pain",
    it stays "no pain". If it says "12 cm", it stays "12 cm". These carry clinical meaning
    and a wrong correction here is a clinical error, not a typo.
  - Anything you are merely guessing at. An uncorrected mishearing is recoverable by the
    clinician; a confident wrong correction is not.
  - The meaning of a sentence. Corrections are lexical, never semantic.

Reference vocabulary for this specialty: ${vocabulary}

Return JSON only:
{ "corrections": [
    { "segmentId": "<id>", "corrected": "<the full corrected segment text>",
      "reason": "<which words you changed and why>", "confidence": "HIGH" | "MEDIUM" | "LOW" }
] }

Include a segment only if you are changing it. Return an empty array if nothing needs
correcting — that is a perfectly good answer and much better than inventing changes.

TRANSCRIPT:
${JSON.stringify(
  segments.map((s) => ({ segmentId: s.id, speaker: s.mappedRole ?? 'UNATTRIBUTED', text: s.text })),
  null,
  2
)}`;
}

/** Tokens whose alteration changes clinical meaning rather than spelling. */
const PROTECTED = /(\d+(?:\.\d+)?)|(\bno\b|\bnot\b|\bnever\b|\bdenies\b|\bwithout\b)|(\bleft\b|\bright\b|\bbilateral\b)/gi;

function protectedTokens(text: string): string[] {
  return (text.toLowerCase().match(PROTECTED) || []).sort();
}

/**
 * Applies repairs the model proposed, refusing any that would alter clinical meaning.
 *
 * The guard is deliberately mechanical rather than trusting the model's own confidence: a
 * correction may only change words, never the numbers, negations or sides in a segment, and
 * may not substantially change its length. A model that decides "no pressure area" should
 * read "pressure area" would be making a clinical error the guard catches regardless of how
 * confident it claims to be.
 */
export function applyRepairs(
  segments: CanonicalTranscriptSegment[],
  corrections: TranscriptCorrection[]
): { segments: CanonicalTranscriptSegment[]; applied: TranscriptCorrection[]; refused: TranscriptCorrection[] } {
  const byId = new Map(corrections.map((c) => [c.segmentId, c]));
  const applied: TranscriptCorrection[] = [];
  const refused: TranscriptCorrection[] = [];

  const out = segments.map((segment) => {
    const correction = byId.get(segment.id);
    if (!correction || typeof correction.corrected !== 'string' || !correction.corrected.trim()) {
      return segment;
    }

    if (correction.confidence !== 'HIGH') {
      refused.push({ ...correction, reason: `${correction.reason} [refused: confidence not HIGH]` });
      return segment;
    }

    const before = protectedTokens(segment.text);
    const after = protectedTokens(correction.corrected);
    if (before.join('|') !== after.join('|')) {
      refused.push({
        ...correction,
        reason: `${correction.reason} [refused: would alter a number, negation or laterality]`
      });
      return segment;
    }

    const ratio = correction.corrected.length / Math.max(1, segment.text.length);
    if (ratio < 0.6 || ratio > 1.6) {
      refused.push({ ...correction, reason: `${correction.reason} [refused: length change too large]` });
      return segment;
    }

    applied.push(correction);
    return { ...segment, text: correction.corrected };
  });

  return { segments: out, applied, refused };
}

// --------------------------------------------------------------------- completeness

/**
 * Sections whose thinness matters most. A wheelchair assessment note that is vague about
 * posture, pressure or justification cannot support a prescription decision.
 */
const DEPTH_CRITICAL_PATHS = [
  'seatingPosturalAssessment',
  'pressureManagement',
  'objectiveFindings',
  'clinicalReasoning',
  'recommendationsAndActions',
  'trialAndSelection',
  'followUpPlan'
];

export function buildCompletenessPrompt(
  draftNote: unknown,
  segments: CanonicalTranscriptSegment[]
): string {
  return `You are a senior wheelchair and seating clinician reviewing an AI-generated draft
assessment record against the transcript it was produced from, before it goes to the
assessing clinician.

You are looking for one thing: content that is PRESENT IN THE TRANSCRIPT but recorded in the
draft too thinly to be clinically useful, or not recorded at all.

Typical failures to look for:
  - A postural finding recorded without its magnitude, side, or whether it is fixed or
    flexible, when the transcript establishes those.
  - A measurement recorded without the position, cushion or footwear it was taken in, when
    the transcript states them.
  - A symptom recorded without its time course, frequency, or functional consequence, when
    the person described them.
  - A recommendation recorded without the reasoning that the clinician actually gave.
  - Clinical reasoning left empty when the transcript contains enough established findings
    to construct a problem list.
  - A finding discussed in the conversation that no section captured at all.

Focus especially on: ${DEPTH_CRITICAL_PATHS.join(', ')}.

RULES
  - You may only add detail that is present in the transcript. If the transcript does not
    establish it, leave it out and do not soften it into a hedge.
  - Every claim you return must cite a real segmentId from the transcript below, with
    sourceText copied verbatim from that segment.
  - Do not restate content that is already adequately recorded. Return only what you are
    changing.
  - Do not remove existing content.

Return JSON only. Use the same shape as the draft, containing ONLY the fields you are
revising, with the complete replacement array of claims for each. Also return any additional
review flags your review raises.

{
  "revisions": { "<same structure as the draft>": [ <claims> ] },
  "additionalFlags": [ { "flagType": "...", "description": "...", "segmentIds": ["..."] } ]
}

Return {"revisions": {}, "additionalFlags": []} if the draft already captures the transcript
adequately. That is a legitimate result.

DRAFT:
${JSON.stringify(draftNote, null, 2)}

TRANSCRIPT:
${JSON.stringify(
  segments.map((s) => ({
    segmentId: s.id,
    speaker: s.mappedRole ?? 'UNATTRIBUTED',
    startTimeMs: s.startTimeMs,
    endTimeMs: s.endTimeMs,
    text: s.text
  })),
  null,
  2
)}`;
}

/**
 * Counts how much substantive content a note actually carries, so the effect of the
 * completeness pass can be measured rather than assumed.
 */
export function measureNoteDepth(note: any): {
  populatedFields: number;
  totalClaims: number;
  totalWords: number;
  emptyFields: number;
} {
  let populatedFields = 0;
  let totalClaims = 0;
  let totalWords = 0;
  let emptyFields = 0;

  const walk = (node: any) => {
    if (Array.isArray(node)) {
      if (node.length > 0 && node[0] && typeof node[0].value === 'string') {
        const real = node.filter(
          (c: any) => c.value && !c.value.includes('Not documented') && c.value !== 'Not stated'
        );
        if (real.length > 0) {
          populatedFields++;
          totalClaims += real.length;
          totalWords += real.reduce(
            (n: number, c: any) => n + c.value.trim().split(/\s+/).filter(Boolean).length,
            0
          );
        } else {
          emptyFields++;
        }
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (key === 'warnings' || key === 'clinicianReviewFlags') continue;
        walk(node[key]);
      }
    }
  };

  walk(note);
  return { populatedFields, totalClaims, totalWords, emptyFields };
}
