/**
 * Consultation audio capture.
 *
 * Independent of speech recognition by design. Recognition is a browser feature that stops
 * and restarts on its own; the recording is the thing that must not be lost. A recognition
 * failure never touches the recorder, and the recorder never depends on recognition working.
 *
 * Audio capture is OPTIONAL in the free configuration. The transcript comes from on-device
 * recognition, so a browser that cannot record still supports a complete assessment. Where
 * recording is available it gives the clinician a fallback they can listen back to.
 */

export type RecordingState =
  | 'IDLE'
  | 'REQUESTING_PERMISSION'
  | 'READY'
  | 'RECORDING'
  | 'PAUSED'
  | 'STOPPING'
  | 'RECORDED'
  | 'FAILED';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  bytes: number;
}

export interface RecorderDiagnostics {
  state: RecordingState;
  mimeType: string | null;
  bytesCaptured: number;
  interruptions: number;
  errors: string[];
}

/**
 * Candidate container formats, best first.
 *
 * Never hard-coded: Android Chrome, desktop Chrome, Firefox and Safari each support a
 * different subset, and assuming one produces a recorder that silently fails to start on
 * half the devices this will actually be used on.
 */
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
  ''
];

export function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of CANDIDATE_TYPES) {
    // The empty string means "let the browser choose", which is a valid last resort.
    if (type === '') return '';
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // Some implementations throw on unusual inputs rather than returning false.
    }
  }
  return '';
}

type StateListener = (state: RecordingState, detail?: string) => void;

export class ConsultationRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private state: RecordingState = 'IDLE';
  private startedAt = 0;
  private accumulatedMs = 0;
  private interruptions = 0;
  private errors: string[] = [];
  private listener: StateListener | null = null;

  static isSupported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }

  onStateChange(listener: StateListener): void {
    this.listener = listener;
  }

  getState(): RecordingState {
    return this.state;
  }

  private setState(state: RecordingState, detail?: string): void {
    this.state = state;
    this.listener?.(state, detail);
  }

  /**
   * Requests the microphone and prepares the recorder.
   *
   * Microphone permission is a browser capability, not clinical consent. Consent is recorded
   * separately before this is ever called, and being granted the microphone never implies it.
   */
  async prepare(): Promise<boolean> {
    if (!ConsultationRecorder.isSupported()) {
      this.errors.push('MediaRecorder unavailable');
      this.setState('FAILED', 'Audio recording is not supported in this browser.');
      return false;
    }

    this.setState('REQUESTING_PERMISSION');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Requested, not assumed: browsers differ in which of these they honour, and an
        // unsupported constraint is ignored rather than failing the request.
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
    } catch (err: any) {
      const name = err?.name ?? 'UnknownError';
      this.errors.push(name);
      this.setState(
        'FAILED',
        name === 'NotAllowedError'
          ? 'Microphone access was denied.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device.'
            : `Microphone unavailable (${name}).`
      );
      return false;
    }

    this.mimeType = pickSupportedMimeType();
    this.setState('READY');
    return true;
  }

  start(): boolean {
    if (!this.stream) {
      this.setState('FAILED', 'Recorder was not prepared.');
      return false;
    }

    try {
      this.recorder = new MediaRecorder(
        this.stream,
        this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 32000 } : undefined
      );
    } catch (err: any) {
      this.errors.push(String(err?.name ?? err));
      this.setState('FAILED', 'The browser refused to start recording in any supported format.');
      return false;
    }

    this.chunks = [];
    this.accumulatedMs = 0;

    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.onerror = (e: any) => {
      this.errors.push(String(e?.error?.name ?? 'recorder error'));
      // Data captured so far is retained; a mid-session error must not discard it.
      this.setState('FAILED', 'Audio recording stopped unexpectedly. The transcript is unaffected.');
    };

    // A one-second timeslice means an interruption costs at most a second of audio, rather
    // than the whole consultation sitting unflushed in the recorder.
    this.recorder.start(1000);
    this.startedAt = Date.now();
    this.setState('RECORDING');
    return true;
  }

  pause(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause();
      this.accumulatedMs += Date.now() - this.startedAt;
      this.setState('PAUSED');
    }
  }

  resume(): void {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume();
      this.startedAt = Date.now();
      this.setState('RECORDING');
    }
  }

  /** Records that the tab was backgrounded or the device locked, for the diagnostics report. */
  noteInterruption(): void {
    this.interruptions++;
  }

  /**
   * Stops and assembles the recording.
   *
   * Waits for the final `dataavailable` event before assembling. Resolving early is how a
   * recording loses its last seconds — or, if `stop()` never fires `onstop` because the
   * recorder is already dead, hangs forever; hence the timeout fallback.
   */
  async stop(): Promise<RecordingResult | null> {
    if (!this.recorder) return null;
    this.setState('STOPPING');

    const durationMs = this.accumulatedMs + (this.recorder.state === 'recording' ? Date.now() - this.startedAt : 0);

    const blob = await new Promise<Blob>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(new Blob(this.chunks, { type: this.mimeType || 'audio/webm' }));
      };

      this.recorder!.onstop = finish;
      // Never hang the End Assessment flow on a recorder that will not emit onstop.
      setTimeout(finish, 4000);

      try {
        if (this.recorder!.state !== 'inactive') this.recorder!.stop();
        else finish();
      } catch {
        finish();
      }
    });

    this.releaseStream();
    this.setState('RECORDED');

    // A zero-byte recording is reported as absent rather than uploaded as an empty file.
    if (blob.size === 0) {
      this.errors.push('empty recording');
      return null;
    }

    return { blob, mimeType: this.mimeType || 'audio/webm', durationMs, bytes: blob.size };
  }

  /** Abandons the recording without keeping the audio, e.g. when consent is withdrawn. */
  discard(): void {
    this.chunks = [];
    this.releaseStream();
    this.recorder = null;
    this.setState('IDLE');
  }

  private releaseStream(): void {
    // Releasing the tracks is what turns the browser's recording indicator off. Leaving them
    // open looks, correctly, like the microphone is still live.
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  getDiagnostics(): RecorderDiagnostics {
    return {
      state: this.state,
      mimeType: this.mimeType || null,
      bytesCaptured: this.chunks.reduce((n, c) => n + c.size, 0),
      interruptions: this.interruptions,
      errors: [...this.errors]
    };
  }
}

export const consultationRecorder = new ConsultationRecorder();
