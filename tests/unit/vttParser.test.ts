import { VTTParserService } from '../../src/services/vttParser';

describe('VTTParserService Integration & Edge-Case Validation', () => {
  const parser = new VTTParserService();

  it('should parse valid multi-speaker WebVTT content with timestamps', () => {
    const validVTT = `WEBVTT

00:00:01.000 --> 00:00:04.500
<v Dr. Sarah Jenkins (Therapist)> Good morning. Today we conduct your seating assessment.

00:00:05.000 --> 00:00:09.200
<v John Doe (Client)> My main complaint is sacral pressure pain after sitting.`;

    const res = parser.parseVTT(validVTT, 'meeting-online-101');
    expect(res.isValid).toBe(true);
    expect(res.segments).toHaveLength(2);
    expect(res.segments[0].speakerId).toContain('Sarah Jenkins');
    expect(res.segments[1].mappedRole).toBe('CLIENT');
  });

  it('should reject malformed VTT content missing WEBVTT header', () => {
    const malformedVTT = `NOT_A_VTT_FILE
00:00:01.000 --> 00:00:04.500
Some dialogue text here.`;

    const res = parser.parseVTT(malformedVTT, 'm-1');
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('Missing WEBVTT header');
  });

  it('should flag duplicate cues as warnings while preserving unique segments', () => {
    const duplicateVTT = `WEBVTT

00:00:01.000 --> 00:00:04.500
Speaker 1: Hello.

00:00:01.000 --> 00:00:04.500
Speaker 1: Hello.`;

    const res = parser.parseVTT(duplicateVTT, 'm-1');
    expect(res.isValid).toBe(true);
    expect(res.segments).toHaveLength(1);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});
