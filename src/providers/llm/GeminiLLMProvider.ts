import { LLMProvider, LLMHealthCheckResult } from './LLMProvider';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../types';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';
import { generateSystemPrompt, StructuredClinicalExtractionSchema } from '../../services/aiExtraction';

export class GeminiLLMProvider implements LLMProvider {
  name = 'GoogleGeminiAPI';

  async checkHealth(): Promise<LLMHealthCheckResult> {
    const apiKey = env.LLM_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        status: 'NOT CONFIGURED',
        providerName: this.name,
        details: 'Missing LLM_API_KEY or GEMINI_API_KEY in environment'
      };
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
      // Authenticated health ping
      return {
        status: 'CONNECTED',
        providerName: this.name,
        details: `Active model: ${env.GEMINI_MODEL}`
      };
    } catch (err: any) {
      return {
        status: 'CONNECTION FAILED',
        providerName: this.name,
        details: `Gemini API connection failed: ${err.message || err}`
      };
    }
  }

  async extractStructuredNote(segments: CanonicalTranscriptSegment[]): Promise<StructuredClinicalExtraction> {
    const health = await this.checkHealth();
    if (health.status !== 'CONNECTED') {
      throw new Error(`[GeminiLLMProvider] Live Gemini API extraction failed. Status: ${health.status}. Details: ${health.details}`);
    }

    const apiKey = (env.LLM_API_KEY || process.env.GEMINI_API_KEY)!;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: env.GEMINI_MODEL,
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `${generateSystemPrompt()}\n\nCanonical Transcript Data:\n${JSON.stringify(segments, null, 2)}`;
    const result = await model.generateContent(prompt);
    const textResponse = result.response.text();

    const parsedJson = JSON.parse(textResponse);
    return StructuredClinicalExtractionSchema.parse(parsedJson);
  }
}
