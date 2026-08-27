import {
  correctClinicalText,
  rescoreAlternatives,
  buildJsgfGrammar,
  AsrAlternative
} from '../shared/clinicalLexicon';

export interface SpeechSegment {
  /** Raw engine/diarisation label. 'UNKNOWN' when the engine gives no speaker signal. */
  speakerId: string;
  /** Clinically corrected text used for documentation. */
  text: string;
  /** Untouched engine output, retained as evidence. Never overwritten. */
  rawText: string;
  startTimeMs: number;
  endTimeMs: number;
  /**
   * Engine-reported confidence in [0,1], or null when the engine did not supply one.
   * MUST NOT be defaulted to a high value: downstream safety checks rely on null
   * meaning "unknown", not "good".
   */
  confidence: number | null;
  /** True when the clinical lexicon pass altered the text. */
  isCorrected: boolean;
  /** True when a lower-ranked ASR alternative was promoted on clinical-vocabulary grounds. */
  alternativePromoted: boolean;
  /** The engine's own preferred hypothesis, kept for clinician review. */
  engineTopHypothesis: string;
}

export interface SpeechDiagnostics {
  /** True when no engine confidence values were available for the whole session. */
  confidenceUnavailable: boolean;
  /** True when speaker attribution could not be established from the engine. */
  speakerAttributionUnavailable: boolean;
  /** Number of times the recogniser had to be restarted (words can be lost at each). */
  restartCount: number;
  /** Utterances where recognition was restarted mid-speech. */
  possibleWordLossEvents: number;
  fatalError: string | null;
}

/** Errors after which restarting the recogniser is pointless or harmful. */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'bad-grammar', 'language-not-supported']);

export class DeviceBrowserSpeechService {
  private recognition: any = null;
  private isListening = false;
  private sessionStartMs = 0;
  private utteranceStartMs: number | null = null;
  private segments: SpeechSegment[] = [];
  private restartAttempts = 0;
  private restartCount = 0;
  private possibleWordLossEvents = 0;
  private sawAnyConfidence = false;
  private fatalError: string | null = null;
  private pendingInterim = '';
  private onErrorCb: ((err: string) => void) | null = null;

  constructor(private language: string = 'en-GB') {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;
    // Request an n-best list so clinical terminology can outrank the engine's
    // general-English first guess. Without this the engine returns one hypothesis only.
    this.recognition.maxAlternatives = 5;

    // Bias the engine toward clinical vocabulary where the browser supports grammars.
    const SpeechGrammarList =
      (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
    if (SpeechGrammarList) {
      try {
        const list = new SpeechGrammarList();
        list.addFromString(buildJsgfGrammar(), 1);
        this.recognition.grammars = list;
      } catch {
        // Grammar support is optional; recognition still works without it.
      }
    }
  }

  isSupported(): boolean {
    return !!this.recognition;
  }

  async requestMicrophonePermission(): Promise<boolean> {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // Clinical rooms are quiet but reverberant; these help intelligibility
            // without the aggressive processing that clips consonants.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        });
        stream.getTracks().forEach((t) => t.stop());
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Microphone permission denied:', err);
      return false;
    }
  }

  start(
    onInterim: (text: string) => void,
    onFinalSegment: (segment: SpeechSegment) => void,
    onError: (err: string) => void
  ) {
    if (!this.recognition) {
      onError(
        'Speech recognition is not available in this browser. Recording cannot proceed — ' +
          'no clinical note will be generated. Use a supported browser (Chrome or Edge).'
      );
      return;
    }

    this.onErrorCb = onError;
    this.sessionStartMs = Date.now();
    this.isListening = true;
    this.restartAttempts = 0;
    this.fatalError = null;

    this.recognition.onspeechstart = () => {
      this.utteranceStartMs = Date.now() - this.sessionStartMs;
    };

    this.recognition.onresult = (event: any) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];

        const alternatives: AsrAlternative[] = [];
        for (let a = 0; a < result.length; a++) {
          alternatives.push({
            transcript: result[a].transcript,
            confidence:
              typeof result[a].confidence === 'number' && result[a].confidence > 0
                ? result[a].confidence
                : null
          });
        }

