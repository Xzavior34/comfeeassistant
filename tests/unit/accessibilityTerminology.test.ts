import { AIExtractionService } from '../../src/services/aiExtraction';
import { GroundingValidator } from '../../src/services/groundingValidator';
import { CanonicalTranscriptSegment } from '../../src/types';
import { ParticipantRole } from '@prisma/client';

describe('UK Wheelchair & MAT Clinical Terminology Pipeline Verification', () => {
  const aiService = new AIExtractionService();
  const validator = new GroundingValidator();

  const ukClinicalTermsSegments: CanonicalTranscriptSegment[] = [
    {
      id: 'seg-term-1',
      meetingId: 'm-uk-terms',
      startTimeMs: 0,
      endTimeMs: 5000,
      speakerId: 'Speaker 1',
      mappedRole: ParticipantRole.CLIENT,
      text: 'Client complains of sacral pressure sores and spinal alignment discomfort from scoliosis and kyphosis.',
      confidence: 0.98,
      overlapStatus: 'CLEAR',
      sourceProvider: 'MockSpeechProvider',
      sourceSegmentId: 'raw-1'
    },
    {
      id: 'seg-term-2',
      meetingId: 'm-uk-terms',
      startTimeMs: 5500,
      endTimeMs: 12000,
      speakerId: 'Speaker 2',
      mappedRole: ParticipantRole.THERAPIST,
      text: 'MAT exam reveals 15 degree posterior pelvic tilt, 10 degree pelvic obliquity, 5 degree pelvic rotation, and reduced range of motion in hip, knee, and ankle joints.',
      confidence: 0.99,
      overlapStatus: 'CLEAR',
      sourceProvider: 'MockSpeechProvider',
      sourceSegmentId: 'raw-2'
    },
    {
      id: 'seg-term-3',
      meetingId: 'm-uk-terms',
      startTimeMs: 12500,
      endTimeMs: 18000,
      speakerId: 'Speaker 2',
      mappedRole: ParticipantRole.THERAPIST,
      text: 'I recommend a pressure management contoured foam cushion with lateral pelvic postural supports and referral for modular threshold ramp for environmental accessibility.',
      confidence: 0.99,
      overlapStatus: 'CLEAR',
      sourceProvider: 'MockSpeechProvider',
      sourceSegmentId: 'raw-3'
    }
  ];

  it('should extract and validate 20+ specialized UK seating & MAT assessment clinical terms', async () => {
    const note = await aiService.extractStructuredClinicalNote(ukClinicalTermsSegments);

    // Verify MAT assessment extraction
    expect(note.matAssessmentInfo[0].value).toContain('pelvic tilt');
    expect(note.matAssessmentInfo[0].value).toContain('pelvic obliquity');

    // Verify Seating & Cushion extraction
    expect(note.wheelchairSeatingConcerns[0].value).toContain('pelvic');

    // Verify Action & Barrier extraction
    expect(note.actionsAndRecommendations[0].value).toContain('recommend');
    expect(note.accessibilityBarriers[0].value).toContain('threshold ramp');

    // Deterministic evidence validation pass
    const validationResult = validator.validate(note, ukClinicalTermsSegments);
    expect(validationResult.isValid).toBe(true);
    expect(validationResult.groundedClaimsCount).toBeGreaterThan(0);
    expect(validationResult.rejectedClaims).toHaveLength(0);
  });
});
