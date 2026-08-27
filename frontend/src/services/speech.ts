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

export interface RecognitionDiagnostics {
  supported: boolean;
  /** True once recognition has produced at least one final result. */
  producedAnyText: boolean;
  restartCount: number;
  /** Set when recognition stopped for good, with the reason. */
  fatalError: string | null;
  /** True when the engine never supplied confidence values. */
  confidenceUnavailable: boolean;
  /** True when on-device processing was requested and accepted by the browser. */
  localProcessing: boolean;
}

/** Errors after which restarting is pointless or harmful. */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'bad-grammar']);

function getRecognitionConstructor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export class LiveTranscriptionService {
  private recognition: any = null;
  private listening = false;
  private stopping = false;
  private sessionStartMs = 0;

  private finalEntries: TranscriptEntry[] = [];
  private interimText = '';

  private restartCount = 0;
  private restartAttempts = 0;
  private fatalError: string | null = null;
  private sawConfidence = false;
  private localProcessing = false;

  private onUpdate: ((state: LiveTranscriptState) => void) | null = null;
  private onStatus: ((message: string) => void) | null = null;

  static isSupported(): boolean {
    return getRecognitionConstructor() !== null;
  }

  /**
   * Starts live recognition.
   *
   * Resolves as soon as recognition has been requested. It never throws for an unsupported
   * browser: the assessment must still be recordable, and the caller is told through
   * onStatus so it can show "Live transcription unavailable on this browser".
   */
  start(onUpdate: (state: LiveTranscriptState) => void, onStatus: (message: string) => void): boolean {
    const Ctor = getRecognitionConstructor();
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;

    if (!Ctor) {
      onStatus('Live transcription is unavailable in this browser. Audio recording will continue.');
      return false;
    }

    this.recognition = new Ctor();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-GB';
    this.recognition.maxAlternatives = 1;

    // On-device recognition keeps the consultation off third-party servers. It is very new
    // and absent almost everywhere, so it is feature-detected and simply skipped when the
    // property is not present — never assumed.
    try {
      if ('processLocally' in this.recognition) {
        this.recognition.processLocally = true;
        this.localProcessing = true;
      }
    } catch {
      this.localProcessing = false;
    }

    this.sessionStartMs = Date.now();
    this.listening = true;
    this.stopping = false;
    this.fatalError = null;
    this.restartAttempts = 0;

    this.recognition.onresult = (event: any) => this.handleResult(event);

    this.recognition.onerror = (event: any) => {
      const code = event?.error ?? 'unknown';

      if (FATAL_ERRORS.has(code)) {
        this.fatalError = code;
        this.listening = false;
        onStatus(
          code === 'not-allowed'
            ? 'Microphone access was blocked, so live transcription has stopped.'
            : `Live transcription stopped (${code}).`
        );
        return;
      }
      // 'no-speech' and 'aborted' are routine in a consultation with natural pauses.
      if (code !== 'no-speech' && code !== 'aborted') {
        onStatus(`Live transcription hiccup (${code}) — continuing.`);
      }
    };

    this.recognition.onend = () => this.handleEnd();

    try {
      this.recognition.start();
      return true;
    } catch (err: any) {
      onStatus(`Live transcription could not start (${err?.message ?? err}). Recording continues.`);
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
    // Once the clinician has ended the assessment the transcript is frozen. Engines can
    // deliver a straggling final result after stop(); accepting it would silently change a
    // transcript the clinician has already been shown and submitted.
    if (this.stopping || !this.listening) return;

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

      // Some engines re-emit a final result that was already committed, particularly around
      // a restart. Committing it twice would duplicate a clinical statement.
      if (this.isDuplicateOfRecent(transcript)) continue;

      this.finalEntries.push({
        text: transcript,
        atMs: Date.now() - this.sessionStartMs,
        confidence
      });
    }

    // Interim is always replaced, never accumulated.
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
    if (!this.listening || this.stopping || this.fatalError) return;

    this.restartCount++;
    const backoffMs = Math.min(2000, 150 * Math.pow(2, this.restartAttempts));
    this.restartAttempts++;

    setTimeout(() => {
      if (!this.listening || this.stopping || this.fatalError) return;
      try {
        this.recognition.start();
        this.restartAttempts = 0;
      } catch {
        if (this.restartAttempts > 6) {
          this.fatalError = 'restart-failed';
          this.listening = false;
          this.onStatus?.(
            'Live transcription could not be restarted. Audio recording is unaffected and the ' +
              'transcript captured so far has been kept.'
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
    this.stopping = true;
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
      producedAnyText: this.finalEntries.length > 0,
      restartCount: this.restartCount,
      fatalError: this.fatalError,
      confidenceUnavailable: this.finalEntries.length > 0 && !this.sawConfidence,
      localProcessing: this.localProcessing
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
  }
}

export const liveTranscription = new LiveTranscriptionService();
