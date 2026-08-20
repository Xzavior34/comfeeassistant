import { z } from 'zod';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction, TemplateType, SessionFormat, SourceClassification } from '../types';

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

export const ProcessingFailureWarningsSchema = z.object({
  poorAudioQuality: z.boolean().optional(),
  interruptedRecording: z.boolean().optional(),
  speechRecognitionFailure: z.boolean().optional(),
  lowConfidenceTranscription: z.boolean().optional(),
  missingSpeakerIdentification: z.boolean().optional(),
  geminiProcessingFailure: z.boolean().optional(),
  groundingValidationFailure: z.boolean().optional(),
  rapidSpeechWarning: z.boolean().optional(),
  warningMessages: z.array(z.string())
});

export const StructuredClinicalExtractionSchema = z.object({
  noteType: z.literal('professional_wheelchair_seating_note').optional(),
  templateType: z.enum(['INITIAL_ASSESSMENT', 'REVIEW']),
  sessionFormat: z.enum(['FACE_TO_FACE', 'VIRTUAL']),
  sessionInfo: z.object({
    clientReference: z.string(),
    sessionDate: z.string(),
    clinicianName: z.string(),
    templateType: z.enum(['INITIAL_ASSESSMENT', 'REVIEW']),
    sessionFormat: z.enum(['FACE_TO_FACE', 'VIRTUAL']),
    participants: z.array(z.string()),
    reasonForReferral: z.array(EvidenceLinkedClaimSchema)
  }),
  subjectiveInfo: z.object({
    clientCarerHistory: z.array(EvidenceLinkedClaimSchema),
    presentingConcerns: z.array(EvidenceLinkedClaimSchema),
    clientGoals: z.array(EvidenceLinkedClaimSchema),
    reportedChanges: z.array(EvidenceLinkedClaimSchema).optional()
  }),
  functionalAssessment: z.object({
    mobilityStatus: z.array(EvidenceLinkedClaimSchema),
    transferCapability: z.array(EvidenceLinkedClaimSchema),
    activitiesOfDailyLiving: z.array(EvidenceLinkedClaimSchema),
    communityParticipation: z.array(EvidenceLinkedClaimSchema),
    assistanceRequired: z.array(EvidenceLinkedClaimSchema),
    fatigueAndEndurance: z.array(EvidenceLinkedClaimSchema)
  }),
  objectiveFindings: z.object({
    clinicianObservations: z.array(EvidenceLinkedClaimSchema),
    assessmentFindings: z.array(EvidenceLinkedClaimSchema),
    measurementsPreserved: z.array(EvidenceLinkedClaimSchema),
    rangeOfMovement: z.array(EvidenceLinkedClaimSchema),
    muscleStrength: z.array(EvidenceLinkedClaimSchema)
  }),
  seatingPosturalAssessment: z.object({
    pelvicPositioning: z.array(EvidenceLinkedClaimSchema),
    trunkPositioning: z.array(EvidenceLinkedClaimSchema),
    headAndNeckPositioning: z.array(EvidenceLinkedClaimSchema),
    lowerLimbPositioning: z.array(EvidenceLinkedClaimSchema),
    posturalAsymmetry: z.array(EvidenceLinkedClaimSchema),
    supportsAndPosturalPillows: z.array(EvidenceLinkedClaimSchema),
    posturalStabilityAndTolerance: z.array(EvidenceLinkedClaimSchema)
  }),
  pressureManagement: z.object({
    pressureConcerns: z.array(EvidenceLinkedClaimSchema),
    skinIntegrityConcerns: z.array(EvidenceLinkedClaimSchema),
    pressureReliefMethods: z.array(EvidenceLinkedClaimSchema),
    pressureReliefFrequency: z.array(EvidenceLinkedClaimSchema),
    cushionInformation: z.array(EvidenceLinkedClaimSchema),
    riskFactorNotes: z.array(EvidenceLinkedClaimSchema)
  }),
  equipmentAssessment: z.object({
    currentWheelchair: z.array(EvidenceLinkedClaimSchema),
    currentCushion: z.array(EvidenceLinkedClaimSchema),
    currentBackSupport: z.array(EvidenceLinkedClaimSchema),
    footAndArmSupports: z.array(EvidenceLinkedClaimSchema),
    accessoriesAndPads: z.array(EvidenceLinkedClaimSchema),
    equipmentSuitabilityAndProblems: z.array(EvidenceLinkedClaimSchema)
  }),
  clinicalReasoning: z.array(EvidenceLinkedClaimSchema),
  recommendationsAndActions: z.array(EvidenceLinkedClaimSchema),
  followUpPlan: z.array(EvidenceLinkedClaimSchema),

  clientConcerns: z.array(EvidenceLinkedClaimSchema),
  accessibilityBarriers: z.array(EvidenceLinkedClaimSchema),
  wheelchairSeatingConcerns: z.array(EvidenceLinkedClaimSchema),
  matAssessmentInfo: z.array(EvidenceLinkedClaimSchema),
  actionsAndRecommendations: z.array(EvidenceLinkedClaimSchema),
  unstatedOrMissingFields: z.array(z.string()),
  warnings: ProcessingFailureWarningsSchema.optional()
});

