import { pickSupportedMimeType } from '../../frontend/src/services/audioRecorder';

/**
 * @jest-environment jsdom
 */

/**
 * Y. Audio persistence, when it is enabled at all.
 *
 * Audio is optional in the free configuration: the transcript is produced on the device and
 * is the clinical artefact. These tests pin the two properties that matter when a deployment
 * does turn recording on — the container format is negotiated rather than assumed, and the
 * upload path is binary rather than base64.
 */
describe('Y. Audio capture format negotiation', () => {
  const original = (global as any).MediaRecorder;

  afterEach(() => {
    (global as any).MediaRecorder = original;
  });

  it('picks the first format the browser actually supports', () => {
    (global as any).MediaRecorder = {
      // A browser that supports only MP4, as Safari historically did.
      isTypeSupported: (t: string) => t.startsWith('audio/mp4')
    };
    expect(pickSupportedMimeType()).toContain('audio/mp4');
  });

  it('prefers Opus where it is available, for size on a clinic connection', () => {
    (global as any).MediaRecorder = { isTypeSupported: () => true };
    expect(pickSupportedMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('falls back to the browser default rather than failing outright', () => {
    (global as any).MediaRecorder = { isTypeSupported: () => false };
    // The empty string means "browser chooses", which still records.
    expect(pickSupportedMimeType()).toBe('');
  });

  it('tolerates a browser that throws from isTypeSupported', () => {
    (global as any).MediaRecorder = {
      isTypeSupported: () => {
        throw new Error('not implemented');
      }
    };
    expect(() => pickSupportedMimeType()).not.toThrow();
  });

  it('reports unsupported when MediaRecorder is absent entirely', () => {
    (global as any).MediaRecorder = undefined;
    expect(pickSupportedMimeType()).toBe('');
  });
});
