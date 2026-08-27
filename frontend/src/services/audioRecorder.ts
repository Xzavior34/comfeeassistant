/**
 * Records consultation audio in the browser alongside live speech recognition.
 *
 * Why both. The W3C SpeechRecognition API gives immediate on-screen text, which the
 * clinician needs to see the session is working, but it returns no speaker information and
 * cannot be biased toward clinical vocabulary. A recording of the same session can be sent
 * to a recogniser that does both, and that transcript — not the live one — becomes the
 * clinical record.
 *
 * So the live text is the monitor and the recording is the source of truth. They are kept
 * clearly separate to avoid the temptation to treat the on-screen text as the record.
 */

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** True when the browser gave us a format a cloud recogniser accepts directly. */
  directlyTranscribable: boolean;
}

export interface RecorderDiagnostics {
  mimeType: string | null;
  sampleRate: number | null;
  channelCount: number | null;
  /** Seconds of audio captured, from the recorder rather than a wall clock. */
  capturedSeconds: number;
  errors: string[];
}

/**
 * Formats a cloud recogniser reads without a server-side transcode, best first.
 * Opus in Ogg is preferred: Google and Azure both decode it, and at 32 kbps mono it keeps
 * a full consultation small enough to upload over a clinic connection.
 */
const PREFERRED_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4'
];

function pickMimeType(): { type: string; directlyTranscribable: boolean } {
  if (typeof MediaRecorder === 'undefined') {
    return { type: '', directlyTranscribable: false };
  }
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) {
      return { type, directlyTranscribable: type.includes('opus') };
    }
  }
  return { type: '', directlyTranscribable: false };
}

export class ConsultationAudioRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private errors: string[] = [];
  private mimeType = '';
  private directlyTranscribable = false;

  static isSupported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  async start(): Promise<void> {
    if (!ConsultationAudioRecorder.isSupported()) {
      throw new Error(
        'This browser cannot record audio, so speaker identification is unavailable for this ' +
          'session. The note will record statements as unattributed.'
      );
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Diarisation degrades when aggressive processing removes the vocal-tract cues that
        // distinguish two speakers, so noise suppression stays modest and gain control is
        // left off: automatic gain equalises two voices at different distances from the
        // microphone, which is exactly the difference the recogniser separates them by.
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 16000
      }
    });

    const picked = pickMimeType();
    this.mimeType = picked.type;
    this.directlyTranscribable = picked.directlyTranscribable;

    this.recorder = new MediaRecorder(
      this.stream,
      picked.type ? { mimeType: picked.type, audioBitsPerSecond: 32000 } : undefined
    );

    this.chunks = [];
    this.errors = [];

    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.onerror = (e: any) => {
      this.errors.push(String(e?.error?.name ?? e?.error ?? 'recorder error'));
    };

    // A timeslice means a crash or a closed laptop loses one second, not the consultation.
    this.recorder.start(1000);
    this.startedAt = Date.now();
  }

  async stop(): Promise<RecordingResult> {
    if (!this.recorder) {
      throw new Error('Recorder was not started.');
    }

    const durationMs = Date.now() - this.startedAt;

    const blob: Blob = await new Promise((resolve) => {
      this.recorder!.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.mimeType || 'audio/webm' }));
      };
      try {
        this.recorder!.stop();
      } catch {
        resolve(new Blob(this.chunks, { type: this.mimeType || 'audio/webm' }));
      }
    });

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    return {
      blob,
      mimeType: this.mimeType || 'audio/webm',
      durationMs,
      directlyTranscribable: this.directlyTranscribable
    };
  }

  getDiagnostics(): RecorderDiagnostics {
    const track = this.stream?.getAudioTracks()[0];
    const settings = track?.getSettings?.();
    return {
      mimeType: this.mimeType || null,
      sampleRate: settings?.sampleRate ?? null,
      channelCount: settings?.channelCount ?? null,
      capturedSeconds: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
      errors: [...this.errors]
    };
  }

  /** Discards captured audio without uploading it. Used when consent is withdrawn. */
  discard(): void {
    this.chunks = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }
}

export const consultationRecorder = new ConsultationAudioRecorder();
