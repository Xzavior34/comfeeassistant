import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';
import { ModelClient } from '../../clinical/extractionEngine';
import { resolveAvailableModel } from './GeminiLLMProvider';

/**
 * The text-only model client the clinical pipeline runs on.
 *
 * Gemini is given text and nothing else. It never receives audio, never sees the microphone,
 * and never runs while the consultation is in progress. Keeping it to text is what makes the
 * cost predictable, the prompt auditable, and the privacy story simple enough to explain to
 * an information-governance team.
 */

export class GeminiModelClient implements ModelClient {
  name = 'gemini';
  private resolvedModel: string | null = null;

  async generate(systemInstruction: string, userContent: string): Promise<string> {
    const apiKey = env.LLM_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'The clinical language model is not configured on this server (no Gemini API key). ' +
          'The transcript has been saved; documentation can be generated once it is configured.'
      );
    }

    if (!this.resolvedModel) {
      this.resolvedModel = await resolveAvailableModel(apiKey, env.GEMINI_MODEL);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: this.resolvedModel,
      systemInstruction,
      generationConfig: {
        responseMimeType: 'application/json',
        // A clinical record must be reproducible. Sampling variety is a defect here.
        temperature: 0,
        topP: 0.1,
        maxOutputTokens: 32768
      }
    });

    return this.callWithRetries(model, userContent);
  }

  /**
   * Handles the failure modes that actually occur, with clinician-readable messages.
   *
   * Rate limiting is the common one on a free-tier key and is genuinely transient, so it is
   * retried with backoff. A safety refusal or a missing model is not transient and is
   * reported immediately rather than burning retries.
   */
  private async callWithRetries(model: any, userContent: string, maxAttempts = 3): Promise<string> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await model.generateContent(userContent);
        const response = result.response;

        const blockReason = response?.promptFeedback?.blockReason;
        if (blockReason) {
          throw new Error(
            `The clinical model declined to process this transcript (${blockReason}). This can ` +
              'happen with clinical language about injury or self-harm. The transcript is saved; ' +
              'please report this so the safety configuration can be reviewed.'
          );
        }

        const text = response?.text?.();
        if (!text || !text.trim()) {
          throw new Error('The clinical model returned an empty response.');
        }
        return text;
      } catch (err: any) {
        lastError = err;
        const message = String(err?.message ?? err);
        const status = err?.status ?? err?.response?.status;

        const rateLimited = status === 429 || /rate limit|quota|RESOURCE_EXHAUSTED/i.test(message);
        const transient = status === 503 || status === 500 || /timeout|ETIMEDOUT|ECONNRESET|overloaded/i.test(message);

        if (/declined to process this transcript/.test(message)) throw err;

        if (status === 404) {
          // The configured model is gone. Re-resolve once rather than failing the whole run.
          this.resolvedModel = null;
          throw new Error(
            'The configured Gemini model is not available to this API key. Leave GEMINI_MODEL ' +
              'unset so the server can select an available model automatically.'
          );
        }

        if (!(rateLimited || transient) || attempt === maxAttempts) break;

        // Free-tier rate limits reset over tens of seconds, so back off meaningfully.
        const waitMs = rateLimited ? Math.min(30000, 4000 * attempt) : 1000 * attempt;
        console.warn(
          `[gemini] Attempt ${attempt}/${maxAttempts} failed (${rateLimited ? 'rate limited' : 'transient'}); ` +
            `retrying in ${waitMs}ms.`
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    const message = String(lastError?.message ?? lastError);
    if (/rate limit|quota|RESOURCE_EXHAUSTED|429/i.test(message)) {
      throw new Error(
        'The clinical model is rate limited on the current API quota. The transcript has been ' +
          'saved — retry documentation generation in a few minutes.'
      );
    }
    throw new Error(`The clinical model could not be reached: ${message}`);
  }
}

let cached: ModelClient | null = null;

export function getClinicalModelClient(): ModelClient {
  if (!cached) cached = new GeminiModelClient();
  return cached;
}

/** Test seam. */
export function setClinicalModelClient(client: ModelClient | null): void {
  cached = client;
}
