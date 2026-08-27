import { ProviderTranscript } from '../../types';

export interface TranscriptionOptions {
  languageCode?: string;
  expectedSpeakerCount?: number;
  enableDiarization?: boolean;
  /**
   * Session-specific terms to boost during recognition: equipment model names, the person's
   * own vocabulary, clinician names. Known-present terms are boosted harder than the
   * general clinical lexicon.
   */
  additionalPhrases?: string[];
}

export interface ProviderHealthCheckResult {
  status: 'CONNECTED' | 'NOT CONFIGURED' | 'CONNECTION FAILED';
  providerName: string;
  details?: string;
}

export interface SpeechProvider {
  name: string;
  transcribe(audioUri: string, options?: TranscriptionOptions): Promise<ProviderTranscript>;
  checkHealth(): Promise<ProviderHealthCheckResult>;
}
