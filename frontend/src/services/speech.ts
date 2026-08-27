/**
 * Live device transcription.
 *
 * Two design rules, both learned from defects:
 *
 * 1. NO SPEAKER LABELS. The W3C SpeechRecognition API performs no diarisation whatsoever. It
 *    returns words with no indication of who produced them. Any label this layer emitted
 *    would be invented — the previous version alternated "Speaker 1 (Therapist)" and
 *    "Speaker 2 (Client)" on utterance parity, so two consecutive patient sentences were
 *    recorded as one patient statement and one clinician statement. There is no speaker
 *    field on the transcript at all now, so nothing downstream can start guessing again.
 *
 * 2. INTERIM RESULTS ARE UI, NOT TRANSCRIPT. The recogniser emits a growing interim
 *    hypothesis — "I believe", "I believe the", "I believe the chair" — before it commits.
 *    Appending those produces three fragments where the clinician said one sentence. Interim
 *    text is held separately and replaced; only final results are appended, once each.
 *
 * This class is also strictly independent of audio recording. Recognition stopping must
 * never stop the recorder, and vice versa.
 */

declare const window: any;

export interface TranscriptEntry {
  /** Committed text. No speaker attribution: the browser does not know and does not guess. */
  text: string;
  /** Milliseconds from session start, for ordering and for the clinician's own reference. */
  atMs: number;
  /** Engine confidence in [0,1], or null when it reported none. Null means unknown, not good. */
  confidence: number | null;
}

export interface LiveTranscriptState {
  /** Everything committed so far. */
  finalEntries: TranscriptEntry[];
  /** The current uncommitted hypothesis. Displayed, never stored. */
  interimText: string;
}

export interface DiagnosticState {
  recognition_available: boolean;
  recognition_created: boolean;
  recognition_start_requested: boolean;
  recognition_started: boolean;
  audio_start: boolean;
  sound_start: boolean;
  speech_start: boolean;
  result_received: boolean;
  speech_end: boolean;
  sound_end: boolean;
  audio_end: boolean;
  recognition_end: boolean;
  recognition_error: string | null;
}

export interface RecognitionDiagnostics {
  supported: boolean;
  constructorName: 'SpeechRecognition' | 'webkitSpeechRecognition' | 'neither';
  producedAnyText: boolean;
  restartCount: number;
  fatalError: string | null;
  confidenceUnavailable: boolean;
  localProcessing: boolean;
  diagnostics: DiagnosticState;
}

/** Errors after which restarting is pointless or harmful. */
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'language-not-supported',
  'audio-capture',
  'bad-grammar'
]);

function getWindow(): any {
  if (typeof globalThis !== 'undefined' && (globalThis as any).window) return (globalThis as any).window;
  if (typeof window !== 'undefined') return window;
  return null;
}

