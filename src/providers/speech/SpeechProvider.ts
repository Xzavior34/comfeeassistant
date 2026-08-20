import { ProviderTranscript } from '../../types';

export interface TranscriptionOptions {
  languageCode?: string;
  expectedSpeakerCount?: number;
  enableDiarization?: boolean;
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
