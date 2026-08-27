import { attributeVoices, describeAttribution } from '../../src/services/voiceRoleAttribution';
import { groupWordsBySpeaker, buildSpeechContexts } from '../../src/providers/speech/GoogleSpeechProvider';
import { ProviderTranscriptSegment } from '../../src/types';
import { ParticipantRole } from '@prisma/client';

const seg = (speakerId: string, text: string, start: number, end: number): ProviderTranscriptSegment => ({
  speakerId,
  text,
  startTimeMs: start,
  endTimeMs: end,
  confidence: 0.9
});

describe('Diarisation word grouping', () => {
  it('collapses per-word speaker tags into contiguous utterances', () => {
    const words = [
      { word: 'Can', startTime: '0s', endTime: '0.3s', speakerTag: 1, confidence: 0.95 },
      { word: 'you', startTime: '0.3s', endTime: '0.5s', speakerTag: 1, confidence: 0.94 },
      { word: 'lean', startTime: '0.5s', endTime: '0.8s', speakerTag: 1, confidence: 0.9 },
      { word: 'Yes', startTime: '1.0s', endTime: '1.3s', speakerTag: 2, confidence: 0.88 },
      { word: 'ok', startTime: '1.3s', endTime: '1.6s', speakerTag: 2, confidence: 0.7 }
    ];
    const segments = groupWordsBySpeaker(words);
    expect(segments).toHaveLength(2);
    expect(segments[0].speakerId).toBe('Speaker 1');
    expect(segments[0].text).toBe('Can you lean');
    expect(segments[1].text).toBe('Yes ok');
  });

  it('reports the weakest word as the segment confidence', () => {
    const words = [
      { word: 'pelvic', startTime: '0s', endTime: '0.4s', speakerTag: 1, confidence: 0.99 },
      { word: 'obliquity', startTime: '0.4s', endTime: '0.9s', speakerTag: 1, confidence: 0.42 }
    ];
    // Averaging would report 0.7 and hide the misheard clinical term.
    expect(groupWordsBySpeaker(words)[0].confidence).toBeCloseTo(0.42);
  });

  it('starts a new segment after a long pause by the same speaker', () => {
    const words = [
      { word: 'First', startTime: '0s', endTime: '0.5s', speakerTag: 1, confidence: 0.9 },
      { word: 'Second', startTime: '9s', endTime: '9.5s', speakerTag: 1, confidence: 0.9 }
    ];
    expect(groupWordsBySpeaker(words)).toHaveLength(2);
  });

  it('builds boosted speech contexts from the clinical lexicon', () => {
    const contexts = buildSpeechContexts(['Quickie QM-7']);
    expect(contexts.length).toBe(3);
    expect(contexts[0].phrases).toContain('pelvic obliquity');
    // Session-specific terms are boosted above the general lexicon.
    expect(contexts[2].boost).toBeGreaterThan(contexts[0].boost);
  });
});

describe('Voice role attribution', () => {
  const consultation: ProviderTranscriptSegment[] = [
    seg('Speaker 1', 'Good morning. Can you tell me how you have been getting on with the chair?', 0, 5000),
    seg('Speaker 2', 'I get a lot of pain in my hip when I sit for more than an hour.', 5500, 11000),
    seg('Speaker 1', 'Could you lean forward for me? I am going to measure the seat depth.', 11500, 16000),
    seg('Speaker 1', 'Seat width is 44 cm and there is a 15 degrees posterior pelvic tilt.', 16500, 22000),
    seg('Speaker 2', 'I feel like I am sliding forward all the time.', 22500, 26000),
    seg('Speaker 1', 'I recommend a pressure redistributing cushion and we will review in six weeks.', 26500, 33000)
  ];

  it('identifies the clinician and the patient from how they speak', () => {
    const result = attributeVoices(consultation);
    expect(result.speakerCount).toBe(2);
    expect(result.map['Speaker 1']).toBe(ParticipantRole.THERAPIST);
    expect(result.map['Speaker 2']).toBe(ParticipantRole.CLIENT);
  });

  it('explains its reasoning so the clinician can check it', () => {
    const result = attributeVoices(consultation);
    const clinician = result.assignments.find((a) => a.role === ParticipantRole.THERAPIST)!;
    expect(clinician.rationale.join(' ')).toMatch(/question/);
    expect(clinician.rationale.join(' ')).toMatch(/measurement/);
    expect(describeAttribution(result)).toContain('2 voices separated');
  });

  it('separates a carer from the patient by third-person report', () => {
    const withCarer = [
      ...consultation,
      seg('Speaker 3', 'He cannot manage the transfer on his own, I help him every morning.', 34000, 40000)
    ];
    const result = attributeVoices(withCarer);
    expect(result.speakerCount).toBe(3);
    expect(result.map['Speaker 3']).toBe(ParticipantRole.CARER);
  });

  it('abstains rather than guessing when no voice is distinctive', () => {
    const ambiguous = [
      seg('Speaker 1', 'Yes. Mmm. Right.', 0, 2000),
      seg('Speaker 2', 'Okay. Mmm.', 2500, 4000)
    ];
    const result = attributeVoices(ambiguous, { clinicianSpeaksFirst: false });
    expect(Object.keys(result.map)).toHaveLength(0);
    expect(result.requiresClinicianConfirmation).toBe(true);
  });

  it('never assigns the same role to two voices', () => {
    const twoClinicalVoices = [
      seg('Speaker 1', 'Can you lean forward? Seat width is 44 cm.', 0, 5000),
      seg('Speaker 2', 'Could you lift your arm? Seat depth is 42 cm.', 5500, 10000)
    ];
    const roles = Object.values(attributeVoices(twoClinicalVoices).map);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('lets a clinician override the inference', () => {
    const result = attributeVoices(consultation, {
      knownAssignments: { 'Speaker 1': ParticipantRole.CLIENT, 'Speaker 2': ParticipantRole.THERAPIST }
    });
    expect(result.map['Speaker 1']).toBe(ParticipantRole.CLIENT);
    expect(result.map['Speaker 2']).toBe(ParticipantRole.THERAPIST);
  });

  it('flags a single-voice recording as unattributed', () => {
    const result = attributeVoices([seg('Speaker 1', 'Mostly a monologue about the chair.', 0, 5000)]);
    expect(result.speakerCount).toBe(1);
    expect(describeAttribution(result)).toContain('one voice');
  });
});