        if (!result.isFinal) {
          interim += alternatives[0]?.transcript ?? '';
          continue;
        }

        const rescored = rescoreAlternatives(alternatives);
        if (!rescored.transcript) continue;

        const corrected = correctClinicalText(rescored.transcript);
        if (rescored.confidence !== null) this.sawAnyConfidence = true;

        const endTimeMs = Date.now() - this.sessionStartMs;
        // Use the real speech-onset time where the engine reported one, and never
        // emit a negative or inverted interval.
        const startTimeMs =
          this.utteranceStartMs !== null && this.utteranceStartMs < endTimeMs
            ? this.utteranceStartMs
            : Math.max(0, endTimeMs - 1);
        this.utteranceStartMs = null;

        const segment: SpeechSegment = {
          // Chrome's Web Speech API performs no diarisation. Alternating labels would be
          // fabricated attribution, so speakers stay UNKNOWN until a real signal exists.
          speakerId: 'UNKNOWN',
          text: corrected.text,
          rawText: rescored.engineTopHypothesis,
          startTimeMs,
          endTimeMs,
          confidence: rescored.confidence,
          isCorrected: corrected.isCorrected,
          alternativePromoted: rescored.promoted,
          engineTopHypothesis: rescored.engineTopHypothesis
        };

        this.segments.push(segment);
        onFinalSegment(segment);
      }

      this.pendingInterim = interim;
      onInterim(interim);
    };

    this.recognition.onerror = (event: any) => {
      const code = event?.error ?? 'unknown';
      if (FATAL_ERRORS.has(code)) {
        this.fatalError = code;
        this.isListening = false;
        onError(
          `Speech recognition stopped: ${code}. Recording has ended — check microphone ` +
            'permissions and restart the session.'
        );
        return;
      }
      // 'no-speech' and 'aborted' are routine during a consultation; surface others.
      if (code !== 'no-speech' && code !== 'aborted') {
        onError(`Speech recognition warning: ${code}`);
      }
    };

    this.recognition.onend = () => {
      if (!this.isListening || this.fatalError) return;

      // Interim text at the moment of restart is lost by the engine. Record that so the
      // clinician is told words may be missing, rather than silently dropping them.
      if (this.pendingInterim.trim()) {
        this.possibleWordLossEvents++;
        this.pendingInterim = '';
      }

      this.restartCount++;
      const backoffMs = Math.min(2000, 100 * Math.pow(2, this.restartAttempts));
      this.restartAttempts++;

      setTimeout(() => {
        if (!this.isListening || this.fatalError) return;
        try {
          this.recognition.start();
          this.restartAttempts = 0;
        } catch (err: any) {
          if (this.restartAttempts > 6) {
            this.isListening = false;
            this.fatalError = 'restart-failed';
            this.onErrorCb?.(
              'Speech recognition could not be restarted. Recording has stopped; ' +
                'the transcript captured so far has been kept.'
            );
          }
        }
      }, backoffMs);
    };

    try {
      this.recognition.start();
    } catch (err: any) {
      onError(`Failed to start recognition: ${err?.message ?? err}`);
    }
  }

  stop(): SpeechSegment[] {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Already stopped.
      }
    }
    return this.segments;
  }

  getCapturedSegments(): SpeechSegment[] {
    return this.segments;
  }

  getDiagnostics(): SpeechDiagnostics {
    return {
      confidenceUnavailable: this.segments.length > 0 && !this.sawAnyConfidence,
      speakerAttributionUnavailable: true,
      restartCount: this.restartCount,
      possibleWordLossEvents: this.possibleWordLossEvents,
      fatalError: this.fatalError
    };
  }

  reset(): void {
    this.segments = [];
    this.restartCount = 0;
    this.possibleWordLossEvents = 0;
    this.sawAnyConfidence = false;
    this.fatalError = null;
    this.pendingInterim = '';
  }
}

export const deviceSpeech = new DeviceBrowserSpeechService('en-GB');
