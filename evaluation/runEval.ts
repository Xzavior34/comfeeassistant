import fs from 'fs';
import path from 'path';
import { GroundingValidator } from '../src/services/groundingValidator';
import { AIExtractionService } from '../src/services/aiExtraction';
import { CanonicalTranscriptSegment } from '../src/types';
import { ParticipantRole } from '@prisma/client';

async function runExpandedEvaluationSuite() {
  console.log('=======================================================');
  console.log(' VABATIM EXPANDED AI EVALUATION & BENCHMARK HARNESS');
  console.log('=======================================================');

  const fixturesPath = path.join(__dirname, 'fixtures', 'syntheticMeetings.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

  const aiService = new AIExtractionService();
  const validator = new GroundingValidator();

  let totalFixtures = fixtures.length;
  let totalClaimsEvaluated = 0;
  let totalGrounded = 0;
  let totalUnsupported = 0;
  let correctRoleMappings = 0;

  for (const fixture of fixtures) {
    const canonicalSegments: CanonicalTranscriptSegment[] = fixture.transcript.map((t: any, idx: number) => ({
      id: `seg-${idx + 1}`,
      meetingId: fixture.id,
      startTimeMs: idx * 5000,
      endTimeMs: (idx + 1) * 5000,
      speakerId: t.speakerId,
      mappedRole: t.role as ParticipantRole,
      text: t.text,
      confidence: t.text.includes('uncertainty') ? 0.5 : 0.98,
      overlapStatus: t.text.includes('uncertainty') ? 'SUSPECTED' : 'CLEAR',
      sourceProvider: 'MockSpeechProvider',
      sourceSegmentId: `raw-${idx + 1}`
    }));

    // Verify Role Mapping Integrity
    const hasRoleMismatch = canonicalSegments.some(s => s.mappedRole === null);
    if (!hasRoleMismatch) correctRoleMappings++;

    const note = await aiService.extractStructuredClinicalNote(canonicalSegments);
    const result = validator.validate(note, canonicalSegments);

    totalClaimsEvaluated += result.totalClaimsEvaluated;
    totalGrounded += result.groundedClaimsCount;
    totalUnsupported += result.rejectedClaims.length;
  }

  const groundingPrecision = totalClaimsEvaluated > 0 ? (totalGrounded / totalClaimsEvaluated) * 100 : 100;
  const unsupportedClaimRate = totalClaimsEvaluated > 0 ? (totalUnsupported / totalClaimsEvaluated) * 100 : 0;
  const roleMappingAccuracy = (correctRoleMappings / totalFixtures) * 100;

  console.log('\n=======================================================');
  console.log(' 20-FIXTURE BENCHMARK EVALUATION SCORECARD');
  console.log('=======================================================');
  console.log(` Total Synthetic Fixtures Evaluated: ${totalFixtures}`);
  console.log(` Total Clinical Claims Evaluated:   ${totalClaimsEvaluated}`);
  console.log(` Evidence Grounding Precision:       ${groundingPrecision.toFixed(2)}%`);
  console.log(` Unsupported Claim Rate:            ${unsupportedClaimRate.toFixed(2)}%`);
  console.log(` Role Mapping Accuracy:             ${roleMappingAccuracy.toFixed(2)}%`);
  console.log(` Benchmark Status:                  ${unsupportedClaimRate === 0 ? 'PASSED (0 Unsupported Claims)' : 'FLAGGED'}`);
  console.log('=======================================================\n');
}

runExpandedEvaluationSuite().catch(console.error);
