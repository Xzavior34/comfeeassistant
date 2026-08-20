import { GroundingValidator } from '../../src/services/groundingValidator';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../src/types';

describe('Adversarial Hallucination Injection Suite (10 Attack Vector Audits)', () => {
  const validator = new GroundingValidator();

  const canonicalSegments: CanonicalTranscriptSegment[] = [
    {
      id: 'seg-101',
      meetingId: 'meeting-alpha',
      startTimeMs: 0,
      endTimeMs: 5000,
      speakerId: 'Speaker 1',
      mappedRole: 'CLIENT',
      text: 'Client complains of sacral pressure sores when sitting in chair.',
      confidence: 0.96,
      overlapStatus: 'CLEAR',
      sourceProvider: 'MockSpeechProvider',
      sourceSegmentId: 'raw-101'
    },
    {
      id: 'seg-102',
      meetingId: 'meeting-alpha',
      startTimeMs: 5500,
      endTimeMs: 12000,
      speakerId: 'Speaker 2',
      mappedRole: 'THERAPIST',
      text: 'Observed 15 degree posterior pelvic tilt on MAT assessment.',
      confidence: 0.98,
      overlapStatus: 'CLEAR',
      sourceProvider: 'MockSpeechProvider',
      sourceSegmentId: 'raw-102'
    }
  ];

  const notStated = () => [{ value: 'Not documented during this session.', evidence: [], confidence: 'LOW' as const, sourceClassification: 'NOT_STATED' as const }];

  function buildTestNote(overrides: Partial<StructuredClinicalExtraction>): StructuredClinicalExtraction {
    return {
      templateType: 'INITIAL_ASSESSMENT',
      sessionFormat: 'FACE_TO_FACE',
      sessionInfo: {
        clientReference: 'CLIENT-101',
        sessionDate: '20/08/2026',
        clinicianName: 'Dr. Smith',
        templateType: 'INITIAL_ASSESSMENT',
        sessionFormat: 'FACE_TO_FACE',
        participants: ['Therapist', 'Client'],
        reasonForReferral: notStated()
      },
      subjectiveInfo: {
        clientCarerHistory: notStated(),
        presentingConcerns: notStated(),
        clientGoals: notStated()
      },
      functionalAssessment: {
        mobilityStatus: notStated(),
        transferCapability: notStated(),
        activitiesOfDailyLiving: notStated(),
        communityParticipation: notStated(),
        assistanceRequired: notStated(),
        fatigueAndEndurance: notStated()
      },
      objectiveFindings: {
        clinicianObservations: notStated(),
        assessmentFindings: notStated(),
        measurementsPreserved: notStated(),
        rangeOfMovement: notStated(),
        muscleStrength: notStated()
      },
      seatingPosturalAssessment: {
        pelvicPositioning: notStated(),
        trunkPositioning: notStated(),
        headAndNeckPositioning: notStated(),
        lowerLimbPositioning: notStated(),
        posturalAsymmetry: notStated(),
        supportsAndPosturalPillows: notStated(),
        posturalStabilityAndTolerance: notStated()
      },
      pressureManagement: {
        pressureConcerns: notStated(),
        skinIntegrityConcerns: notStated(),
        pressureReliefMethods: notStated(),
        pressureReliefFrequency: notStated(),
        cushionInformation: notStated(),
        riskFactorNotes: notStated()
      },
      equipmentAssessment: {
        currentWheelchair: notStated(),
        currentCushion: notStated(),
        currentBackSupport: notStated(),
        footAndArmSupports: notStated(),
        accessoriesAndPads: notStated(),
        equipmentSuitabilityAndProblems: notStated()
      },
      clinicalReasoning: notStated(),
      recommendationsAndActions: notStated(),
      followUpPlan: notStated(),
      clientConcerns: notStated(),
      accessibilityBarriers: notStated(),
      wheelchairSeatingConcerns: notStated(),
      matAssessmentInfo: notStated(),
      actionsAndRecommendations: notStated(),
      unstatedOrMissingFields: [],
      ...overrides
    };
  }

  it('1. ADVERSARIAL ATTACK: Completely invented clinical finding', () => {
    const note = buildTestNote({
      clientConcerns: [
        {
          value: 'Client suffers from severe diabetic neuropathy in feet',
          evidence: [{ segmentId: 'seg-101', startTimeMs: 0, endTimeMs: 5000, sourceText: 'Client complains of sacral pressure sores when sitting in chair.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('2. ADVERSARIAL ATTACK: Wrong speaker role claim mapping', () => {
    const note = buildTestNote({
      actionsAndRecommendations: [
        {
          value: 'Client recommends prescription of antibiotics',
          evidence: [{ segmentId: 'seg-101', startTimeMs: 0, endTimeMs: 5000, sourceText: 'Client complains of sacral pressure sores when sitting in chair.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('3. ADVERSARIAL ATTACK: Out-of-bounds fake timestamp', () => {
    const note = buildTestNote({
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-101', startTimeMs: 90000, endTimeMs: 95000, sourceText: 'Client complains of sacral pressure sores when sitting in chair.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('4. ADVERSARIAL ATTACK: Non-existent segment ID', () => {
    const note = buildTestNote({
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-999999', startTimeMs: 0, endTimeMs: 5000, sourceText: 'sacral pressure sores' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('5. ADVERSARIAL ATTACK: Modified source quotation text', () => {
    const note = buildTestNote({
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-101', startTimeMs: 0, endTimeMs: 5000, sourceText: 'TAMPERED QUOTE TEXT' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('6. ADVERSARIAL ATTACK: Claim supported by a foreign meeting segment', () => {
    const note = buildTestNote({
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-foreign-999', startTimeMs: 0, endTimeMs: 5000, sourceText: 'Foreign text from another patient meeting.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('7. ADVERSARIAL ATTACK: Unstated recommendation injection', () => {
    const note = buildTestNote({
      actionsAndRecommendations: [
        {
          value: 'Therapist recommends surgical spinal fusion',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('8. ADVERSARIAL ATTACK: Unstated diagnosis injection', () => {
    const note = buildTestNote({
      matAssessmentInfo: [
        {
          value: 'Diagnosed with Duchenne Muscular Dystrophy',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('9. ADVERSARIAL ATTACK: Unstated owner assignment injection', () => {
    const note = buildTestNote({
      actionsAndRecommendations: [
        {
          value: 'Social worker John Smith assigned to build ramp by next week',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('10. ADVERSARIAL ATTACK: Unstated deadline injection', () => {
    const note = buildTestNote({
      actionsAndRecommendations: [
        {
          value: 'Cushion trial must be completed strictly by 5pm tomorrow',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ]
    });
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });
});
