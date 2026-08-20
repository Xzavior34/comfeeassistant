export interface AudioMetadata {
  format: string; // e.g. 'audio/wav', 'audio/mp3', 'audio/aac'
  sampleRate: number; // e.g. 16000, 44100, 48000
  channels: number; // e.g. 1 (mono), 2 (stereo)
  bitrate: number;
  durationMs: number;
  fileSizeBytes: number;
}

export interface AudioValidationResult {
  isValid: boolean;
  requiresTranscoding: boolean;
  targetSampleRate: number;
  targetChannels: number;
  errors: string[];
  warnings: string[];
  inspectedMetadata: AudioMetadata;
}

export class AudioMetadataInspector {
  inspectAndValidate(metadata: AudioMetadata): AudioValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let requiresTranscoding = false;

    // 1. File size / corruption check
    if (metadata.fileSizeBytes <= 0 || metadata.durationMs <= 0) {
      errors.push('Empty or corrupted recording: file size or duration is 0.');
    }

    // 2. Extremely short recording (< 1 second)
    if (metadata.durationMs > 0 && metadata.durationMs < 1000) {
      errors.push('Extremely short recording (< 1000ms). Insufficient audio for speech recognition.');
    }

    // 3. Format inspection
    const supportedFormats = ['audio/wav', 'audio/x-wav', 'audio/pcm', 'audio/mp3', 'audio/m4a'];
    if (!supportedFormats.includes(metadata.format.toLowerCase())) {
      errors.push(`Unsupported audio format: ${metadata.format}. Supported formats: ${supportedFormats.join(', ')}`);
    }

    // 4. Sample rate inspection
    if (metadata.sampleRate !== 16000) {
      requiresTranscoding = true;
      warnings.push(`Sample rate is ${metadata.sampleRate} Hz (Target: 16000 Hz). Transcoding step required.`);
    }

    // 5. Channels inspection
    if (metadata.channels > 1) {
      requiresTranscoding = true;
      warnings.push(`Audio has ${metadata.channels} channels (Target: 1 mono channel). Downmixing required.`);
    }

    // 6. Long recording warning (> 2 hours)
    if (metadata.durationMs > 7200000) {
      warnings.push('Long recording (> 2 hours). Async batch speech processing required.');
    }

    return {
      isValid: errors.length === 0,
      requiresTranscoding,
      targetSampleRate: 16000,
      targetChannels: 1,
      errors,
      warnings,
      inspectedMetadata: metadata
    };
  }

  simulateTranscode(metadata: AudioMetadata): AudioMetadata {
    return {
      format: 'audio/wav',
      sampleRate: 16000,
      channels: 1,
      bitrate: 256000,
      durationMs: metadata.durationMs,
      fileSizeBytes: Math.floor((metadata.durationMs / 1000) * 32000)
    };
  }
}
