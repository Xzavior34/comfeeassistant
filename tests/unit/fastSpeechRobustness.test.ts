import { normalizeToCanonicalTranscript } from '../../src/services/canonicalTranscript';
import { AIExtractionService } from '../../src/services/aiExtraction';
import { GroundingValidator } from '../../src/services/groundingValidator';
import { ProviderTranscript } from '../../src/types';

describe('Fast-Speech & Rapid Transcription Robustness Suite (10 Audited Scenarios)', () => {
  const aiService = new AIExtractionService();
  const validator = new GroundingValidator();

  function makeProviderTranscript(segments: { speakerId: string; text: string; start: number; end: number; confidence?: number }[]): ProviderTranscript {
    return {
      providerName: 'DeviceSpeechProviderFastSpeech',
      durationMs: segments.length > 0 ? segments[segments.length - 1].end : 0,
      segments: segments.map((s) => ({
        speakerId: s.speakerId,
        startTimeMs: s.start,
        endTimeMs: s.end,
        text: s.text,
        confidence: s.confidence !== undefined ? s.confidence : 0.95
      }))
    };
  }

  it('1. Normal speaking speed (~2.5 words/sec)', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 1', text: 'Good morning. We are starting your wheelchair seating assessment today.', start: 0, end: 4000 }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-1', raw);
    expect(canonical[0].rapidSpeechDetected).toBe(false);
    expect(canonical[0].speakingRateWps).toBeLessThan(4.0);

    const note = await aiService.extractStructuredClinicalNote(canonical);
    expect(note.warnings?.rapidSpeechWarning).toBe(false);
  });

  it('2. Moderately fast speech (~3.8 words/sec)', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 2', text: 'I have severe pain in my sacrum when sitting for two hours in this chair.', start: 0, end: 4000 }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-2', raw);
    const note = await aiService.extractStructuredClinicalNote(canonical);
    expect(note.subjectiveInfo.presentingConcerns[0].value).toContain('sacrum');
    expect(validator.validate(note, canonical).isValid).toBe(true);
  });

  it('3. Very fast speech (>5.0 words/sec) triggers rapid speech warning flag', async () => {
    const raw = makeProviderTranscript([
      {
        speakerId: 'Speaker 2',
        text: 'I experience severe pressure sores and acute sacral discomfort whenever I attempt sitting for more than two hours in my standard sling wheelchair cushion seat.',
        start: 0,
        end: 4000 // 25 words in 4 seconds = 6.25 WPS
      }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-3', raw);
    expect(canonical[0].rapidSpeechDetected).toBe(true);
    expect(canonical[0].speakingRateWps).toBeGreaterThan(5.0);

    const note = await aiService.extractStructuredClinicalNote(canonical);
    expect(note.warnings?.rapidSpeechWarning).toBe(true);
    expect(note.warnings?.warningMessages.join(' ')).toContain('may have been transcribed incorrectly');
  });

  it('4. Multiple consecutive speakers in rapid succession', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 1', text: 'Checking seat width.', start: 0, end: 1000 },
      { speakerId: 'Speaker 2', text: 'Pain is severe.', start: 1000, end: 2000 },
      { speakerId: 'Speaker 1', text: 'Recommending cushion.', start: 2000, end: 3000 }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-4', raw);
    expect(canonical).toHaveLength(3);
    const note = await aiService.extractStructuredClinicalNote(canonical);
    expect(note.recommendationsAndActions[0].value).toContain('cushion');
  });

  it('5. Speaker interruption/overlap detected without hallucination', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 1', text: 'Checking seat width now', start: 0, end: 3000, confidence: 0.5 },
      { speakerId: 'Speaker 2', text: 'I need a new cushion right away', start: 2500, end: 5000, confidence: 0.5 } // Overlap 2500-3000ms
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-5', raw);
    expect(canonical[0].overlapStatus).toBe('SUSPECTED');
    expect(canonical[1].overlapStatus).toBe('SUSPECTED');

    const note = await aiService.extractStructuredClinicalNote(canonical);
    expect(validator.validate(note, canonical).isValid).toBe(true);
  });

  it('6. Rapid clinical terminology spoken quickly ("wheelchair", "seating", "posture")', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 1', text: 'Evaluating wheelchair seating posture pressure management transfers mobility and ADLs.', start: 0, end: 2500 }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-6', raw);
    const note = await aiService.extractStructuredClinicalNote(canonical);
    expect(note.equipmentAssessment.currentWheelchair[0].value).toContain('wheelchair');
  });

  it('7. Rapid numbers and measurements preserved exactly ("18 inches", "15 degrees")', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 1', text: 'Measured seat width 18 inches and 15 degrees posterior pelvic tilt on MAT evaluation.', start: 0, end: 3000 }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-7', raw);
    const note = await aiService.extractStructuredClinicalNote(canonical);
    expect(note.objectiveFindings.measurementsPreserved[0].rawMeasurement).toBe('18 inches');
  });

  it('8. Rapid speech typo correction preserves original raw text ("press sore" -> "pressure sore")', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 2', text: 'Client complains of sacral press sore when sitting in chair to the bad.', start: 0, end: 4000 }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-8', raw);
    const note = await aiService.extractStructuredClinicalNote(canonical);

    // Verbatim canonical transcript remains 100% untouched
    expect(canonical[0].text).toContain('press sore');
    expect(canonical[0].text).toContain('chair to the bad');

    // Clinical extraction applies context-supported correction
    const claim = note.subjectiveInfo.presentingConcerns.find(c => c.value.includes('pressure sore') || c.value.includes('chair to the bed'));
    expect(claim).toBeDefined();
    expect(claim?.isCorrected).toBe(true);
    expect(claim?.evidence[0].sourceText).toBe('Client complains of sacral press sore when sitting in chair to the bad.');
  });

  it('9. Ambiguous/garbled rapid speech remains unresolved and flagged as UNCERTAIN', async () => {
    const raw = makeProviderTranscript([
      { speakerId: 'Speaker 2', text: 'Client reported garbled speech and unclear phrasing during rapid discussion.', start: 0, end: 4000, confidence: 0.5 }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-9', raw);
    const note = await aiService.extractStructuredClinicalNote(canonical);

    const uncertainClaim = note.subjectiveInfo.presentingConcerns.find(c => c.sourceClassification === 'UNCERTAIN');
    expect(uncertainClaim).toBeDefined();
    expect(uncertainClaim?.value).toContain('[Unclear Speech]');
  });

  it('10. Long uninterrupted clinical statement remains traceable to source segment ID', async () => {
    const raw = makeProviderTranscript([
      {
        speakerId: 'Speaker 1',
        text: 'The client presents with a history of recurrent sacral pressure ulcers related to pelvic asymmetry and extended sitting duration in an un-contoured sling seat wheelchair. MAT examination confirms a 15 degree posterior pelvic tilt and 10 degree right pelvic obliquity. We recommend trialling a high-specification pressure redistributing foam cushion with integral lateral pelvic supports.',
        start: 0,
        end: 15000
      }
    ]);
    const canonical = normalizeToCanonicalTranscript('m-fast-10', raw);
    const note = await aiService.extractStructuredClinicalNote(canonical);

    const valResult = validator.validate(note, canonical);
    expect(valResult.isValid).toBe(true);
    const recommendation = note.recommendationsAndActions.find((c) => /recommend/i.test(c.value));
    expect(recommendation).toBeDefined();
    expect(recommendation!.evidence[0].segmentId).toBe(canonical[0].id);
  });
});
