import { LLMProvider, LLMHealthCheckResult } from './LLMProvider';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../types';
import { AIExtractionService } from '../../services/aiExtraction';

export class MockLLMProvider implements LLMProvider {
  name = 'MockLLMProvider';
  private aiService = new AIExtractionService();

  async checkHealth(): Promise<LLMHealthCheckResult> {
    return {
      status: 'CONNECTED',
      providerName: this.name,
      details: 'Local Development Rule-Based Extraction Provider Active'
    };
  }

  async extractStructuredNote(segments: CanonicalTranscriptSegment[]): Promise<StructuredClinicalExtraction> {
    return this.aiService.extractStructuredClinicalNote(segments);
  }
}
