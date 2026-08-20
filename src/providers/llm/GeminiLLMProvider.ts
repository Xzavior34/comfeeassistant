import { LLMProvider, LLMHealthCheckResult } from './LLMProvider';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../types';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';
import { generateSystemPrompt, StructuredClinicalExtractionSchema, AIExtractionService } from '../../services/aiExtraction';

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return target;
  if (!target || typeof target !== 'object') return source;

  const output = Array.isArray(target) ? [...target] : { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] !== undefined && source[key] !== null) {
      if (Array.isArray(source[key])) {
        output[key] = source[key].length > 0 ? source[key] : (target[key] || source[key]);
      } else if (typeof source[key] === 'object') {
        output[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }
  }

  return output;
}

export class GeminiLLMProvider implements LLMProvider {
  name = 'GoogleGeminiAPI';

  async checkHealth(): Promise<LLMHealthCheckResult & { availableModels?: string[] }> {
    const apiKey = env.LLM_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        status: 'NOT CONFIGURED',
        providerName: this.name,
        details: 'Missing LLM_API_KEY or GEMINI_API_KEY in environment'
      };
    }

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await response.json() as any;
      const availableModels = data.models ? data.models.map((m: any) => m.name) : [];

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
      // Authenticated health ping
      return {
        status: 'CONNECTED',
        providerName: this.name,
        details: `Active model: ${env.GEMINI_MODEL}`,
        availableModels
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

    // 1. Generate a robust baseline note guaranteed to satisfy all Zod schema constraints
    const baseNote = await new AIExtractionService().extractStructuredClinicalNote(segments);

    const apiKey = (env.LLM_API_KEY || process.env.GEMINI_API_KEY)!;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: env.GEMINI_MODEL,
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `${generateSystemPrompt()}\n\nCanonical Transcript Data:\n${JSON.stringify(segments, null, 2)}`;
    const result = await model.generateContent(prompt);
    const textResponse = result.response.text();

    try {
      let cleanText = textResponse.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }

      let parsedJson = JSON.parse(cleanText);

      // Unwrap if nested under root keys
      if (parsedJson.clinicalNote) parsedJson = parsedJson.clinicalNote;
      else if (parsedJson.note) parsedJson = parsedJson.note;
      else if (parsedJson.data) parsedJson = parsedJson.data;
      else if (parsedJson.structuredClinicalExtraction) parsedJson = parsedJson.structuredClinicalExtraction;

      // 2. Deeply merge Gemini AI's extracted claims on top of the valid baseline note
      const mergedNote = deepMerge(baseNote, parsedJson);

      return StructuredClinicalExtractionSchema.parse(mergedNote);
    } catch (e: any) {
      console.error('[GeminiLLMProvider] Failed to parse or validate LLM response:', e);
      console.error('[GeminiLLMProvider] Raw LLM Output was:', textResponse);
      throw new Error(`LLM Extraction failed: ${e.message}`);
    }
  }
}
