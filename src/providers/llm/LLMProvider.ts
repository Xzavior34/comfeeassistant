import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../types';

export interface LLMHealthCheckResult {
  status: 'CONNECTED' | 'NOT CONFIGURED' | 'CONNECTION FAILED';
  providerName: string;
  details?: string;
}

export interface LLMProvider {
  name: string;
  extractStructuredNote(segments: CanonicalTranscriptSegment[]): Promise<StructuredClinicalExtraction>;
  checkHealth(): Promise<LLMHealthCheckResult>;
}
