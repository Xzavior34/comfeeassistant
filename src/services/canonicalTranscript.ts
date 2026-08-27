import { ProviderTranscript, CanonicalTranscriptSegment } from '../types';
import { ParticipantRole, OverlapStatus } from '@prisma/client';
import { attributeVoices, AttributionResult, AttributionOptions } from './voiceRoleAttribution';

/**
 * Normalises a raw speaker label to a participant role.
 *
 * Engine labels are inconsistent ("Speaker 1", "Speaker 1 (Therapist)", "spk_0", "1"),
 * and the previous exact-key lookup silently returned null for every real device-speech
 * segment — which in turn emptied every role-filtered section of the clinical note.
 * Matching is therefore tolerant, but never guesses: an unrecognised label maps to null
 * so attribution is reported as unknown rather than invented.
 */
export function resolveParticipantRole(
  speakerId: string | null | undefined,
  roleMap: Record<string, ParticipantRole>
): ParticipantRole | null {
  if (!speakerId) return null;

  const raw = String(speakerId).trim();
  if (!raw || raw.toUpperCase() === 'UNKNOWN') return null;

  if (roleMap[raw]) return roleMap[raw];

  const lower = raw.toLowerCase();

  if (/\b(therapist|clinician|physiotherapist|assessor)\b/.test(lower)) return ParticipantRole.THERAPIST;
  if (/\b(client|patient|service user)\b/.test(lower)) return ParticipantRole.CLIENT;
  if (/\b(carer|relative|family|advocate)\b/.test(lower)) return ParticipantRole.CARER;
  if (/\binterpreter\b/.test(lower)) return ParticipantRole.INTERPRETER;

  for (const [key, role] of Object.entries(roleMap)) {
    const k = key.toLowerCase();
    if (lower === k || lower.startsWith(k + ' ') || lower.startsWith(k + '(')) return role;
  }

  const num = lower.match(/(\d+)/);
  if (num) {
    const normalised = `speaker ${num[1]}`;
    for (const [key, role] of Object.entries(roleMap)) {
      if (key.toLowerCase() === normalised) return role;
    }
  }

  return null;
}

/**
 * Normalises a diarised transcript, inferring which voice is which from the conversation
 * itself rather than from a fixed speaker-number convention.
 *
 * Returns the attribution result alongside the segments so the caller can tell the
 * clinician what was inferred and how confident it is.
 */
export function normalizeWithVoiceAttribution(
  meetingId: string,
  rawTranscript: ProviderTranscript,
  options: AttributionOptions = {}
): { segments: CanonicalTranscriptSegment[]; attribution: AttributionResult } {
  const attribution = attributeVoices(rawTranscript.segments, options);
  const segments = normalizeToCanonicalTranscript(meetingId, rawTranscript, attribution.map);
  return { segments, attribution };
}

export function normalizeToCanonicalTranscript(
  meetingId: string,
  rawTranscript: ProviderTranscript,
  roleMap: Record<string, ParticipantRole> = {}
): CanonicalTranscriptSegment[] {
  return rawTranscript.segments.map((seg, idx) => {
    const prevSeg = rawTranscript.segments[idx - 1];
    const nextSeg = rawTranscript.segments[idx + 1];

    let overlapStatus: OverlapStatus = OverlapStatus.CLEAR;
    if (prevSeg && seg.startTimeMs < prevSeg.endTimeMs) overlapStatus = OverlapStatus.SUSPECTED;
    if (nextSeg && seg.endTimeMs > nextSeg.startTimeMs) overlapStatus = OverlapStatus.SUSPECTED;

    const mappedRole = resolveParticipantRole(seg.speakerId, roleMap);

    const wordCount = seg.text.trim().split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.max(0.5, (seg.endTimeMs - seg.startTimeMs) / 1000);
    const speakingRateWps = parseFloat((wordCount / durationSeconds).toFixed(2));

    // A null confidence means the engine reported none. That is an unknown, not a pass:
    // it becomes a reason for clinician review rather than a silent assumption of accuracy.
    const confidenceUnknown = seg.confidence === null || seg.confidence === undefined;
    const rapidSpeechDetected =
      speakingRateWps > 4.0 || (!confidenceUnknown && (seg.confidence as number) < 0.75);

    let textContent = seg.text;
    if (
      overlapStatus === OverlapStatus.SUSPECTED &&
      (confidenceUnknown || (seg.confidence as number) < 0.6)
    ) {
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
      confidence: confidenceUnknown ? null : seg.confidence,
      overlapStatus,
      sourceProvider: rawTranscript.providerName,
      sourceSegmentId: `raw-${idx + 1}`,
      rapidSpeechDetected,
      speakingRateWps
    };
  });
}
