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

export interface DiagnosticCounters {
  startAttempts: number;
  onstartEvents: number;
  onaudiostartEvents: number;
  onsoundstartEvents: number;
  onspeechstartEvents: number;
  onresultEvents: number;
  finalResults: number;
  interimResults: number;
  onendEvents: number;
  restartAttempts: number;
}

export interface DiagnosticState {
  api: 'SpeechRecognition' | 'webkitSpeechRecognition' | 'unavailable' | 'neither';
  state: 'idle' | 'start requested' | 'started' | 'audio detected' | 'sound detected' | 'speech detected' | 'result received' | 'ended' | 'error';
  lastErrorCode: string;
  counters: DiagnosticCounters;
  speechStartRequestedTimeMs: number | null;
  speechOnStartTimeMs: number | null;
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
  /**
   * True when recognition started but never received audio.
   *
   * On Android Chrome and iOS the speech recogniser needs exclusive access to the
   * microphone. If getUserMedia already holds an open stream — which MediaRecorder does —
   * recognition starts, reports onstart, and then silently receives nothing: no
   * onaudiostart, no results, no error. Desktop Chrome shares the microphone happily, which
   * is exactly why this only ever showed up on a phone.
   */
  mic_contention: boolean;
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
    api: getConstructorName() === 'neither' ? 'unavailable' : getConstructorName(),
    state: 'idle',
    lastErrorCode: 'none',
    counters: {
      startAttempts: 0,
      onstartEvents: 0,
      onaudiostartEvents: 0,
      onsoundstartEvents: 0,
      onspeechstartEvents: 0,
      onresultEvents: 0,
      finalResults: 0,
      interimResults: 0,
      onendEvents: 0,
      restartAttempts: 0
    },
    speechStartRequestedTimeMs: null,
    speechOnStartTimeMs: null,
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
    recognition_error: null,
    mic_contention: false
  };

  /** Fires if recognition starts but no audio ever reaches it. See mic_contention. */
  private audioWatchdog: any = null;
  private onMicContention: (() => void) | null = null;

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
    const ctorName = getConstructorName();
    this.diagnostics = {
      api: ctorName === 'neither' ? 'unavailable' : ctorName,
      state: 'idle',
      lastErrorCode: 'none',
      counters: {
        startAttempts: 0,
        onstartEvents: 0,
        onaudiostartEvents: 0,
        onsoundstartEvents: 0,
        onspeechstartEvents: 0,
        onresultEvents: 0,
        finalResults: 0,
        interimResults: 0,
        onendEvents: 0,
        restartAttempts: 0
      },
      speechStartRequestedTimeMs: null,
      speechOnStartTimeMs: null,
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
      recognition_error: null,
      mic_contention: false
    };
  }

  private notifyDiagnostics(): void {
    if (this.onDiagnostics) {
      this.onDiagnostics({
        ...this.diagnostics,
        counters: { ...this.diagnostics.counters }
      });
    }
  }

  /**
   * Starts live recognition.
   */
  start(
    onUpdate: (state: LiveTranscriptState) => void,
    onStatus: (message: string) => void,
    onDiagnostics?: (diag: DiagnosticState) => void
  ): boolean {
    const Ctor = getRecognitionConstructor();
    const ctorName = getConstructorName();
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.onDiagnostics = onDiagnostics || null;

    console.log(`[speech] constructor=${ctorName}`);

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

      this.sessionStartMs = Date.now();
      this.listening = true;
      this.intentionalStop = false;
      this.fatalError = null;
      this.restartAttempts = 0;

      // Attach ALL event handlers BEFORE start()
      this.recognition.onstart = () => {
        console.log('[speech] onstart');
        this.diagnostics.state = 'started';
        this.diagnostics.recognition_started = true;
        this.diagnostics.counters.onstartEvents++;
        this.diagnostics.speechOnStartTimeMs = Date.now();
        this.notifyDiagnostics();
        this.onStatus?.('Live transcription: Listening');

        // Recognition says it started. If no audio reaches it within a few seconds,
        // something else holds the microphone — on a phone, that is almost always our own
        // MediaRecorder. Detect it rather than leaving the clinician watching an empty
        // transcript with no error on screen.
        this.armAudioWatchdog();
      };

      this.recognition.onaudiostart = () => {
        console.log('[speech] onaudiostart');
        this.disarmAudioWatchdog();
        this.diagnostics.state = 'audio detected';
        this.diagnostics.audio_start = true;
        this.diagnostics.counters.onaudiostartEvents++;
        this.notifyDiagnostics();
      };

      this.recognition.onsoundstart = () => {
        console.log('[speech] onsoundstart');
        this.diagnostics.state = 'sound detected';
        this.diagnostics.sound_start = true;
        this.diagnostics.counters.onsoundstartEvents++;
        this.notifyDiagnostics();
      };

      this.recognition.onspeechstart = () => {
        console.log('[speech] onspeechstart');
        this.diagnostics.state = 'speech detected';
        this.diagnostics.speech_start = true;
        this.diagnostics.counters.onspeechstartEvents++;
        this.notifyDiagnostics();
        this.onStatus?.('Live transcription: Speech detected');
      };

      this.recognition.onspeechend = () => {
        console.log('[speech] onspeechend');
        this.diagnostics.speech_end = true;
        this.notifyDiagnostics();
      };

      this.recognition.onsoundend = () => {
        console.log('[speech] onsoundend');
        this.diagnostics.sound_end = true;
        this.notifyDiagnostics();
      };

      this.recognition.onaudioend = () => {
        console.log('[speech] onaudioend');
        this.diagnostics.audio_end = true;
        this.notifyDiagnostics();
      };

      this.recognition.onresult = (event: any) => {
        const hasFinal = Array.from(event.results || []).some((r: any) => r.isFinal);
        console.log(`[speech] onresult interim=${!hasFinal}`);
        this.diagnostics.state = 'result received';
        this.diagnostics.result_received = true;
        this.diagnostics.counters.onresultEvents++;
        this.notifyDiagnostics();
        this.handleResult(event);
      };

      this.recognition.onerror = (event: any) => {
        const code = String(event?.error ?? 'unknown');
        console.log(`[speech] onerror code=${code}`);
        this.diagnostics.state = 'error';
        this.diagnostics.lastErrorCode = code;
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
        console.log('[speech] onend');
        this.diagnostics.state = 'ended';
        this.diagnostics.recognition_end = true;
        this.diagnostics.counters.onendEvents++;
        this.notifyDiagnostics();
        this.handleEnd();
      };

      console.log('[speech] start requested');
      this.diagnostics.state = 'start requested';
      this.diagnostics.recognition_start_requested = true;
      this.diagnostics.counters.startAttempts++;
      this.diagnostics.speechStartRequestedTimeMs = Date.now();
      this.notifyDiagnostics();
      this.onStatus?.('Live transcription: Starting…');

      this.recognition.start();
      return true;
    } catch (err: any) {
      console.log(`[speech] onerror code=${err?.message || 'start-failed'}`);
      this.listening = false;
      this.diagnostics.state = 'error';
      this.diagnostics.lastErrorCode = err?.message || 'start-failed';
      this.diagnostics.recognition_error = err?.message || 'start-failed';
      this.notifyDiagnostics();
      this.onStatus?.('Live transcription is unavailable in this browser. Audio recording will continue.');
      return false;
    }
  }

  /**
   * Handles a recognition event.
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
        this.diagnostics.counters.interimResults++;
        continue;
      }

      this.diagnostics.counters.finalResults++;
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
    this.notifyDiagnostics();
    this.emit();
  }

  /**
   * Watches for the "started but deaf" state.
   *
   * Chrome fires onaudiostart within a few hundred milliseconds of a working microphone
   * connection. Three seconds without it means recognition is not receiving audio at all.
   */
  private armAudioWatchdog(): void {
    this.disarmAudioWatchdog();
    this.audioWatchdog = setTimeout(() => {
      if (!this.listening || this.diagnostics.audio_start) return;

      this.diagnostics.mic_contention = true;
      this.notifyDiagnostics();
      this.onStatus?.(
        'Live transcription started but is not receiving audio. Releasing the audio recorder ' +
          'and retrying — on phones the microphone can only be used by one of them at a time.'
      );
      this.onMicContention?.();
    }, 3000);
  }

  private disarmAudioWatchdog(): void {
    if (this.audioWatchdog) {
      clearTimeout(this.audioWatchdog);
      this.audioWatchdog = null;
    }
  }

  /** Registers the callback used to free the microphone when contention is detected. */
  setMicContentionHandler(handler: (() => void) | null): void {
    this.onMicContention = handler;
  }

  /** Restarts recognition after the microphone has been freed. */
  retryAfterMicRelease(): void {
    if (!this.listening || this.fatalError) return;
    try {
      this.recognition?.abort?.();
    } catch {
      // Already stopped; the restart below is what matters.
    }
    setTimeout(() => {
      if (!this.listening || this.fatalError) return;
      try {
        this.diagnostics.mic_contention = false;
        this.recognition.start();
        this.armAudioWatchdog();
      } catch {
        // onend will drive the normal restart path.
      }
    }, 300);
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
    this.diagnostics.counters.restartAttempts++;
    this.notifyDiagnostics();

    setTimeout(() => {
      if (!this.listening || this.intentionalStop || this.fatalError) return;
      try {
        console.log('[speech] restart requested');
        this.diagnostics.state = 'start requested';
        this.diagnostics.counters.startAttempts++;
        this.notifyDiagnostics();
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
    this.disarmAudioWatchdog();
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
