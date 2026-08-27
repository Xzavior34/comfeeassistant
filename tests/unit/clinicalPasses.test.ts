import {
  applyRepairs,
  buildTranscriptRepairPrompt,
  buildCompletenessPrompt,
  measureNoteDepth
} from '../../src/services/clinicalPasses';
import { generateSystemPrompt } from '../../src/services/clinicalPrompt';
import { CanonicalTranscriptSegment } from '../../src/types';
import { ParticipantRole } from '@prisma/client';

const seg = (id: string, text: string): CanonicalTranscriptSegment =>
  ({
    id,
    meetingId: 'm-1',
    startTimeMs: 0,
    endTimeMs: 5000,
    speakerId: 'Speaker 1',
    mappedRole: ParticipantRole.THERAPIST,
    text,
    confidence: 0.9,
    overlapStatus: 'CLEAR',
    sourceProvider: 'Test',
    sourceSegmentId: 'raw-1'
  }) as CanonicalTranscriptSegment;

describe('Transcript repair pass', () => {
  it('applies a high-confidence lexical correction', () => {
    const segments = [seg('seg-1', 'Observed public ability on the left side.')];
    const { segments: out, applied } = applyRepairs(segments, [
      {
        segmentId: 'seg-1',
        corrected: 'Observed pelvic obliquity on the left side.',
        reason: 'clinical homophone',
        confidence: 'HIGH'
      }
    ]);
    expect(out[0].text).toContain('pelvic obliquity');
    expect(applied).toHaveLength(1);
  });

  it('refuses a correction that would change a negation', () => {
    const segments = [seg('seg-1', 'There is no pressure area over the sacrum.')];
    const { segments: out, refused } = applyRepairs(segments, [
      {
        segmentId: 'seg-1',
        corrected: 'There is a pressure area over the sacrum.',
        reason: 'sounded like',
        confidence: 'HIGH'
      }
    ]);
    expect(out[0].text).toContain('no pressure area');
    expect(refused[0].reason).toContain('negation');
  });

  it('refuses a correction that would change a measurement', () => {
    const segments = [seg('seg-1', 'Seat width measured at 44 cm.')];
    const { segments: out, refused } = applyRepairs(segments, [
      { segmentId: 'seg-1', corrected: 'Seat width measured at 46 cm.', reason: 'x', confidence: 'HIGH' }
    ]);
    expect(out[0].text).toContain('44 cm');
    expect(refused).toHaveLength(1);
  });

  it('refuses a correction that would flip laterality', () => {
    const segments = [seg('seg-1', 'Obliquity on the left.')];
    const { segments: out, refused } = applyRepairs(segments, [
      { segmentId: 'seg-1', corrected: 'Obliquity on the right.', reason: 'x', confidence: 'HIGH' }
    ]);
    expect(out[0].text).toContain('left');
    expect(refused).toHaveLength(1);
  });

  it('refuses anything below HIGH confidence', () => {
    const segments = [seg('seg-1', 'Something indistinct here.')];
    const { segments: out, refused } = applyRepairs(segments, [
      { segmentId: 'seg-1', corrected: 'Sacral tissue viability here.', reason: 'guess', confidence: 'MEDIUM' }
    ]);
    expect(out[0].text).toBe('Something indistinct here.');
    expect(refused).toHaveLength(1);
  });

  it('refuses a wholesale rewrite', () => {
    const segments = [seg('seg-1', 'Short note.')];
    const { refused } = applyRepairs(segments, [
      {
        segmentId: 'seg-1',
        corrected: 'A very much longer invented clinical narrative about pelvic obliquity and seating.',
        reason: 'expansion',
        confidence: 'HIGH'
      }
    ]);
    expect(refused[0].reason).toContain('length change');
  });

  it('instructs the model not to touch numbers, negations or sides', () => {
    const prompt = buildTranscriptRepairPrompt([seg('seg-1', 'test')]);
    expect(prompt).toContain('WHAT YOU MUST NOT CHANGE');
    expect(prompt).toContain('negation');
    expect(prompt).toContain('lexical, never semantic');
  });
});

describe('Specialist depth', () => {
  it('the prompt demands a clinical record, not a summary', () => {
    const prompt = generateSystemPrompt();
    expect(prompt).toContain('not summarising a conversation');
    expect(prompt).toContain('FLEXIBLE (correctable) or FIXED');
    expect(prompt).toContain('SPECIALIST DEPTH');
    // Depth must never become licence to invent.
    expect(prompt).toContain('WHERE DEPTH IS NOT ALLOWED');
  });

  it('the completeness pass targets the sections that drive a prescription', () => {
    const prompt = buildCompletenessPrompt({}, [seg('seg-1', 'test')]);
    expect(prompt).toContain('seatingPosturalAssessment');
    expect(prompt).toContain('clinicalReasoning');
    expect(prompt).toContain('only add detail that is present in the transcript');
  });

  it('measures note depth so the effect of the passes is observable', () => {
    const thin = measureNoteDepth({
      a: [{ value: 'Not documented during this session.', evidence: [] }],
      b: [{ value: 'Pelvic obliquity noted.', evidence: [] }]
    });
    const deep = measureNoteDepth({
      a: [{ value: 'Not documented during this session.', evidence: [] }],
      b: [
        {
          value:
            'Left pelvic obliquity of approximately 15 degrees observed in unsupported sitting, ' +
            'partially correctable on manual facilitation and therefore assessed as flexible.',
          evidence: []
        }
      ]
    });
    expect(deep.totalWords).toBeGreaterThan(thin.totalWords);
    expect(thin.emptyFields).toBe(1);
    expect(thin.populatedFields).toBe(1);
  });
});
