import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';
import { ModelClient } from '../../clinical/extractionEngine';
import { resolveAvailableModel, resetModelCache, DiscoveredModelInfo } from './GeminiLLMProvider';
import { OpenRouterModelClient } from './OpenRouterLLMProvider';

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
  private resolvedModelInfo: DiscoveredModelInfo | null = null;

  async generate(systemInstruction: string, userContent: string): Promise<string> {
    const apiKey = env.LLM_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'The clinical language model is not configured on this server (no Gemini API key). ' +
          'The transcript has been saved; documentation can be generated once it is configured.'
      );
    }

    if (!this.resolvedModelInfo) {
      this.resolvedModelInfo = await resolveAvailableModel(apiKey, env.GEMINI_MODEL);
    }

    console.log(
      `[gemini] Executing generateContent using model="${this.resolvedModelInfo.modelName}" ` +
        `(method: ${this.resolvedModelInfo.selectionMethod}, explicit: ${this.resolvedModelInfo.isExplicit}).`
    );

    let genAI = new GoogleGenerativeAI(apiKey);
    let model = genAI.getGenerativeModel({
      model: this.resolvedModelInfo.modelName,
      systemInstruction,
      generationConfig: {
        responseMimeType: 'application/json',
        // A clinical record must be reproducible. Sampling variety is a defect here.
        temperature: 0,
        topP: 0.1,
        maxOutputTokens: 32768
      }
    });

    try {
      return await this.callWithRetries(model, userContent);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const message = String(err?.message ?? err);
      const is404 = status === 404 || /404|not found|is not available|is no longer available|retired/i.test(message);

      if (is404 && !this.resolvedModelInfo.isExplicit) {
        console.warn(
          `[gemini] Model "${this.resolvedModelInfo.modelName}" returned 404 during generation. Invalidating cache and re-discovering.`
        );
        const rejected = new Set<string>([this.resolvedModelInfo.modelName]);
        resetModelCache();
        this.resolvedModelInfo = await resolveAvailableModel(apiKey, env.GEMINI_MODEL, true, rejected);

        if (this.resolvedModelInfo) {
          model = genAI.getGenerativeModel({
            model: this.resolvedModelInfo.modelName,
            systemInstruction,
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0,
              topP: 0.1,
              maxOutputTokens: 32768
            }
          });
          return await this.callWithRetries(model, userContent);
        }
      }

      if (/generativelanguage\.googleapis\.com|GoogleGenerativeAI/i.test(message)) {
        throw new Error(
          'Clinical documentation could not be generated because the AI service is temporarily unavailable. ' +
            'Your transcript has been saved — please retry.'
        );
      }
      throw err;
    }
  }

  /**
   * Handles failure modes with safe server diagnostics and clean clinician-readable messages.
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

        const isAuth = status === 401 || status === 403 || /API_KEY_INVALID|PERMISSION_DENIED|unauthorized/i.test(message);
        const isRateLimited = status === 429 || /rate limit|quota|RESOURCE_EXHAUSTED/i.test(message);
        const isNotFound = status === 404 || /not found|is not available|is no longer available|retired/i.test(message);
        const isTransient = status === 503 || status === 500 || /timeout|ETIMEDOUT|ECONNRESET|overloaded/i.test(message);

        console.warn(
          `[gemini] Provider error (attempt ${attempt}/${maxAttempts}): ` +
            `HTTP ${status || 'N/A'}, category=${
              isAuth
                ? 'AUTH'
                : isRateLimited
                ? 'RATE_LIMIT'
                : isNotFound
                ? 'MODEL_NOT_FOUND'
                : isTransient
                ? 'PROVIDER_5XX'
                : 'OTHER'
            }, message="${message.slice(0, 150)}"`
        );

        if (/declined to process this transcript/.test(message)) throw err;

        if (isAuth) {
          throw new Error(
            `Gemini API authentication or permission failed (HTTP ${status || 403}). Check GEMINI_API_KEY environment variable.`
          );
        }

        if (isNotFound) {
          if (this.resolvedModelInfo?.isExplicit) {
            throw new Error(
              `Configured GEMINI_MODEL "${this.resolvedModelInfo.modelName}" is not available to this API key (HTTP 404). Update or unset GEMINI_MODEL.`
            );
          }
          throw new Error(
            'Clinical documentation could not be generated because the AI service is temporarily unavailable. ' +
              'Your transcript has been saved — please retry.'
          );
        }

        if (!(isRateLimited || isTransient) || attempt === maxAttempts) break;

        const waitMs = isRateLimited ? Math.min(30000, 4000 * attempt) : 1000 * attempt;
        console.warn(`[gemini] Retrying in ${waitMs}ms...`);
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
    if (/generativelanguage\.googleapis\.com|GoogleGenerativeAI/i.test(message)) {
      throw new Error(
        'Clinical documentation could not be generated because the AI service is temporarily unavailable. ' +
          'Your transcript has been saved — please retry.'
      );
    }
    throw new Error('Clinical documentation could not be generated because the AI service is temporarily unavailable.');
  }
}

let cached: ModelClient | null = null;

export function getClinicalModelClient(): ModelClient {
  if (cached) return cached;

  if (env.LLM_PROVIDER === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY || env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'The clinical language model is not configured on this server (missing OPENROUTER_API_KEY). ' +
          'The transcript has been saved; documentation can be generated once it is configured.'
      );
    }
    const modelName = env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
    cached = new OpenRouterModelClient(apiKey, modelName);
    return cached;
  }

  cached = new GeminiModelClient();
  return cached;
}

/** Test seam. */
export function setClinicalModelClient(client: ModelClient | null): void {
  cached = client;
}