function getRecognitionConstructor(): any {
  const win = getWindow();
  if (!win) return null;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function getConstructorName(): 'SpeechRecognition' | 'webkitSpeechRecognition' | 'neither' {
  const win = getWindow();
  if (!win) return 'neither';
  if (win.SpeechRecognition) return 'SpeechRecognition';
  if (win.webkitSpeechRecognition) return 'webkitSpeechRecognition';
  return 'neither';
}

export class LiveTranscriptionService {
  private recognition: any = null;
  private listening = false;
  private intentionalStop = false;
  private sessionStartMs = 0;

  private finalEntries: TranscriptEntry[] = [];
  private interimText = '';

  private restartCount = 0;
  private restartAttempts = 0;
  private fatalError: string | null = null;
  private sawConfidence = false;

  private diagnostics: DiagnosticState = {
    recognition_available: false,
    recognition_created: false,
    recognition_start_requested: false,
    recognition_started: false,
    audio_start: false,
    sound_start: false,
    speech_start: false,
    result_received: false,
    speech_end: false,
    sound_end: false,
    audio_end: false,
    recognition_end: false,
    recognition_error: null
  };

  private onUpdate: ((state: LiveTranscriptState) => void) | null = null;
  private onStatus: ((message: string) => void) | null = null;
  private onDiagnostics: ((diag: DiagnosticState) => void) | null = null;

  static isSupported(): boolean {
    return getRecognitionConstructor() !== null;
  }

  static getConstructorName(): 'SpeechRecognition' | 'webkitSpeechRecognition' | 'neither' {
    return getConstructorName();
  }

  private resetDiagnostics(): void {
    this.diagnostics = {
      recognition_available: LiveTranscriptionService.isSupported(),
      recognition_created: false,
      recognition_start_requested: false,
      recognition_started: false,
      audio_start: false,
      sound_start: false,
      speech_start: false,
      result_received: false,
      speech_end: false,
      sound_end: false,
      audio_end: false,
      recognition_end: false,
      recognition_error: null
    };
  }

  private notifyDiagnostics(): void {
    if (this.onDiagnostics) {
      this.onDiagnostics({ ...this.diagnostics });
    }
  }

  /**
   * Starts live recognition.
   *
   * Resolves as soon as recognition has been requested. It never throws for an unsupported
   * browser: the assessment must still be recordable, and the caller is told through
   * onStatus so it can show "Live transcription is unavailable in this browser".
   */
  start(
    onUpdate: (state: LiveTranscriptState) => void,
    onStatus: (message: string) => void,
    onDiagnostics?: (diag: DiagnosticState) => void
  ): boolean {
    const Ctor = getRecognitionConstructor();
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.onDiagnostics = onDiagnostics || null;

    this.resetDiagnostics();

    if (!Ctor) {
      this.onStatus?.('Live transcription is unavailable in this browser. Audio recording will continue.');
      this.notifyDiagnostics();
      return false;
    }

    try {
      this.recognition = new Ctor();
      this.diagnostics.recognition_created = true;

      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-GB';
      this.recognition.maxAlternatives = 1;

      // Note: We do NOT force processLocally = true because Chrome desktop requires standard network speech recognition.

      this.sessionStartMs = Date.now();
      this.listening = true;
      this.intentionalStop = false;
      this.fatalError = null;
      this.restartAttempts = 0;

      // Attach ALL event handlers BEFORE start()
      this.recognition.onstart = () => {
        this.diagnostics.recognition_started = true;
        this.notifyDiagnostics();
        this.onStatus?.('Live transcription: Listening');
      };

      this.recognition.onaudiostart = () => {
        this.diagnostics.audio_start = true;
        this.notifyDiagnostics();
      };

      this.recognition.onsoundstart = () => {
        this.diagnostics.sound_start = true;
        this.notifyDiagnostics();
      };

      this.recognition.onspeechstart = () => {
        this.diagnostics.speech_start = true;
        this.notifyDiagnostics();
        this.onStatus?.('Live transcription: Speech detected');
      };

      this.recognition.onspeechend = () => {
        this.diagnostics.speech_end = true;
        this.notifyDiagnostics();
      };

      this.recognition.onsoundend = () => {
        this.diagnostics.sound_end = true;
        this.notifyDiagnostics();
      };

      this.recognition.onaudioend = () => {
        this.diagnostics.audio_end = true;
        this.notifyDiagnostics();
      };

      this.recognition.onresult = (event: any) => {
        this.diagnostics.result_received = true;
        this.notifyDiagnostics();
        this.handleResult(event);
      };

      this.recognition.onerror = (event: any) => {
        const code = String(event?.error ?? 'unknown');
        this.diagnostics.recognition_error = code;
        this.notifyDiagnostics();

        if (FATAL_ERRORS.has(code)) {
          this.fatalError = code;
          this.listening = false;
          if (code === 'not-allowed') {
            this.onStatus?.('Live transcription error: Microphone access was blocked by the browser.');
          } else if (code === 'service-not-allowed') {
            this.onStatus?.('Live transcription error: Speech recognition service is blocked.');
          } else if (code === 'audio-capture') {
            this.onStatus?.('Live transcription error: Audio capture device unavailable.');
          } else if (code === 'language-not-supported') {
            this.onStatus?.('Live transcription error: Language en-GB is not supported.');
          } else {
            this.onStatus?.(`Live transcription error: (${code}).`);
          }
          return;
        }

        if (code === 'network') {
          this.onStatus?.('Live transcription error: Network connection to speech service failed — retrying.');
        } else if (code !== 'no-speech' && code !== 'aborted') {
          this.onStatus?.(`Live transcription: (${code}) — continuing.`);
        }
      };

      this.recognition.onend = () => {
        this.diagnostics.recognition_end = true;
        this.notifyDiagnostics();
        this.handleEnd();
      };

      this.diagnostics.recognition_start_requested = true;
      this.notifyDiagnostics();
      this.onStatus?.('Live transcription: Starting…');

      this.recognition.start();
      return true;
    } catch (err: any) {
      this.listening = false;
      this.diagnostics.recognition_error = err?.message || 'start-failed';
      this.notifyDiagnostics();
      this.onStatus?.('Live transcription is unavailable in this browser. Audio recording will continue.');
      return false;
    }
  }

  /**
   * Handles a recognition event.
   *
   * The event carries results from `resultIndex` onward. Final results are appended once;
   * everything still interim is concatenated into the single replaceable interim string.
   */
  private handleResult(event: any): void {
    if (this.intentionalStop || !this.listening) return;

    let interim = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const alternative = result[0];
      const transcript = String(alternative?.transcript ?? '').trim();
      if (!transcript) continue;

      if (!result.isFinal) {
        interim += (interim ? ' ' : '') + transcript;
        continue;
      }

      const confidence =
        typeof alternative.confidence === 'number' && alternative.confidence > 0
          ? alternative.confidence
          : null;
      if (confidence !== null) this.sawConfidence = true;

      if (this.isDuplicateOfRecent(transcript)) continue;

      this.finalEntries.push({
        text: transcript,
        atMs: Date.now() - this.sessionStartMs,
        confidence
      });
    }

    this.interimText = interim;
    this.emit();
  }

  /** Guards against the engine re-delivering a final result it has already given us. */
  private isDuplicateOfRecent(text: string): boolean {
    const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const candidate = normalise(text);
    if (!candidate) return true;

    return this.finalEntries.slice(-3).some((e) => normalise(e.text) === candidate);
  }

  /**
   * Restarts recognition when the engine stops on its own.
   *
   * Browsers end recognition periodically even with `continuous = true`. Restarting keeps
   * the live transcript going, but only while the clinician is still recording, never after
   * a deliberate stop, and never after a fatal error — each of which would otherwise produce
   * a tight restart loop.
   */
  private handleEnd(): void {
    if (!this.listening || this.intentionalStop || this.fatalError) return;

    this.restartCount++;
    const backoffMs = Math.min(2000, 150 * Math.pow(2, this.restartAttempts));
    this.restartAttempts++;

    setTimeout(() => {
      if (!this.listening || this.intentionalStop || this.fatalError) return;
      try {
        this.recognition.start();
        this.restartAttempts = 0;
      } catch {
        if (this.restartAttempts > 6) {
          this.fatalError = 'restart-failed';
          this.listening = false;
          this.onStatus?.(
            'Live transcription is unavailable in this browser. Audio recording will continue.'
          );
        }
      }
    }, backoffMs);
  }

  private emit(): void {
    this.onUpdate?.({ finalEntries: [...this.finalEntries], interimText: this.interimText });
  }

  /**
   * Stops recognition and freezes the transcript.
   *
   * Any pending interim text is deliberately DISCARDED rather than committed: it is an
   * uncommitted hypothesis the engine had not settled on, and promoting it to the clinical
   * record would be inventing the one thing the engine declined to assert.
   */
  stop(): { text: string; entries: TranscriptEntry[]; discardedInterim: string } {
    this.intentionalStop = true;
    this.listening = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Already stopped.
      }
    }

    const discardedInterim = this.interimText;
    this.interimText = '';
    this.emit();

    return {
      text: this.getFrozenText(),
      entries: [...this.finalEntries],
      discardedInterim
    };
  }

  /** The authoritative transcript: committed results only, in order, as flowing text. */
  getFrozenText(): string {
    return this.finalEntries
      .map((e) => e.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getState(): LiveTranscriptState {
    return { finalEntries: [...this.finalEntries], interimText: this.interimText };
  }

  getDiagnostics(): RecognitionDiagnostics {
    return {
      supported: LiveTranscriptionService.isSupported(),
      constructorName: LiveTranscriptionService.getConstructorName(),
      producedAnyText: this.finalEntries.length > 0,
      restartCount: this.restartCount,
      fatalError: this.fatalError,
      confidenceUnavailable: this.finalEntries.length > 0 && !this.sawConfidence,
      localProcessing: false,
      diagnostics: { ...this.diagnostics }
    };
  }

  /** Restores a checkpointed transcript after an accidental refresh. */
  restore(entries: TranscriptEntry[]): void {
    this.finalEntries = [...entries];
    this.emit();
  }

  reset(): void {
    this.finalEntries = [];
    this.interimText = '';
    this.restartCount = 0;
    this.restartAttempts = 0;
    this.fatalError = null;
    this.sawConfidence = false;
    this.intentionalStop = false;
    this.resetDiagnostics();
  }
}

export const liveTranscription = new LiveTranscriptionService();
