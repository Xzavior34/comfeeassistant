import { ProviderTranscript, CanonicalTranscriptSegment } from '../types';
import { ParticipantRole, OverlapStatus } from '@prisma/client';

export function normalizeToCanonicalTranscript(
  meetingId: string,
  rawTranscript: ProviderTranscript,
  roleMap: Record<string, ParticipantRole> = { 'Speaker 1': ParticipantRole.THERAPIST, 'Speaker 2': ParticipantRole.CLIENT }
): CanonicalTranscriptSegment[] {
  return rawTranscript.segments.map((seg, idx) => {
    // Check for temporal overlap with neighboring segments
    const prevSeg = rawTranscript.segments[idx - 1];
    const nextSeg = rawTranscript.segments[idx + 1];

    let overlapStatus: OverlapStatus = OverlapStatus.CLEAR;
    if (prevSeg && seg.startTimeMs < prevSeg.endTimeMs) {
      overlapStatus = OverlapStatus.SUSPECTED;
    }
    if (nextSeg && seg.endTimeMs > nextSeg.startTimeMs) {
      overlapStatus = OverlapStatus.SUSPECTED;
    }

    const mappedRole = roleMap[seg.speakerId] || null;

    // Calculate speaking rate (words per second)
    const wordCount = seg.text.trim().split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.max(0.5, (seg.endTimeMs - seg.startTimeMs) / 1000);
    const speakingRateWps = parseFloat((wordCount / durationSeconds).toFixed(2));

    const rapidSpeechDetected = speakingRateWps > 4.0 || (seg.confidence !== null && seg.confidence < 0.75);

    let textContent = seg.text;
    if (overlapStatus === OverlapStatus.SUSPECTED && (seg.confidence === null || seg.confidence < 0.6)) {
      textContent += ' [Overlapping speech / transcription uncertainty]';
    }

    return {
      id: `seg-${idx + 1}`,
      meetingId,
      startTimeMs: seg.startTimeMs,
      endTimeMs: seg.endTimeMs,
      speakerId: seg.speakerId,
      mappedRole,
      text: textContent,
      confidence: seg.confidence,
      overlapStatus,
      sourceProvider: rawTranscript.providerName,
      sourceSegmentId: `raw-${idx + 1}`,
      rapidSpeechDetected,
      speakingRateWps
    };
  });
}
