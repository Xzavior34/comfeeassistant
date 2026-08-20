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

  it('1. ADVERSARIAL ATTACK: Completely invented clinical finding', () => {
    const note: StructuredClinicalExtraction = {
      clientConcerns: [
        {
          value: 'Client suffers from severe diabetic neuropathy in feet',
          evidence: [{ segmentId: 'seg-101', startTimeMs: 0, endTimeMs: 5000, sourceText: 'Client complains of sacral pressure sores when sitting in chair.' }],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('2. ADVERSARIAL ATTACK: Wrong speaker role claim mapping', () => {
    const note: StructuredClinicalExtraction = {
      actionsAndRecommendations: [
        {
          value: 'Client recommends prescription of antibiotics', // Wrong speaker role action
          evidence: [{ segmentId: 'seg-101', startTimeMs: 0, endTimeMs: 5000, sourceText: 'Client complains of sacral pressure sores when sitting in chair.' }],
          confidence: 'HIGH'
        }
      ],
      clientConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('3. ADVERSARIAL ATTACK: Out-of-bounds fake timestamp', () => {
    const note: StructuredClinicalExtraction = {
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-101', startTimeMs: 90000, endTimeMs: 95000, sourceText: 'Client complains of sacral pressure sores when sitting in chair.' }],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('4. ADVERSARIAL ATTACK: Non-existent segment ID', () => {
    const note: StructuredClinicalExtraction = {
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-999999', startTimeMs: 0, endTimeMs: 5000, sourceText: 'sacral pressure sores' }],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('5. ADVERSARIAL ATTACK: Modified source quotation text', () => {
    const note: StructuredClinicalExtraction = {
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-101', startTimeMs: 0, endTimeMs: 5000, sourceText: 'TAMPERED QUOTE TEXT' }],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('6. ADVERSARIAL ATTACK: Claim supported by a foreign meeting segment', () => {
    const foreignSegments: CanonicalTranscriptSegment[] = [
      {
        id: 'seg-foreign-999',
        meetingId: 'meeting-beta-foreign',
        startTimeMs: 0,
        endTimeMs: 5000,
        speakerId: 'Speaker 1',
        mappedRole: 'CLIENT',
        text: 'Foreign text from another patient meeting.',
        confidence: 0.9,
        overlapStatus: 'CLEAR',
        sourceProvider: 'MockSpeechProvider',
        sourceSegmentId: 'raw-foreign'
      }
    ];
    const note: StructuredClinicalExtraction = {
      clientConcerns: [
        {
          value: 'sacral pressure sores',
          evidence: [{ segmentId: 'seg-foreign-999', startTimeMs: 0, endTimeMs: 5000, sourceText: 'Foreign text from another patient meeting.' }],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments); // Target is meeting-alpha
    expect(res.isValid).toBe(false);
  });

  it('7. ADVERSARIAL ATTACK: Unstated recommendation injection', () => {
    const note: StructuredClinicalExtraction = {
      actionsAndRecommendations: [
        {
          value: 'Therapist recommends surgical spinal fusion',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ],
      clientConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('8. ADVERSARIAL ATTACK: Unstated diagnosis injection', () => {
    const note: StructuredClinicalExtraction = {
      matAssessmentInfo: [
        {
          value: 'Diagnosed with Duchenne Muscular Dystrophy',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ],
      clientConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('9. ADVERSARIAL ATTACK: Unstated owner assignment injection', () => {
    const note: StructuredClinicalExtraction = {
      actionsAndRecommendations: [
        {
          value: 'Social worker John Smith assigned to build ramp by next week',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ],
      clientConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });

  it('10. ADVERSARIAL ATTACK: Unstated deadline injection', () => {
    const note: StructuredClinicalExtraction = {
      actionsAndRecommendations: [
        {
          value: 'Cushion trial must be completed strictly by 5pm tomorrow',
          evidence: [{ segmentId: 'seg-102', startTimeMs: 5500, endTimeMs: 12000, sourceText: 'Observed 15 degree posterior pelvic tilt on MAT assessment.' }],
          confidence: 'HIGH'
        }
      ],
      clientConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, canonicalSegments);
    expect(res.isValid).toBe(false);
  });
});
