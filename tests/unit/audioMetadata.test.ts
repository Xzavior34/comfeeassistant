import { AudioMetadataInspector, AudioMetadata } from '../../src/services/audioMetadata';

describe('AudioMetadataInspector', () => {
  const inspector = new AudioMetadataInspector();

  it('should accept valid 16kHz PCM Mono WAV audio without transcoding requirement', () => {
    const meta: AudioMetadata = {
      format: 'audio/wav',
      sampleRate: 16000,
      channels: 1,
      bitrate: 256000,
      durationMs: 45000,
      fileSizeBytes: 1440000
    };

    const res = inspector.inspectAndValidate(meta);
    expect(res.isValid).toBe(true);
    expect(res.requiresTranscoding).toBe(false);
    expect(res.errors).toHaveLength(0);
  });

  it('should reject empty or corrupted recordings (0 bytes)', () => {
    const meta: AudioMetadata = {
      format: 'audio/wav',
      sampleRate: 16000,
      channels: 1,
      bitrate: 0,
      durationMs: 0,
      fileSizeBytes: 0
    };

    const res = inspector.inspectAndValidate(meta);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('Empty or corrupted recording');
  });

  it('should reject extremely short recordings (<1s)', () => {
    const meta: AudioMetadata = {
      format: 'audio/wav',
      sampleRate: 16000,
      channels: 1,
      bitrate: 256000,
      durationMs: 500,
      fileSizeBytes: 16000
    };

    const res = inspector.inspectAndValidate(meta);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('Extremely short recording');
  });

  it('should reject unsupported audio formats', () => {
    const meta: AudioMetadata = {
      format: 'audio/ogg-unsupported',
      sampleRate: 16000,
      channels: 1,
      bitrate: 128000,
      durationMs: 10000,
      fileSizeBytes: 160000
    };

    const res = inspector.inspectAndValidate(meta);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('Unsupported audio format');
  });

  it('should flag wrong sample rate (44.1kHz) and stereo (2 ch) as requiring transcoding', () => {
    const meta: AudioMetadata = {
      format: 'audio/wav',
      sampleRate: 44100,
      channels: 2,
      bitrate: 1411200,
      durationMs: 30000,
      fileSizeBytes: 5292000
    };

    const res = inspector.inspectAndValidate(meta);
    expect(res.isValid).toBe(true);
    expect(res.requiresTranscoding).toBe(true);
    expect(res.warnings).toHaveLength(2);
  });
});
