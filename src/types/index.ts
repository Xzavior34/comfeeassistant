import { Request } from 'express';
import { UserRole } from '@prisma/client';

export type TemplateType = 'INITIAL_ASSESSMENT' | 'REVIEW';
export type SessionFormat = 'FACE_TO_FACE' | 'VIRTUAL';

export type SourceClassification =
  | 'PATIENT_REPORTED'
  | 'CARER_REPORTED'
  | 'CLINICIAN_OBSERVED'
  | 'CLINICAL_INTERPRETATION'
  | 'RECOMMENDATION'
  | 'ACTION'
  | 'PLAN'
  | 'UNCERTAIN'
  | 'NOT_STATED';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  organisationId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface ProviderTranscriptSegment {
  speakerId: string;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  confidence: number | null;
}

export interface ProviderTranscript {
  providerName: string;
  durationMs: number;
  segments: ProviderTranscriptSegment[];
}

export interface CanonicalTranscriptSegment {
  id: string;
  meetingId: string;
  startTimeMs: number;
  endTimeMs: number;
  speakerId: string;
  mappedRole: 'THERAPIST' | 'CLIENT' | 'CARER' | 'INTERPRETER' | 'OTHER' | null;
  text: string;
  confidence: number | null;
  overlapStatus: 'CLEAR' | 'SUSPECTED' | 'UNKNOWN';
  sourceProvider: string;
  sourceSegmentId: string | null;
}

export interface EvidenceReference {
  segmentId: string;
  startTimeMs: number;
  endTimeMs: number;
  sourceText: string;
}

export interface EvidenceLinkedClaim {
  value: string;
  evidence: EvidenceReference[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceClassification?: SourceClassification;
  rawMeasurement?: string | null;
  isCorrected?: boolean;
}

export interface ProcessingFailureWarnings {
  poorAudioQuality?: boolean;
  interruptedRecording?: boolean;
  speechRecognitionFailure?: boolean;
  lowConfidenceTranscription?: boolean;
  missingSpeakerIdentification?: boolean;
  geminiProcessingFailure?: boolean;
  groundingValidationFailure?: boolean;
  warningMessages: string[];
}

export interface SessionInformation {
  clientReference: string;
  sessionDate: string;
  clinicianName: string;
  templateType: TemplateType;
  sessionFormat: SessionFormat;
  participants: string[];
  reasonForReferral: EvidenceLinkedClaim[];
}

export interface SubjectiveInformation {
  clientCarerHistory: EvidenceLinkedClaim[];
  presentingConcerns: EvidenceLinkedClaim[];
  clientGoals: EvidenceLinkedClaim[];
  reportedChanges?: EvidenceLinkedClaim[];
}

export interface FunctionalAssessment {
  mobilityStatus: EvidenceLinkedClaim[];
  transferCapability: EvidenceLinkedClaim[];
  activitiesOfDailyLiving: EvidenceLinkedClaim[];
  communityParticipation: EvidenceLinkedClaim[];
  assistanceRequired: EvidenceLinkedClaim[];
  fatigueAndEndurance: EvidenceLinkedClaim[];
}

export interface ObjectiveClinicalFindings {
  clinicianObservations: EvidenceLinkedClaim[];
  assessmentFindings: EvidenceLinkedClaim[];
  measurementsPreserved: EvidenceLinkedClaim[];
  rangeOfMovement: EvidenceLinkedClaim[];
  muscleStrength: EvidenceLinkedClaim[];
}

export interface SeatingPosturalAssessment {
  pelvicPositioning: EvidenceLinkedClaim[];
  trunkPositioning: EvidenceLinkedClaim[];
  headAndNeckPositioning: EvidenceLinkedClaim[];
  lowerLimbPositioning: EvidenceLinkedClaim[];
  posturalAsymmetry: EvidenceLinkedClaim[];
  supportsAndPosturalPillows: EvidenceLinkedClaim[];
  posturalStabilityAndTolerance: EvidenceLinkedClaim[];
}

export interface PressureManagement {
  pressureConcerns: EvidenceLinkedClaim[];
  skinIntegrityConcerns: EvidenceLinkedClaim[];
  pressureReliefMethods: EvidenceLinkedClaim[];
  pressureReliefFrequency: EvidenceLinkedClaim[];
  cushionInformation: EvidenceLinkedClaim[];
  riskFactorNotes: EvidenceLinkedClaim[];
}

export interface WheelchairSeatingEquipment {
  currentWheelchair: EvidenceLinkedClaim[];
  currentCushion: EvidenceLinkedClaim[];
  currentBackSupport: EvidenceLinkedClaim[];
  footAndArmSupports: EvidenceLinkedClaim[];
  accessoriesAndPads: EvidenceLinkedClaim[];
  equipmentSuitabilityAndProblems: EvidenceLinkedClaim[];
}

export interface StructuredClinicalExtraction {
  noteType?: 'professional_wheelchair_seating_note';
  templateType: TemplateType;
  sessionFormat: SessionFormat;
  sessionInfo: SessionInformation;
  subjectiveInfo: SubjectiveInformation;
  functionalAssessment: FunctionalAssessment;
  objectiveFindings: ObjectiveClinicalFindings;
  seatingPosturalAssessment: SeatingPosturalAssessment;
  pressureManagement: PressureManagement;
  equipmentAssessment: WheelchairSeatingEquipment;
  clinicalReasoning: EvidenceLinkedClaim[];
  recommendationsAndActions: EvidenceLinkedClaim[];
  followUpPlan: EvidenceLinkedClaim[];

  // Additional Clinical Note Category aliases for maximum compatibility
  clientReportedInformation?: EvidenceLinkedClaim[];
  equipmentAndEnvironment?: EvidenceLinkedClaim[];
  assessmentFindings?: EvidenceLinkedClaim[];
  planAndNextSteps?: EvidenceLinkedClaim[];
  reasonForContact?: EvidenceLinkedClaim[];
  relevantHistory?: EvidenceLinkedClaim[];
  functionalInformation?: EvidenceLinkedClaim[];
  observations?: EvidenceLinkedClaim[];
  interventions?: EvidenceLinkedClaim[];
  clinicalConsiderations?: EvidenceLinkedClaim[];
  informationRequiringReview?: EvidenceLinkedClaim[];

  // Legacy & Compatibility fields (derived from above)
  clientConcerns: EvidenceLinkedClaim[];
  accessibilityBarriers: EvidenceLinkedClaim[];
  wheelchairSeatingConcerns: EvidenceLinkedClaim[];
  matAssessmentInfo: EvidenceLinkedClaim[];
  actionsAndRecommendations: EvidenceLinkedClaim[];
  unstatedOrMissingFields: string[];

  // System Warning State
  warnings?: ProcessingFailureWarnings;
}
