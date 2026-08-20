import { Request } from 'express';
import { UserRole } from '@prisma/client';

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
}

export interface StructuredClinicalExtraction {
  clientConcerns: EvidenceLinkedClaim[];
  accessibilityBarriers: EvidenceLinkedClaim[];
  wheelchairSeatingConcerns: EvidenceLinkedClaim[];
  matAssessmentInfo: EvidenceLinkedClaim[];
  actionsAndRecommendations: EvidenceLinkedClaim[];
  unstatedOrMissingFields: string[];
}
