import { normalizeToCanonicalTranscript } from '../../src/services/canonicalTranscript';
import { AIExtractionService } from '../../src/services/aiExtraction';
import { ProviderTranscript } from '../../src/types';
import { ParticipantRole } from '@prisma/client';

describe('Role Mapping Dynamics & Independence', () => {
  const aiService = new AIExtractionService();

  const mockRawTranscript: ProviderTranscript = {
    providerName: 'MockSpeechProvider',
    durationMs: 20000,
    segments: [
      {
        speakerId: 'Speaker A',
        startTimeMs: 0,
        endTimeMs: 5000,
        text: 'Main concern is severe hip pain when sitting',
        confidence: 0.95
      },
      {
        speakerId: 'Speaker B',
        startTimeMs: 5500,
        endTimeMs: 10000,
        text: 'I recommend a trial of contoured pelvic support cushion',
        confidence: 0.98
      }
    ]
  };

  it('should change extracted role mapping without altering underlying canonical transcript text or timestamps', async () => {
    // 1. Initial Mapping: Speaker A = CLIENT, Speaker B = THERAPIST
    const initialMapping: Record<string, ParticipantRole> = {
      'Speaker A': ParticipantRole.CLIENT,
      'Speaker B': ParticipantRole.THERAPIST
    };

    const canonical1 = normalizeToCanonicalTranscript('m-1', mockRawTranscript, initialMapping);
    expect(canonical1[0].mappedRole).toBe('CLIENT');
    expect(canonical1[1].mappedRole).toBe('THERAPIST');

    const note1 = await aiService.extractStructuredClinicalNote(canonical1);
    expect(note1.clientConcerns[0].value).toContain('hip pain');
    expect(note1.actionsAndRecommendations[0].value).toContain('contoured pelvic support cushion');

    // 2. Clinician Remaps Roles: Speaker A = THERAPIST, Speaker B = CLIENT
    const swappedMapping: Record<string, ParticipantRole> = {
      'Speaker A': ParticipantRole.THERAPIST,
      'Speaker B': ParticipantRole.CLIENT
    };

    const canonical2 = normalizeToCanonicalTranscript('m-1', mockRawTranscript, swappedMapping);
    expect(canonical2[0].mappedRole).toBe('THERAPIST');
    expect(canonical2[1].mappedRole).toBe('CLIENT');

    // Underlying transcript text and timestamps remain untouched
    expect(canonical2[0].text).toBe(canonical1[0].text);
    expect(canonical2[0].startTimeMs).toBe(canonical1[0].startTimeMs);

    const note2 = await aiService.extractStructuredClinicalNote(canonical2);
    // Extracted client concerns now reflect the remapped role
    expect(note2.clientConcerns[0].value).toBe('Not stated');
  });
});
