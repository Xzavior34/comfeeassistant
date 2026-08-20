import { GroundingValidator } from '../../src/services/groundingValidator';
import { CanonicalTranscriptSegment } from '../../src/types';

describe('Deterministic Grounding Validator', () => {
  const validator = new GroundingValidator();

  const canonicalSegments: CanonicalTranscriptSegment[] = [
    {
      id: 'seg-1',
      meetingId: 'm-1',
      startTimeMs: 0,
      endTimeMs: 5000,
      speakerId: 'Speaker 2',
      mappedRole: 'CLIENT',
      text: 'Patient complains of sacral pressure sore',
      confidence: 0.95,
      overlapStatus: 'CLEAR',
      sourceProvider: 'MockProvider',
      sourceSegmentId: 'raw-1'
    }
  ];

  it('should pass grounded claims backed by valid transcript segments', () => {
    const note = {
      clientConcerns: [
        {
          value: 'sacral pressure sore',
          evidence: [
            {
              segmentId: 'seg-1',
              startTimeMs: 0,
              endTimeMs: 5000,
              sourceText: 'Patient complains of sacral pressure sore'
            }
          ],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };

    const result = validator.validate(note as any, canonicalSegments);
    expect(result.isValid).toBe(true);
    expect(result.groundedClaimsCount).toBe(1);
    expect(result.rejectedClaims).toHaveLength(0);
  });

  it('should reject ungrounded claims referencing non-existent segment IDs', () => {
    const note = {
      clientConcerns: [
        {
          value: 'invented claim',
          evidence: [
            {
              segmentId: 'seg-999', // Non-existent segment
              startTimeMs: 0,
              endTimeMs: 5000,
              sourceText: 'fake text'
            }
          ],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };

    const result = validator.validate(note as any, canonicalSegments);
    expect(result.isValid).toBe(false);
    expect(result.rejectedClaims.length).toBeGreaterThan(0);
  });
});
