import { CanonicalTranscriptSegment } from '../types';
import { ParticipantRole, OverlapStatus } from '@prisma/client';

export interface VTTParseResult {
  isValid: boolean;
  segments: CanonicalTranscriptSegment[];
  errors: string[];
  warnings: string[];
}

export class VTTParserService {
  parseVTT(vttContent: string, meetingId: string): VTTParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const segments: CanonicalTranscriptSegment[] = [];

    if (!vttContent || !vttContent.trim()) {
      return { isValid: false, segments: [], errors: ['Empty VTT file content.'], warnings: [] };
    }

    const lines = vttContent.split(/\r?\n/).map((l) => l.trim());

    if (!lines[0].toUpperCase().startsWith('WEBVTT')) {
      return { isValid: false, segments: [], errors: ['Unsupported format: Missing WEBVTT header.'], warnings: [] };
    }

    let currentTimestampMatch: { startMs: number; endMs: number } | null = null;
    let currentSpeaker = 'Speaker 1';
    let cueIndex = 1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Match VTT timestamp line e.g. 00:00:01.000 --> 00:00:04.500
      const tsMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);

      if (tsMatch) {
        currentTimestampMatch = {
          startMs: this.parseTimeToMs(tsMatch[1]),
          endMs: this.parseTimeToMs(tsMatch[2])
        };
        continue;
      }

      // Cue text line containing speaker tag e.g. <v Speaker 1> Text... or <v Dr. Sarah Jenkins> Text...
      if (line && !line.match(/^\d+$/) && currentTimestampMatch) {
        let text = line;
        const speakerMatch = line.match(/<v\s+([^>]+)>(.*)/i);

        if (speakerMatch) {
          currentSpeaker = speakerMatch[1].trim();
          text = speakerMatch[2].replace(/<\/v>/gi, '').trim();
        } else if (line.includes(':')) {
          const parts = line.split(':');
          currentSpeaker = parts[0].trim();
          text = parts.slice(1).join(':').trim();
        }

        // Duplicate segment check
        const isDuplicate = segments.some(
          (s) => s.startTimeMs === currentTimestampMatch!.startMs && s.text === text
        );

        if (isDuplicate) {
          warnings.push(`Duplicate cue detected at ${currentTimestampMatch.startMs}ms: "${text}"`);
        } else {
          segments.push({
            id: `vtt-seg-${cueIndex++}`,
            meetingId,
            startTimeMs: currentTimestampMatch.startMs,
            endTimeMs: currentTimestampMatch.endMs,
            speakerId: currentSpeaker,
            mappedRole: currentSpeaker.toLowerCase().includes('therapist') ? ParticipantRole.THERAPIST : ParticipantRole.CLIENT,
            text,
            confidence: 1.0,
            overlapStatus: OverlapStatus.CLEAR,
            sourceProvider: 'VTTImportProvider',
            sourceSegmentId: `cue-${cueIndex}`
          });
        }

        currentTimestampMatch = null;
      }
    }

    if (segments.length === 0) {
      errors.push('No valid timestamped dialogue cues parsed from VTT file.');
    }

    return {
      isValid: errors.length === 0,
      segments,
      errors,
      warnings
    };
  }

  private parseTimeToMs(timeStr: string): number {
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0], 10);
    const ms = parseInt(secondsParts[1], 10);

    return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
  }
}