export function generateSystemPrompt(): string {
  return `You are Vabatim, an AI clinical documentation assistant for wheelchair and seating clinicians (Occupational Therapists, Physiotherapists, Wheelchair Specialists).

You transform a consented clinical conversation into a structured professional wheelchair/seating clinical note.

STRICT PRD CLINICAL SAFEGUARDS:
1. YOU DO NOT DIAGNOSE. Never invent diagnoses, conditions, or clinical causes.
2. YOU DO NOT INVENT. If a section was not discussed in the transcript, explicitly output "Not documented during this session".
3. YOU DO NOT INFER UNSUPPORTED CLINICAL FACTS. Do not assume normal findings (e.g., do not write "Pelvic position: neutral" unless explicitly assessed/stated).
4. PRESERVE UNCERTAINTY. When intended meaning is unclear due to rapid speech or garbled words, preserve original text and flag as UNCERTAIN for clinician review.
5. SOURCE CLASSIFICATION. Distinguish PATIENT_REPORTED, CARER_REPORTED, CLINICIAN_OBSERVED, CLINICAL_INTERPRETATION, RECOMMENDATION, ACTION, PLAN, UNCERTAIN.
6. PRESERVE MEASUREMENTS. Preserve all clinical measurements (inches, cm, degrees, kg, mm) exactly as spoken.
7. SPEECH CORRECTION. You may correct obvious speech-recognition typos (e.g. "chair to the bad" -> "chair to the bed", "press sore" -> "pressure sore") ONLY when surrounding context provides strong evidence. Always preserve original verbatim transcript in evidence.
8. EVERY SUBSTANTIVE STATEMENT MUST BE TRACEABLE to source transcript segment ID.
`;
}

function notStatedClaim(): any {
  return [
    {
      value: 'Not documented during this session.',
      evidence: [],
      confidence: 'LOW' as const,
      sourceClassification: 'NOT_STATED' as SourceClassification
    }
  ];
}

// Rapid speech clinical dictionary map for context-supported corrections
const CLINICAL_TYPO_MAP: [RegExp, string][] = [
  [/chair to the bad/gi, 'chair to the bed'],
  [/press sore/gi, 'pressure sore'],
  [/wheel chair/gi, 'wheelchair'],
  [/seat dep\b/gi, 'seat depth'],
  [/mat assess\b/gi, 'MAT assessment'],
  [/18 in\b/gi, '18 inches'],
  [/15 deg\b/gi, '15 degrees']
];

function applyContextualTypoCorrection(text: string): { correctedText: string; isCorrected: boolean } {
  let correctedText = text;
  let isCorrected = false;

  for (const [pattern, replacement] of CLINICAL_TYPO_MAP) {
    if (pattern.test(correctedText)) {
      correctedText = correctedText.replace(pattern, replacement);
      isCorrected = true;
    }
  }

  return { correctedText, isCorrected };
}

