import { z } from 'zod';
import {
  CanonicalTranscriptSegment,
  StructuredClinicalExtraction,
  TemplateType,
  SessionFormat,
  SourceClassification
} from '../types';
import { correctClinicalText } from './clinicalLexicon';
import { generateSystemPrompt, PROMPT_VERSION } from './clinicalPrompt';

export { generateSystemPrompt, PROMPT_VERSION };

export const EvidenceReferenceSchema = z.object({
  segmentId: z.string(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  sourceText: z.string()
});

export const SourceClassificationSchema = z.enum([
  'PATIENT_REPORTED',
  'CARER_REPORTED',
  'CLINICIAN_OBSERVED',
  'CLINICAL_INTERPRETATION',
  'RECOMMENDATION',
  'ACTION',
  'PLAN',
  'UNCERTAIN',
  'NOT_STATED'
]);

export const EvidenceLinkedClaimSchema = z.object({
  value: z.string(),
  evidence: z.array(EvidenceReferenceSchema),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  sourceClassification: SourceClassificationSchema.optional(),
  rawMeasurement: z.string().nullable().optional(),
  isCorrected: z.boolean().optional(),
  rawText: z.string().optional(),
  uncertaintyReason: z.string().optional()
});

export const ReviewFlagTypeSchema = z.enum([
  'CONTRADICTION',
  'UNDER_SPECIFIED',
  'MEASUREMENT_INCOMPLETE',
  'SAFETY_CRITICAL_GAP',
  'ACTION_OWNER_UNCLEAR',
  'EQUIPMENT_SPEC_INCOMPLETE',
  'REASONING_NEEDS_CONFIRMATION',
  'TRANSCRIPTION_UNCERTAIN',
  'OTHER'
]);

export const ClinicianReviewFlagSchema = z.object({
  flagType: ReviewFlagTypeSchema,
  description: z.string(),
  segmentIds: z.array(z.string()).default([])
});

export const ProcessingFailureWarningsSchema = z.object({
  poorAudioQuality: z.boolean().optional(),
  interruptedRecording: z.boolean().optional(),
  speechRecognitionFailure: z.boolean().optional(),
  lowConfidenceTranscription: z.boolean().optional(),
  missingSpeakerIdentification: z.boolean().optional(),
  confidenceUnavailable: z.boolean().optional(),
  geminiProcessingFailure: z.boolean().optional(),
  groundingValidationFailure: z.boolean().optional(),
  rapidSpeechWarning: z.boolean().optional(),
  deterministicFallbackUsed: z.boolean().optional(),
  warningMessages: z.array(z.string())
});

const ClaimList = z.array(EvidenceLinkedClaimSchema);

export const StructuredClinicalExtractionSchema = z.object({
  noteType: z.literal('professional_wheelchair_seating_note').optional(),
  templateType: z.enum(['INITIAL_ASSESSMENT', 'REVIEW']),
  sessionFormat: z.enum(['FACE_TO_FACE', 'VIRTUAL']),
  promptVersion: z.string().optional(),
  sessionInfo: z.object({
    clientReference: z.string(),
    sessionDate: z.string(),
    clinicianName: z.string(),
    templateType: z.enum(['INITIAL_ASSESSMENT', 'REVIEW']),
    sessionFormat: z.enum(['FACE_TO_FACE', 'VIRTUAL']),
    participants: z.array(z.string()),
    reasonForReferral: ClaimList
  }),
  subjectiveInfo: z.object({
    clientCarerHistory: ClaimList,
    presentingConcerns: ClaimList,
    clientGoals: ClaimList,
    reportedChanges: ClaimList.optional()
  }),
  functionalAssessment: z.object({
    mobilityStatus: ClaimList,
    transferCapability: ClaimList,
    activitiesOfDailyLiving: ClaimList,
    communityParticipation: ClaimList,
    assistanceRequired: ClaimList,
    fatigueAndEndurance: ClaimList
  }),
  objectiveFindings: z.object({
    clinicianObservations: ClaimList,
    assessmentFindings: ClaimList,
    measurementsPreserved: ClaimList,
    rangeOfMovement: ClaimList,
    muscleStrength: ClaimList
  }),
  seatingPosturalAssessment: z.object({
    pelvicPositioning: ClaimList,
    trunkPositioning: ClaimList,
    headAndNeckPositioning: ClaimList,
    lowerLimbPositioning: ClaimList,
    posturalAsymmetry: ClaimList,
    supportsAndPosturalPillows: ClaimList,
    posturalStabilityAndTolerance: ClaimList
  }),
  pressureManagement: z.object({
    pressureConcerns: ClaimList,
    skinIntegrityConcerns: ClaimList,
    pressureReliefMethods: ClaimList,
    pressureReliefFrequency: ClaimList,
    cushionInformation: ClaimList,
    riskFactorNotes: ClaimList
  }),
  equipmentAssessment: z.object({
    currentWheelchair: ClaimList,
    currentCushion: ClaimList,
    currentBackSupport: ClaimList,
    footAndArmSupports: ClaimList,
    accessoriesAndPads: ClaimList,
    equipmentSuitabilityAndProblems: ClaimList
  }),
  // Sections required by the clinical template that the schema previously omitted.
  environmentAndTransport: ClaimList.default([]),
  trialAndSelection: ClaimList.default([]),
  agreementAndSignOff: ClaimList.default([]),
  outstandingConcerns: ClaimList.default([]),

  clinicalReasoning: ClaimList,
  recommendationsAndActions: ClaimList,
  followUpPlan: ClaimList,

  clientConcerns: ClaimList,
  accessibilityBarriers: ClaimList,
  wheelchairSeatingConcerns: ClaimList,
  matAssessmentInfo: ClaimList,
  actionsAndRecommendations: ClaimList,
  unstatedOrMissingFields: z.array(z.string()),
  clinicianReviewFlags: z.array(ClinicianReviewFlagSchema).default([]),
  voiceAttribution: z
    .array(
      z.object({
        speakerId: z.string(),
        role: z.string().nullable(),
        confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
        rationale: z.array(z.string()),
        speakingShare: z.number()
      })
    )
    .optional(),
  warnings: ProcessingFailureWarningsSchema.optional()
});

// ---------------------------------------------------------------------------
// Deterministic fallback extractor
// ---------------------------------------------------------------------------
//
// This is NOT the primary extraction path. It runs only when the LLM is unavailable, and
// the resulting note is explicitly marked as a mechanical fallback so no one mistakes it
// for clinical synthesis.
//
// The previous implementation matched a handful of keywords and then copied the SAME
// bucket of raw transcript lines into seven different clinical sections, which is why
// generated notes read as repeated conversation fragments. Routing here is
// single-assignment: each segment lands in at most one section, the one it scores highest
// against.

type SectionKey =
  | 'reasonForReferral'
  | 'clientGoals'
  | 'presentingConcerns'
  | 'clientCarerHistory'
  | 'mobilityStatus'
  | 'transferCapability'
  | 'activitiesOfDailyLiving'
  | 'communityParticipation'
  | 'fatigueAndEndurance'
  | 'rangeOfMovement'
  | 'muscleStrength'
  | 'pelvicPositioning'
  | 'trunkPositioning'
  | 'headAndNeckPositioning'
  | 'lowerLimbPositioning'
  | 'posturalStabilityAndTolerance'
  | 'clinicianObservations'
  | 'unclassifiedUncertain'
  | 'skinIntegrityConcerns'
  | 'pressureReliefMethods'
  | 'cushionInformation'
  | 'currentWheelchair'
  | 'currentBackSupport'
  | 'footAndArmSupports'
  | 'equipmentSuitabilityAndProblems'
  | 'environmentAndTransport'
  | 'trialAndSelection'
  | 'recommendationsAndActions'
  | 'followUpPlan'
  | 'agreementAndSignOff';

interface SectionRule {
  key: SectionKey;
  patterns: RegExp[];
  /** Restrict this section to a speaker role, when the role is known. */
  role?: 'THERAPIST' | 'CLIENT';
  /**
   * Tie-breaker when a sentence matches several sections. Speech acts ("I recommend...")
   * outrank the clinical topic they mention, and a named piece of equipment or anatomy
   * outranks a broad functional heading.
   */
  priority: number;
  defaultSource: SourceClassification;
}

const SECTION_RULES: SectionRule[] = [
  // Speech acts: what the clinician decided, planned or the person agreed to.
  { key: 'recommendationsAndActions', priority: 6, role: 'THERAPIST', patterns: [/\b(recommend|will order|going to order|refer(?:ral|red)?\b|prescrib|arrange|action point)/i], defaultSource: 'RECOMMENDATION' },
  { key: 'followUpPlan', priority: 6, role: 'THERAPIST', patterns: [/\b(review in|follow[- ]?up|come back|see you again|reassess|next appointment)\b/i], defaultSource: 'PLAN' },
  { key: 'agreementAndSignOff', priority: 5, role: 'CLIENT', patterns: [/\b(happy with|agree|agreed|that'?s fine|not sure about|would rather not|prefer not|declin)\b/i], defaultSource: 'PATIENT_REPORTED' },

  // The person's own account.
  { key: 'presentingConcerns', priority: 5, role: 'CLIENT', patterns: [/\b(concern|worried|problem|struggl|difficult|uncomfortable|pain|ache|sore|hurts?)\b/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'clientGoals', priority: 4, patterns: [/\b(goal|would like to|want to be able|hoping to|aim to|priority|matters most)\b/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'reasonForReferral', priority: 4, patterns: [/\breferr?(al|ed) (for|by|from)\b/i, /\breason for (the )?(referral|visit|assessment)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'clientCarerHistory', priority: 2, patterns: [/\b(diagnos|condition|medical history|since|years ago|progressive|surgery|operation|medication)\b/i], defaultSource: 'PATIENT_REPORTED' },

  // Named clinical objects and findings.
  { key: 'pelvicPositioning', priority: 4, patterns: [/\b(pelvi|obliquity|windswe)/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'trunkPositioning', priority: 4, patterns: [/\b(trunk|spine|spinal|scoliosis|kyphosis|lordosis|lean|midline)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'rangeOfMovement', priority: 4, patterns: [/\b(range of (?:movement|motion)|flexion|extension|abduction|adduction|contracture|hamstring length|popliteal)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'skinIntegrityConcerns', priority: 4, patterns: [/\b(skin|redness|erythema|pressure sore|pressure ulcer|pressure injury|wound|blister|broken skin|ischial|sacr)/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'pressureReliefMethods', priority: 4, patterns: [/\b(pressure relief|weight shift|reposition|lean forward|tilt back)\b/i, /every \d+ minutes/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'cushionInformation', priority: 4, patterns: [/\b(cushion|ROHO|Jay |gel |foam)\b/i, /pressure[- ]redistribut/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'currentWheelchair', priority: 4, patterns: [/\b(wheelchair|power ?chair|self[- ]propel|attendant[- ]propelled|tilt-in-space)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'currentBackSupport', priority: 4, patterns: [/\b(backrest|back support|lateral support|tension[- ]adjustable)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'footAndArmSupports', priority: 4, patterns: [/\b(footplate|foot support|legrest|armrest|arm support|pommel)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'headAndNeckPositioning', priority: 3, patterns: [/\b(head|neck|cervical|headrest)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'lowerLimbPositioning', priority: 3, patterns: [/\b(hip|knee|ankle|foot|feet|lower limb|plantigrade)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'muscleStrength', priority: 3, patterns: [/\b(strength|weak|power|tone|spasticity|clonus|hypertonia|hypotonia|sensation)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'posturalStabilityAndTolerance', priority: 3, patterns: [/\b(sitting balance|unsupported sitting|postural stability|sitting tolerance|slump|slides? forward)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'trialAndSelection', priority: 3, patterns: [/\b(trial|trialling|tried the|tested the|demo|options considered|alternative)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },

  // Context.
  { key: 'environmentAndTransport', priority: 2, patterns: [/\b(doorway|threshold|steps?|stairs|ramp|lift|hallway|kerb|gradient|storage|charging|car|taxi|bus|transport|access(?:ible)?|narrow)\b/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'transferCapability', priority: 2, patterns: [/\b(transfer|transferring|stand-pivot|sliding board|hoist|sling|stand aid)\b/i], defaultSource: 'CLINICIAN_OBSERVED' },
  { key: 'equipmentSuitabilityAndProblems', priority: 2, patterns: [/\b(too (?:narrow|wide|small|big|low|high)|doesn'?t fit|breaks? down|broken|repair|worn out)\b/i], defaultSource: 'PATIENT_REPORTED' },

  // Broad functional headings: only when nothing more specific matched.
  { key: 'mobilityStatus', priority: 1, patterns: [/\b(walk|walking|gait|ambulat|mobilit|frame|rollator|crutch|stick|distance)\b/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'activitiesOfDailyLiving', priority: 1, patterns: [/\b(dressing|washing|bathing|toilet|cooking|kitchen|personal care|activities of daily living|meal)\b/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'communityParticipation', priority: 1, patterns: [/\b(community|shops|shopping|outdoors|social|work|college|school|church|visit)\b/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'fatigueAndEndurance', priority: 1, patterns: [/\b(fatigue|tired|exhaust|endurance|breathless|stamina|tolerance)\b/i], defaultSource: 'PATIENT_REPORTED' },
  { key: 'clinicianObservations', priority: 0, role: 'THERAPIST', patterns: [/\b(observ|noted|on examination|assessment shows|I can see|appears|presents with|checking|measur)/i], defaultSource: 'CLINICIAN_OBSERVED' }
];

const MEASUREMENT_RE = /\d+(?:\.\d+)?\s*(?:cm|mm|inches|degrees|kg|m)\b/i;
const NOT_DOCUMENTED = 'Not documented during this session.';

function notStatedClaim(): any[] {
  return [
    {
      value: NOT_DOCUMENTED,
      evidence: [],
      confidence: 'LOW' as const,
      sourceClassification: 'NOT_STATED' as SourceClassification
    }
  ];
}

function orNotStated(claims: any[]): any[] {
  return claims.length > 0 ? claims : notStatedClaim();
}

/** Scores one sentence against a section rule. Zero means "does not belong here". */
function scoreSection(
  sentence: string,
  role: string | null | undefined,
  rule: SectionRule
): number {
  if (rule.role && role && role !== rule.role) return 0;
  // A role-restricted rule may still fire on unattributed speech, but scores lower so a
  // role-free rule wins when both match.
  const rolePenalty = rule.role && !role ? 1 : 0;

  // A rule either matches or it does not. Counting each synonym separately let a rule with
  // many alternative spellings outrank a higher-priority rule that matched once.
  const matched = rule.patterns.some((pattern) => pattern.test(sentence));
  if (!matched) return 0;
  return 10 + rule.priority - rolePenalty;
}

/**
 * Splits an utterance into sentences.
 *
 * Routing whole segments meant a single dictated paragraph — "…recurrent pressure ulcers…
 * MAT examination confirms… We recommend trialling…" — landed entirely in one section, so
 * the recommendation never reached the plan. Sentences are routed independently while the
 * parent segment remains the evidence anchor.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Maps the speaker's real role onto the claim's provenance, rather than assuming it. */
function sourceForRole(
  role: string | null | undefined,
  ruleDefault: SourceClassification
): SourceClassification {
  if (ruleDefault === 'RECOMMENDATION' || ruleDefault === 'PLAN' || ruleDefault === 'ACTION') {
    return ruleDefault;
  }
  if (role === 'CLIENT') return 'PATIENT_REPORTED';
  if (role === 'CARER') return 'CARER_REPORTED';
  if (role === 'THERAPIST') return 'CLINICIAN_OBSERVED';
  return ruleDefault;
}

export interface RoutedClaim {
  section: SectionKey;
  role: string | null;
  claim: any;
}

/**
 * Routes every sentence to at most one section. Ties break on rule priority, then on rule
 * order. A sentence that matches nothing is omitted unless it is uncertain, in which case
 * it is surfaced for clinician review rather than silently discarded.
 */
export function routeSegments(segments: CanonicalTranscriptSegment[]): RoutedClaim[] {
  const routed: RoutedClaim[] = [];

  for (const segment of segments) {
    if (!segment.text || !segment.text.trim()) continue;

    const role = (segment.mappedRole as string | null) ?? null;
    const confidenceUnknown = segment.confidence === null || segment.confidence === undefined;
    const segmentUncertain =
      segment.rapidSpeechDetected === true ||
      confidenceUnknown ||
      (segment.confidence as number) < 0.6;

    const evidence = [
      {
        segmentId: segment.id,
        startTimeMs: segment.startTimeMs,
        endTimeMs: segment.endTimeMs,
        sourceText: segment.text
      }
    ];

    let anyRouted = false;

    for (const sentence of splitSentences(segment.text)) {
      let best: SectionRule | null = null;
      let bestScore = 0;

      for (const rule of SECTION_RULES) {
        const score = scoreSection(sentence, role, rule);
        if (score > bestScore) {
          best = rule;
          bestScore = score;
        }
      }

      if (!best) continue;
      anyRouted = true;

      const corrected = correctClinicalText(sentence);
      const isUncertain = segmentUncertain || corrected.suspectedMishearings.length > 0;
      const measurement = corrected.text.match(MEASUREMENT_RE);

      routed.push({
        section: best.key,
        role,
        claim: {
          value: corrected.text,
          evidence,
          confidence: isUncertain ? ('LOW' as const) : ('MEDIUM' as const),
          sourceClassification: isUncertain
            ? ('UNCERTAIN' as SourceClassification)
            : sourceForRole(role, best.defaultSource),
          rawMeasurement: measurement ? measurement[0] : null,
          isCorrected: corrected.isCorrected,
          rawText: sentence,
          uncertaintyReason: isUncertain
            ? confidenceUnknown
              ? 'Speech engine reported no confidence score for this utterance; wording requires clinician verification.'
              : 'Rapid, low-confidence or unclear speech detected during transcription.'
            : undefined
        }
      });
    }

    // Speech that could not be classified AND was not heard clearly must never be dropped
    // in silence: an unclassified low-confidence utterance is exactly the case a clinician
    // needs to hear about.
    if (!anyRouted && segmentUncertain) {
      const corrected = correctClinicalText(segment.text);
      routed.push({
        section: 'unclassifiedUncertain',
        role,
        claim: {
          value: `[Unclear Speech]: ${corrected.text} (Clinician review required)`,
          evidence,
          confidence: 'LOW' as const,
          sourceClassification: 'UNCERTAIN' as SourceClassification,
          rawMeasurement: null,
          isCorrected: corrected.isCorrected,
          rawText: segment.text,
          uncertaintyReason:
            'Speech could not be confidently transcribed or assigned to a clinical section.'
        }
      });
    }
  }

  return routed;
}

export class AIExtractionService {
  /**
   * Deterministic, non-LLM extraction. Used as a labelled fallback when the language model
   * is unavailable. It performs routing and evidence linking only — it does no clinical
   * synthesis, and says so in the output.
   */
  async extractStructuredClinicalNote(
    segments: CanonicalTranscriptSegment[],
    templateType: TemplateType = 'INITIAL_ASSESSMENT',
    sessionFormat: SessionFormat = 'FACE_TO_FACE',
    clientReference: string = 'Client-Ref',
    clinicianName: string = 'Clinician'
  ): Promise<StructuredClinicalExtraction> {
    const warningMessages: string[] = [];
    const reviewFlags: any[] = [];

    let hasRapidSpeech = false;
    let hasLowConfidence = false;
    let confidenceUnavailableCount = 0;
    let missingRoleCount = 0;

    for (const s of segments) {
      if (s.rapidSpeechDetected || (s.speakingRateWps && s.speakingRateWps > 4.0)) hasRapidSpeech = true;
      if (s.confidence === null || s.confidence === undefined) confidenceUnavailableCount++;
      else if (s.confidence < 0.75) hasLowConfidence = true;
      if (!s.mappedRole) missingRoleCount++;
    }

    const confidenceUnavailable = segments.length > 0 && confidenceUnavailableCount === segments.length;
    const missingSpeakerIdentification = segments.length > 0 && missingRoleCount === segments.length;

    if (hasRapidSpeech || hasLowConfidence) {
      warningMessages.push(
        'Some speech was rapid or low-confidence and may have been transcribed incorrectly. ' +
          'Review the flagged statements against the original conversation before approving.'
      );
      reviewFlags.push({
        flagType: 'TRANSCRIPTION_UNCERTAIN',
        description: 'Rapid or low-confidence speech detected in one or more segments.',
        segmentIds: segments
          .filter((s) => s.rapidSpeechDetected || (s.confidence !== null && (s.confidence as number) < 0.75))
          .map((s) => s.id)
      });
    }

    if (confidenceUnavailable) {
      warningMessages.push(
        'The speech engine returned no confidence scores for this session, so transcription ' +
          'accuracy could not be assessed automatically. Verify the whole note against the conversation.'
      );
      reviewFlags.push({
        flagType: 'TRANSCRIPTION_UNCERTAIN',
        description: 'No confidence scores available from the speech engine for this session.',
        segmentIds: []
      });
    }

    if (missingSpeakerIdentification) {
      warningMessages.push(
        'Speaker attribution was not available from the capture device. Statements are recorded ' +
          'without distinguishing clinician, patient or carer; confirm attribution before approving.'
      );
      reviewFlags.push({
        flagType: 'UNDER_SPECIFIED',
        description:
          'No speaker attribution available. Patient-reported and clinician-observed information ' +
          'cannot be reliably separated.',
        segmentIds: []
      });
    }

    warningMessages.push(
      'This draft was produced by the deterministic fallback extractor because the clinical ' +
        'language model was unavailable. It reorganises the transcript and links evidence, but ' +
        'performs no clinical synthesis. Full clinician authoring is required.'
    );
    reviewFlags.push({
      flagType: 'REASONING_NEEDS_CONFIRMATION',
      description:
        'Clinical reasoning, justification and plan were not generated: the language model was unavailable.',
      segmentIds: []
    });

    const routed = routeSegments(segments);
    const bySection = (key: SectionKey) => routed.filter((r) => r.section === key).map((r) => r.claim);

    const unclassifiedUncertain = bySection('unclassifiedUncertain');
    if (unclassifiedUncertain.length > 0) {
      reviewFlags.push({
        flagType: 'TRANSCRIPTION_UNCERTAIN',
        description:
          `${unclassifiedUncertain.length} utterance(s) could not be transcribed confidently or ` +
          'assigned to a clinical section, and are reproduced verbatim for review.',
        segmentIds: routed
          .filter((r) => r.section === 'unclassifiedUncertain')
          .flatMap((r) => r.claim.evidence.map((e: any) => e.segmentId))
      });
    }

    // Legacy flat views. These are cross-cutting indexes kept for API compatibility; they
    // intentionally overlap the structured sections. The document renderer reads only the
    // structured sections and de-duplicates, so this overlap never reaches the note.
    const fromClient = routed.filter(
      (r) =>
        (r.role === 'CLIENT' || r.role === 'CARER') &&
        r.section !== 'recommendationsAndActions' &&
        r.section !== 'followUpPlan' &&
        r.section !== 'trialAndSelection'
    );
    const matchingClaims = (re: RegExp) => routed.filter((r) => re.test(r.claim.value)).map((r) => r.claim);

    const measurementIndex = routed
      .filter((r) => r.claim.rawMeasurement)
      .map((r) => r.claim);

    for (const r of routed) {
      if (MEASUREMENT_RE.test(r.claim.value) && !r.claim.rawMeasurement) {
        reviewFlags.push({
          flagType: 'MEASUREMENT_INCOMPLETE',
          description: `A measurement was mentioned without a recognisable unit: "${r.claim.value}"`,
          segmentIds: r.claim.evidence.map((e: any) => e.segmentId)
        });
      }
    }

    const actions = bySection('recommendationsAndActions');
    for (const a of actions) {
      if (!/\b(by|before|within|on)\b.*\b(week|day|month|\d{1,2}\/\d{1,2})/i.test(a.value)) {
        reviewFlags.push({
          flagType: 'ACTION_OWNER_UNCLEAR',
          description: `Action recorded without an explicit owner or target date: "${a.value}"`,
          segmentIds: a.evidence.map((e: any) => e.segmentId)
        });
      }
    }

    const skinClaims = bySection('skinIntegrityConcerns');
    if (skinClaims.length === 0) {
      reviewFlags.push({
        flagType: 'SAFETY_CRITICAL_GAP',
        description:
          'Skin integrity and pressure risk were not established during this session. Absence of ' +
          'discussion is not evidence that risk is absent.',
        segmentIds: []
      });
    }

    const unstatedOrMissingFields: string[] = [];
    const recordMissing = (label: string, claims: any[]) => {
      if (claims.length === 0) unstatedOrMissingFields.push(`${label}: ${NOT_DOCUMENTED}`);
    };

    recordMissing('Reason for referral', bySection('reasonForReferral'));
    recordMissing("Person's goals", bySection('clientGoals'));
    recordMissing('Transfers', bySection('transferCapability'));
    recordMissing('Skin integrity and pressure management', skinClaims);
    recordMissing('Postural assessment', [
      ...bySection('pelvicPositioning'),
      ...bySection('trunkPositioning')
    ]);
    recordMissing('Environment and transport', bySection('environmentAndTransport'));
    recordMissing('Agreement and sign-off', bySection('agreementAndSignOff'));

    const result: StructuredClinicalExtraction = {
      noteType: 'professional_wheelchair_seating_note',
      templateType,
      sessionFormat,
      promptVersion: `${PROMPT_VERSION}-deterministic-fallback`,
      sessionInfo: {
        clientReference,
        sessionDate: new Date().toLocaleDateString('en-GB'),
        clinicianName,
        templateType,
        sessionFormat,
        // Do not assert participants that were not established.
        participants: missingSpeakerIdentification ? ['Not established from capture'] : ['Clinician', 'Client'],
        reasonForReferral: orNotStated(bySection('reasonForReferral'))
      },
      subjectiveInfo: {
        clientCarerHistory: orNotStated(bySection('clientCarerHistory')),
        presentingConcerns: orNotStated([...bySection('presentingConcerns'), ...unclassifiedUncertain]),
        clientGoals: orNotStated(bySection('clientGoals')),
        reportedChanges: templateType === 'REVIEW' ? orNotStated(bySection('presentingConcerns')) : undefined
      },
      functionalAssessment: {
        mobilityStatus: orNotStated(bySection('mobilityStatus')),
        transferCapability: orNotStated(bySection('transferCapability')),
        activitiesOfDailyLiving: orNotStated(bySection('activitiesOfDailyLiving')),
        communityParticipation: orNotStated(bySection('communityParticipation')),
        assistanceRequired: notStatedClaim(),
        fatigueAndEndurance: orNotStated(bySection('fatigueAndEndurance'))
      },
      objectiveFindings: {
        // Clinical synthesis is not performed by the fallback; these stay explicitly empty
        // rather than being filled with re-used transcript lines.
        clinicianObservations: orNotStated(bySection('clinicianObservations')),
        assessmentFindings: notStatedClaim(),
        measurementsPreserved: orNotStated(measurementIndex),
        rangeOfMovement: orNotStated(bySection('rangeOfMovement')),
        muscleStrength: orNotStated(bySection('muscleStrength'))
      },
      seatingPosturalAssessment: {
        pelvicPositioning: orNotStated(bySection('pelvicPositioning')),
        trunkPositioning: orNotStated(bySection('trunkPositioning')),
        headAndNeckPositioning: orNotStated(bySection('headAndNeckPositioning')),
        lowerLimbPositioning: orNotStated(bySection('lowerLimbPositioning')),
        posturalAsymmetry: notStatedClaim(),
        supportsAndPosturalPillows: notStatedClaim(),
        posturalStabilityAndTolerance: orNotStated(bySection('posturalStabilityAndTolerance'))
      },
      pressureManagement: {
        pressureConcerns: orNotStated(skinClaims),
        skinIntegrityConcerns: orNotStated(skinClaims),
        pressureReliefMethods: orNotStated(bySection('pressureReliefMethods')),
        pressureReliefFrequency: notStatedClaim(),
        cushionInformation: orNotStated(bySection('cushionInformation')),
        riskFactorNotes: notStatedClaim()
      },
      equipmentAssessment: {
        currentWheelchair: orNotStated(bySection('currentWheelchair')),
        currentCushion: orNotStated(bySection('cushionInformation')),
        currentBackSupport: orNotStated(bySection('currentBackSupport')),
        footAndArmSupports: orNotStated(bySection('footAndArmSupports')),
        accessoriesAndPads: notStatedClaim(),
        equipmentSuitabilityAndProblems: orNotStated(bySection('equipmentSuitabilityAndProblems'))
      },
      environmentAndTransport: orNotStated(bySection('environmentAndTransport')),
      trialAndSelection: orNotStated(bySection('trialAndSelection')),
      agreementAndSignOff: orNotStated(bySection('agreementAndSignOff')),
      outstandingConcerns: unstatedOrMissingFields.length
        ? unstatedOrMissingFields.map((f) => ({
            value: f,
            evidence: [],
            confidence: 'LOW' as const,
            sourceClassification: 'NOT_STATED' as SourceClassification
          }))
        : notStatedClaim(),

      // Reasoning is clinical synthesis. The fallback must never fabricate it.
      clinicalReasoning: notStatedClaim(),
      recommendationsAndActions: orNotStated(actions),
      followUpPlan: orNotStated(bySection('followUpPlan')),

      // Legacy flat views (see note above).
      clientConcerns: orNotStated([...fromClient.map((r) => r.claim), ...unclassifiedUncertain]),
      accessibilityBarriers: orNotStated(
        matchingClaims(/\b(doorway|threshold|steps?|stairs|ramp|lift|hallway|kerb|gradient|access|narrow|transport)\b/i)
      ),
      wheelchairSeatingConcerns: orNotStated(
        matchingClaims(/\b(wheelchair|cushion|backrest|back support|seat|seating|footplate|legrest|armrest|postural support)\b/i)
      ),
      matAssessmentInfo: orNotStated(
        matchingClaims(/\b(MAT|pelvi|obliquity|tilt|trunk|spine|scoliosis|kyphosis|posture|postural|range of movement|flexion|extension)\b/i)
      ),
      actionsAndRecommendations: orNotStated(actions),
      unstatedOrMissingFields,
      clinicianReviewFlags: reviewFlags,

      warnings: {
        poorAudioQuality: false,
        interruptedRecording: false,
        speechRecognitionFailure: segments.length === 0,
        lowConfidenceTranscription: hasLowConfidence,
        missingSpeakerIdentification,
        confidenceUnavailable,
        geminiProcessingFailure: true,
        groundingValidationFailure: false,
        rapidSpeechWarning: hasRapidSpeech,
        deterministicFallbackUsed: true,
        warningMessages
      }
    };

    return StructuredClinicalExtractionSchema.parse(result);
  }
}
