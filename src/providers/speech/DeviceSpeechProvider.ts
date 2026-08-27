import { SpeechProvider, TranscriptionOptions, ProviderHealthCheckResult } from './SpeechProvider';
import { ProviderTranscript, ProviderTranscriptSegment } from '../../types';

/**
 * On-device (browser) speech capture.
 *
 * Recognition happens in the clinician's browser via the W3C SpeechRecognition API; the
 * server never receives audio. This class therefore only *carries* segments that the
 * client has already produced.
 *
 * It must never synthesise clinical text. Fabricated content reaching a patient record is
 * a clinical safety incident, so every path that has no real transcript throws instead.
 */
export class DeviceSpeechProvider implements SpeechProvider {
  name = 'DeviceSpeechProvider';
  private language: string;
  private finalSegments: ProviderTranscriptSegment[] = [];
  private interimText = '';

  constructor(language: string = process.env.SPEECH_LANGUAGE || 'en-GB') {
    this.language = language;
  }

  /** True only in a browser context. Always false in the Node API/worker process. */
  isSupported(): boolean {
    const globalObj: any = typeof globalThis !== 'undefined' ? globalThis : {};
    const win = globalObj.window || globalObj;
    return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  /** True when this instance is running server-side, where capture is impossible. */
  private isServerSide(): boolean {
    return typeof (globalThis as any).window === 'undefined';
  }

  async checkHealth(): Promise<ProviderHealthCheckResult> {
    if (this.isServerSide()) {
      return {
        status: 'NOT CONFIGURED',
        providerName: this.name,
        details:
          'Device speech captures audio in the clinician browser and cannot transcribe ' +
          'server-side. Segments must be submitted from the client via POST /api/transcripts/process. ' +
          'For server-side transcription set SPEECH_PROVIDER to "google" or "azure".'
      };
    }

    if (!this.isSupported()) {
      return {
        status: 'NOT CONFIGURED',
        providerName: this.name,
        details: 'W3C SpeechRecognition API unavailable in this browser'
      };
    }

    return {
      status: 'CONNECTED',
      providerName: this.name,
      details: `Browser SpeechRecognition available. Language: ${this.language}`
    };
  }

  async transcribe(_audioUri: string, _options?: TranscriptionOptions): Promise<ProviderTranscript> {
    if (this.finalSegments.length > 0) {
      return {
        providerName: this.name,
        durationMs: Math.max(...this.finalSegments.map((s) => s.endTimeMs), 0),
        segments: this.finalSegments
      };
    }

    throw new Error(
      '[DeviceSpeechProvider] No captured speech segments are available for this session. ' +
        'Device speech recognition runs in the clinician browser: the client must submit its ' +
        'captured segments. No clinical note can be generated without a real transcript.'
    );
  }

  addFinalSegment(
    text: string,
    startTimeMs: number,
    endTimeMs: number,
    confidence: number | null = null,
    speakerId = 'UNKNOWN'
  ): void {
    this.finalSegments.push({ speakerId, startTimeMs, endTimeMs, text, confidence } as ProviderTranscriptSegment);
  }

  setInterimText(text: string): void {
    this.interimText = text;
  }

  getInterimText(): string {
    return this.interimText;
  }

  getFinalSegments(): ProviderTranscriptSegment[] {
    return this.finalSegments;
  }
}
