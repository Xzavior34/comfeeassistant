import { AIExtractionService, routeSegments, splitSentences } from '../../src/services/aiExtraction';
import { buildSections } from '../../src/services/documentGenerator';
import { resolveParticipantRole, normalizeToCanonicalTranscript } from '../../src/services/canonicalTranscript';
import { mergeModelNote, groundClaims } from '../../src/providers/llm/GeminiLLMProvider';
import { CanonicalTranscriptSegment, ProviderTranscript } from '../../src/types';
import { ParticipantRole } from '@prisma/client';

const seg = (over: Partial<CanonicalTranscriptSegment>): CanonicalTranscriptSegment =>
  ({
    id: 'seg-1',
    meetingId: 'm-1',
    startTimeMs: 0,
    endTimeMs: 5000,
    speakerId: 'Speaker 1',
    mappedRole: ParticipantRole.THERAPIST,
    text: 'placeholder',
    confidence: 0.95,
    overlapStatus: 'CLEAR',
    sourceProvider: 'Test',
    sourceSegmentId: 'raw-1',
    ...over
  } as CanonicalTranscriptSegment);

describe('Speaker attribution', () => {
  it('resolves labels the engine actually emits, not only exact map keys', () => {
    const map = { 'Speaker 1': ParticipantRole.THERAPIST, 'Speaker 2': ParticipantRole.CLIENT };
    // The frontend emits decorated labels; the old exact lookup returned null for all of
    // these, which silently emptied every role-filtered section of the note.
    expect(resolveParticipantRole('Speaker 1 (Therapist)', map)).toBe(ParticipantRole.THERAPIST);
    expect(resolveParticipantRole('spk_2', map)).toBe(ParticipantRole.CLIENT);
    expect(resolveParticipantRole('Carer', map)).toBe(ParticipantRole.CARER);
  });

  it('returns null rather than guessing when the label carries no signal', () => {
    const map = { 'Speaker 1': ParticipantRole.THERAPIST };
    expect(resolveParticipantRole('UNKNOWN', map)).toBeNull();
    expect(resolveParticipantRole(undefined, map)).toBeNull();
    expect(resolveParticipantRole('', map)).toBeNull();
  });
});

describe('Section routing', () => {
  it('splits a dictated paragraph so each sentence reaches its own section', () => {
    const text =
      'MAT examination confirms a 15 degree posterior pelvic tilt. ' +
      'We recommend a high-specification foam cushion.';
    expect(splitSentences(text)).toHaveLength(2);

    const routed = routeSegments([seg({ text })]);
    const sections = routed.map((r) => r.section);
    expect(sections).toContain('pelvicPositioning');
    expect(sections).toContain('recommendationsAndActions');
  });

  it('assigns each sentence to exactly one section', () => {
    const routed = routeSegments([
      seg({ text: 'The cushion is a high-specification foam cushion.' })
    ]);
    expect(routed).toHaveLength(1);
  });

  it('prefers the clinical decision over the topic it mentions', () => {
    const routed = routeSegments([seg({ text: 'I recommend a new cushion.' })]);
    expect(routed[0].section).toBe('recommendationsAndActions');
  });

  it('surfaces unclassifiable low-confidence speech instead of discarding it', () => {
    const routed = routeSegments([
      seg({ text: 'Client reported garbled speech during discussion.', confidence: 0.4 })
    ]);
    expect(routed[0].section).toBe('unclassifiedUncertain');
    expect(routed[0].claim.value).toContain('[Unclear Speech]');
    expect(routed[0].claim.sourceClassification).toBe('UNCERTAIN');
  });

  it('treats a missing confidence score as unknown, never as good', () => {
    const routed = routeSegments([
      seg({ text: 'Pelvic obliquity noted on the left.', confidence: null as any })
    ]);
    expect(routed[0].claim.confidence).toBe('LOW');
    expect(routed[0].claim.uncertaintyReason).toContain('no confidence score');
  });
});