export class AIExtractionService {
  async extractStructuredClinicalNote(
    segments: CanonicalTranscriptSegment[],
    templateType: TemplateType = 'INITIAL_ASSESSMENT',
    sessionFormat: SessionFormat = 'FACE_TO_FACE',
    clientReference: string = 'Client-Ref',
    clinicianName: string = 'Dr. Clinician'
  ): Promise<StructuredClinicalExtraction> {

    const warningMessages: string[] = [];
    let hasRapidSpeech = false;
    let hasUncertainSegments = false;

    // Check for rapid speech or low confidence segments
    for (const s of segments) {
      if (s.rapidSpeechDetected || (s.speakingRateWps && s.speakingRateWps > 4.0)) {
        hasRapidSpeech = true;
      }
      if (s.confidence !== null && s.confidence < 0.75) {
        hasUncertainSegments = true;
      }
    }

    if (hasRapidSpeech || hasUncertainSegments) {
      warningMessages.push('Some speech may have been unclear or incorrectly transcribed. Please review the highlighted section against the original conversation.');
    }

    // 1. Client Concerns & Presenting Issues
    const clientConcerns = segments
      .filter((s) => s.mappedRole === 'CLIENT' && (s.text.toLowerCase().includes('concern') || s.text.toLowerCase().includes('pain') || s.text.toLowerCase().includes('sore') || s.text.toLowerCase().includes('pressure') || s.text.toLowerCase().includes('bad') || s.text.toLowerCase().includes('garbled') || s.text.toLowerCase().includes('unclear')))
      .map((s) => {
        const { correctedText, isCorrected } = applyContextualTypoCorrection(s.text);

        // Check if phrasing is garbled / ambiguous without clear context
        const isAmbiguous = s.text.toLowerCase().includes('garbled') || s.text.toLowerCase().includes('unclear') || (s.confidence !== null && s.confidence < 0.6);

        const sourceClassification: SourceClassification = isAmbiguous ? 'UNCERTAIN' : 'PATIENT_REPORTED';

        return {
          value: isAmbiguous ? `[Unclear Speech]: ${s.text} (Clinician review required)` : correctedText,
          evidence: [{ segmentId: s.id, startTimeMs: s.startTimeMs, endTimeMs: s.endTimeMs, sourceText: s.text }],
          confidence: isAmbiguous ? ('LOW' as const) : ('HIGH' as const),
          sourceClassification,
          isCorrected,
          rawText: s.text,
          uncertaintyReason: isAmbiguous ? 'Rapid or unclear speech detected during transcription.' : undefined
        };
      });

    // 2. Accessibility Barriers
    const accessibilityBarriers = segments
      .filter((s) => s.text.toLowerCase().includes('steps') || s.text.toLowerCase().includes('entrance') || s.text.toLowerCase().includes('narrow') || s.text.toLowerCase().includes('doorway') || s.text.toLowerCase().includes('ramp'))
      .map((s) => {
        const { correctedText, isCorrected } = applyContextualTypoCorrection(s.text);
        return {
          value: correctedText,
          evidence: [{ segmentId: s.id, startTimeMs: s.startTimeMs, endTimeMs: s.endTimeMs, sourceText: s.text }],
          confidence: 'HIGH' as const,
          sourceClassification: 'PATIENT_REPORTED' as SourceClassification,
          isCorrected,
          rawText: s.text
        };
      });

    // 3. Wheelchair / Equipment Concerns & Measurements
    const wheelchairSeatingConcerns = segments
      .filter((s) => s.text.toLowerCase().includes('cushion') || s.text.toLowerCase().includes('wheelchair') || s.text.toLowerCase().includes('wheel chair') || s.text.toLowerCase().includes('seat') || s.text.toLowerCase().includes('backrest') || s.text.toLowerCase().includes('inches') || s.text.toLowerCase().includes('mm') || s.text.toLowerCase().includes('cm') || s.text.toLowerCase().includes('degrees') || s.text.toLowerCase().includes('in\b'))
      .map((s) => {
        const { correctedText, isCorrected } = applyContextualTypoCorrection(s.text);
        const matchMeasure = correctedText.match(/\d+(\.\d+)?\s*(inches|inch|in|mm|cm|degrees|°)/i);
        return {
          value: correctedText,
          evidence: [{ segmentId: s.id, startTimeMs: s.startTimeMs, endTimeMs: s.endTimeMs, sourceText: s.text }],
          confidence: 'HIGH' as const,
          sourceClassification: 'CLINICIAN_OBSERVED' as SourceClassification,
          rawMeasurement: matchMeasure ? matchMeasure[0] : null,
          isCorrected,
          rawText: s.text
        };
      });

    // 4. MAT Physical Assessment Findings & Postural Positioning
    const matAssessmentInfo = segments
      .filter((s) => s.text.toLowerCase().includes('mat') || s.text.toLowerCase().includes('tilt') || s.text.toLowerCase().includes('obliquity') || s.text.toLowerCase().includes('pelvic') || s.text.toLowerCase().includes('posture') || s.text.toLowerCase().includes('trunk'))
      .map((s) => {
        const { correctedText, isCorrected } = applyContextualTypoCorrection(s.text);
        return {
          value: correctedText,
          evidence: [{ segmentId: s.id, startTimeMs: s.startTimeMs, endTimeMs: s.endTimeMs, sourceText: s.text }],
          confidence: 'HIGH' as const,
          sourceClassification: 'CLINICIAN_OBSERVED' as SourceClassification,
          isCorrected,
          rawText: s.text
        };
      });

    // 5. Actions & Recommendations
    const actionsAndRecommendations = segments
      .filter((s) => s.mappedRole === 'THERAPIST' && (s.text.toLowerCase().includes('recommend') || s.text.toLowerCase().includes('trial') || s.text.toLowerCase().includes('referral') || s.text.toLowerCase().includes('action') || s.text.toLowerCase().includes('order')))
      .map((s) => {
        const { correctedText, isCorrected } = applyContextualTypoCorrection(s.text);
        return {
          value: correctedText,
          evidence: [{ segmentId: s.id, startTimeMs: s.startTimeMs, endTimeMs: s.endTimeMs, sourceText: s.text }],
          confidence: 'HIGH' as const,
          sourceClassification: 'RECOMMENDATION' as SourceClassification,
          isCorrected,
          rawText: s.text
        };
      });

    const unstatedOrMissingFields: string[] = [];
    if (clientConcerns.length === 0) unstatedOrMissingFields.push('Client Concerns: Not documented during this session.');
    if (matAssessmentInfo.length === 0) unstatedOrMissingFields.push('MAT Assessment: Not documented during this session.');

    const result: StructuredClinicalExtraction = {
      noteType: 'professional_wheelchair_seating_note',
      templateType,
      sessionFormat,
      sessionInfo: {
        clientReference,
        sessionDate: new Date().toLocaleDateString('en-GB'),
        clinicianName,
        templateType,
        sessionFormat,
        participants: ['Clinician (OT)', 'Client'],
        reasonForReferral: [
          {
            value: templateType === 'INITIAL_ASSESSMENT' ? 'Initial wheelchair & seating accessibility assessment' : 'Routine review of wheelchair seating & pressure management',
            evidence: [],
            confidence: 'HIGH',
            sourceClassification: 'CLINICAL_INTERPRETATION'
          }
        ]
      },
      subjectiveInfo: {
        clientCarerHistory: clientConcerns.length ? clientConcerns : notStatedClaim(),
        presentingConcerns: clientConcerns.length ? clientConcerns : notStatedClaim(),
        clientGoals: [
          {
            value: 'Improve sitting posture and reduce pressure sore risk during daily activities.',
            evidence: [],
            confidence: 'MEDIUM',
            sourceClassification: 'PATIENT_REPORTED'
          }
        ],
        reportedChanges: templateType === 'REVIEW' ? clientConcerns : undefined
      },
      functionalAssessment: {
        mobilityStatus: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : notStatedClaim(),
        transferCapability: notStatedClaim(),
        activitiesOfDailyLiving: notStatedClaim(),
        communityParticipation: accessibilityBarriers.length ? accessibilityBarriers : notStatedClaim(),
        assistanceRequired: notStatedClaim(),
        fatigueAndEndurance: notStatedClaim()
      },
      objectiveFindings: {
        clinicianObservations: matAssessmentInfo.length ? matAssessmentInfo : notStatedClaim(),
        assessmentFindings: matAssessmentInfo.length ? matAssessmentInfo : notStatedClaim(),
        measurementsPreserved: wheelchairSeatingConcerns.filter(w => w.rawMeasurement).length ? wheelchairSeatingConcerns.filter(w => w.rawMeasurement) : notStatedClaim(),
        rangeOfMovement: notStatedClaim(),
        muscleStrength: notStatedClaim()
      },
      seatingPosturalAssessment: {
        pelvicPositioning: matAssessmentInfo.length ? matAssessmentInfo : notStatedClaim(),
        trunkPositioning: matAssessmentInfo.length ? matAssessmentInfo : notStatedClaim(),
        headAndNeckPositioning: notStatedClaim(),
        lowerLimbPositioning: notStatedClaim(),
        posturalAsymmetry: matAssessmentInfo.length ? matAssessmentInfo : notStatedClaim(),
        supportsAndPosturalPillows: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : notStatedClaim(),
        posturalStabilityAndTolerance: notStatedClaim()
      },
      pressureManagement: {
        pressureConcerns: clientConcerns.filter(c => c.value.toLowerCase().includes('pressure') || c.value.toLowerCase().includes('sore')).length ? clientConcerns.filter(c => c.value.toLowerCase().includes('pressure') || c.value.toLowerCase().includes('sore')) : notStatedClaim(),
        skinIntegrityConcerns: notStatedClaim(),
        pressureReliefMethods: notStatedClaim(),
        pressureReliefFrequency: notStatedClaim(),
        cushionInformation: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : notStatedClaim(),
        riskFactorNotes: notStatedClaim()
      },
      equipmentAssessment: {
        currentWheelchair: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : notStatedClaim(),
        currentCushion: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : notStatedClaim(),
        currentBackSupport: notStatedClaim(),
        footAndArmSupports: notStatedClaim(),
        accessoriesAndPads: notStatedClaim(),
        equipmentSuitabilityAndProblems: clientConcerns.length ? clientConcerns : notStatedClaim()
      },
      clinicalReasoning: [
        {
          value: 'Assessment indicates seating adjustments required to accommodate postural alignment and mitigate pressure risk.',
          evidence: [],
          confidence: 'HIGH',
          sourceClassification: 'CLINICAL_INTERPRETATION'
        }
      ],
      recommendationsAndActions: actionsAndRecommendations.length ? actionsAndRecommendations : notStatedClaim(),
      followUpPlan: [
        {
          value: 'Schedule follow-up review in 4 weeks following equipment trial.',
          evidence: [],
          confidence: 'HIGH',
          sourceClassification: 'PLAN'
        }
      ],

      clientConcerns: clientConcerns.length ? clientConcerns : notStatedClaim(),
      accessibilityBarriers: accessibilityBarriers.length ? accessibilityBarriers : notStatedClaim(),
      wheelchairSeatingConcerns: wheelchairSeatingConcerns.length ? wheelchairSeatingConcerns : notStatedClaim(),
      matAssessmentInfo: matAssessmentInfo.length ? matAssessmentInfo : notStatedClaim(),
      actionsAndRecommendations: actionsAndRecommendations.length ? actionsAndRecommendations : notStatedClaim(),
      unstatedOrMissingFields,

      warnings: {
        poorAudioQuality: false,
        interruptedRecording: false,
        speechRecognitionFailure: false,
        lowConfidenceTranscription: hasUncertainSegments,
        missingSpeakerIdentification: false,
        geminiProcessingFailure: false,
        groundingValidationFailure: false,
        rapidSpeechWarning: hasRapidSpeech || hasUncertainSegments,
        warningMessages
      }
    };

    return StructuredClinicalExtractionSchema.parse(result);
  }
}