describe('Document output', () => {
  const buildNote = async () => {
    const raw: ProviderTranscript = {
      providerName: 'Test',
      durationMs: 20000,
      segments: [
        {
          speakerId: 'Speaker 2',
          startTimeMs: 0,
          endTimeMs: 6000,
          text: 'I get a lot of pain in my sacrum after two hours in the chair.',
          confidence: 0.93
        },
        {
          speakerId: 'Speaker 1',
          startTimeMs: 6500,
          endTimeMs: 14000,
          text: 'MAT assessment shows a 15 degree posterior pelvic tilt. I recommend a pressure redistributing foam cushion.',
          confidence: 0.95
        }
      ]
    };
    const canonical = normalizeToCanonicalTranscript('m-doc', raw);
    return new AIExtractionService().extractStructuredClinicalNote(canonical);
  };

  it('never prints the same statement under more than one heading', async () => {
    const sections = buildSections(await buildNote());
    const values = sections.flatMap((s) => s.claims.map((c) => c.value.trim().toLowerCase()));
    expect(new Set(values).size).toBe(values.length);
  });

  it('does not leak internal provenance tags into the clinician-facing note', async () => {
    const sections = buildSections(await buildNote());
    const text = sections.flatMap((s) => s.claims.map((c) => c.value)).join(' ');
    expect(text).not.toContain('[PATIENT_REPORTED]');
    expect(text).not.toContain('[CLINICIAN_OBSERVED]');
  });

  it('covers every section of the clinical documentation template', async () => {
    const titles = buildSections(await buildNote()).map((s) => s.title);
    for (const expected of [
      'Reason for Referral',
      "Person's Goals",
      'Skin Integrity and Pressure Management',
      'Home, Community and Transport Environment',
      'Wheelchair Trial, Selection and Justification',
      'Agreement, Reservations and Sign-off',
      'Outstanding Concerns'
    ]) {
      expect(titles.some((t) => t.includes(expected))).toBe(true);
    }
  });
});

describe('Model output handling', () => {
  const segments = [seg({ id: 'seg-1', text: 'Pelvic obliquity noted on the left.' })];
  const segmentMap = new Map(segments.map((s) => [s.id, s]));

  it('keeps the skeleton when the model returns malformed entries', () => {
    const skeleton = { clinicalReasoning: [{ value: 'Not documented during this session.', evidence: [] }] };
    const merged = mergeModelNote(skeleton, { clinicalReasoning: ['just a string', 42] });
    expect(merged.clinicalReasoning[0].value).toContain('Not documented');
  });

  it('accepts well-formed model claims', () => {
    const skeleton = { clinicalReasoning: [{ value: 'Not documented during this session.', evidence: [] }] };
    const merged = mergeModelNote(skeleton, {
      clinicalReasoning: [{ value: 'Pelvic instability is the primary problem.', evidence: [] }]
    });
    expect(merged.clinicalReasoning[0].value).toContain('Pelvic instability');
  });

  it('drops model claims that cite a segment that does not exist', () => {
    const dropped: string[] = [];
    const result = groundClaims(
      {
        clinicalReasoning: [
          { value: 'Invented finding.', evidence: [{ segmentId: 'seg-999' }] },
          { value: 'Real finding.', evidence: [{ segmentId: 'seg-1' }] }
        ]
      },
      segmentMap,
      dropped
    );
    expect(dropped).toContain('Invented finding.');
    expect(result.clinicalReasoning).toHaveLength(1);
    expect(result.clinicalReasoning[0].value).toBe('Real finding.');
  });

  it('re-anchors evidence to the authoritative segment text and timing', () => {
    const dropped: string[] = [];
    const result = groundClaims(
      {
        objectiveFindings: [
          {
            value: 'Left pelvic obliquity.',
            evidence: [{ segmentId: 'seg-1', startTimeMs: 999999, endTimeMs: 0, sourceText: 'paraphrased' }]
          }
        ]
      },
      segmentMap,
      dropped
    );
    const ev = result.objectiveFindings[0].evidence[0];
    expect(ev.startTimeMs).toBe(0);
    expect(ev.endTimeMs).toBe(5000);
    expect(ev.sourceText).toBe('Pelvic obliquity noted on the left.');
  });
});
