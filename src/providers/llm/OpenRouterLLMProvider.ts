import { LLMProvider, LLMHealthCheckResult } from './LLMProvider';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../types';
import { env } from '../../config/env';
import {
  StructuredClinicalExtractionSchema,
  AIExtractionService,
  generateSystemPrompt,
  PROMPT_VERSION
} from '../../services/aiExtraction';
import {
  buildTranscriptRepairPrompt,
  buildCompletenessPrompt,
  applyRepairs,
  measureNoteDepth,
  TranscriptCorrection
} from '../../services/clinicalPasses';
import { groundClaims, mergeModelNote, unwrapRoot, transcriptForModel } from './GeminiLLMProvider';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const OPENROUTER_DEFAULT_CANDIDATES = [
  'google/gemini-2.0-flash-exp',
  'google/gemini-flash-1.5',
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-haiku',
  'meta-llama/llama-3.3-70b-instruct'
];

export class OpenRouterModelClient {
  public name: string;

  constructor(
    private apiKey: string,
    private modelName: string = 'google/gemini-2.0-flash-exp'
  ) {
    this.name = `OpenRouter:${modelName}`;
  }

  async generate(systemInstruction: string, userContent: string): Promise<string> {
    const candidates = Array.from(
      new Set([this.modelName, ...OPENROUTER_DEFAULT_CANDIDATES].filter(Boolean))
    );

    let lastError: any = null;

    for (const candidate of candidates) {
      const payload = {
        model: candidate,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userContent }
        ],
        temperature: 0,
        top_p: 0.1,
        response_format: { type: 'json_object' }
      };

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://comfeeassistant.vercel.app',
              'X-Title': 'Vabatim UK Wheelchair & Seating AI Assistant'
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const status = response.status;
            const is404 = status === 404 || /No endpoints found/i.test(errText);

            if (is404) {
              console.warn(
                `[OpenRouter] Candidate model "${candidate}" returned HTTP 404 (No endpoints). Trying next candidate...`
              );
              lastError = new Error(`OpenRouter HTTP 404 for ${candidate}: ${errText.slice(0, 150)}`);
              break; // Break attempt loop to try next candidate model
            }

            throw new Error(`OpenRouter HTTP ${status}: ${errText.slice(0, 200)}`);
          }

          const data: any = await response.json();
          const content = data?.choices?.[0]?.message?.content;
          if (!content || typeof content !== 'string') {
            throw new Error('OpenRouter returned empty or invalid choices array');
          }

          if (this.modelName !== candidate) {
            console.log(`[OpenRouter] Successfully verified working model "${candidate}".`);
            this.modelName = candidate;
            this.name = `OpenRouter:${candidate}`;
          }

          return content;
        } catch (err: any) {
          lastError = err;
          console.warn(`[OpenRouter] Model "${candidate}" attempt ${attempt}/2 failed: ${err?.message ?? err}`);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
    }

    throw lastError || new Error('All OpenRouter candidate models failed');
  }
}

export class OpenRouterLLMProvider implements LLMProvider {
  public name = 'OpenRouter';

  private getApiKey(): string {
    const key = env.OPENROUTER_API_KEY || env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error('[OpenRouterLLMProvider] Missing OPENROUTER_API_KEY.');
    }
    return key;
  }

  private getModelName(): string {
    return env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp';
  }

  async checkHealth(): Promise<LLMHealthCheckResult> {
    try {
      const apiKey = this.getApiKey();
      const client = new OpenRouterModelClient(apiKey, this.getModelName());
      const response = await client.generate(
        'You are a health check probe. Return valid JSON.',
        'Return JSON: {"status":"ok"}'
      );

      if (response && response.includes('ok')) {
        return {
          status: 'CONNECTED',
          providerName: `OpenRouter (${this.getModelName()})`,
          details: 'Successfully connected and verified via OpenRouter API'
        };
      }

      return {
        status: 'CONNECTION FAILED',
        providerName: `OpenRouter (${this.getModelName()})`,
        details: 'Probe call did not return expected status'
      };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/Missing OPENROUTER_API_KEY/i.test(msg)) {
        return {
          status: 'NOT CONFIGURED',
          providerName: 'OpenRouter',
          details: 'OPENROUTER_API_KEY is missing from environment'
        };
      }

      return {
        status: 'CONNECTION FAILED',
        providerName: `OpenRouter (${this.getModelName()})`,
        details: msg
      };
    }
  }

  private stripCodeFence(text: string): string {
    const t = text.trim();
    if (!t.startsWith('```')) return t;
    return t.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```$/, '').trim();
  }

  private async repairTranscript(
    client: OpenRouterModelClient,
    segments: CanonicalTranscriptSegment[],
    notes: string[]
  ): Promise<CanonicalTranscriptSegment[]> {
    try {
      const raw = await client.generate(
        'You are a clinical speech recognition transcript repair engine. Return valid JSON.',
        buildTranscriptRepairPrompt(segments)
      );
      const parsed = JSON.parse(this.stripCodeFence(raw));
      const corrections: TranscriptCorrection[] = Array.isArray(parsed?.corrections)
        ? parsed.corrections
        : [];

      if (corrections.length === 0) return segments;

      const { segments: repaired, applied, refused } = applyRepairs(segments, corrections);

      if (applied.length > 0) {
        notes.push(
          `${applied.length} probable speech-recognition error(s) in clinical terminology were ` +
            'corrected from context.'
        );
      }
      if (refused.length > 0) {
        notes.push(
          `${refused.length} proposed transcript correction(s) were rejected for altering numbers or negations.`
        );
      }

      return repaired;
    } catch (err: any) {
      console.warn(`[OpenRouterLLMProvider] Transcript repair pass skipped: ${err?.message ?? err}`);
      return segments;
    }
  }

  private async deepenNote(
    client: OpenRouterModelClient,
    note: any,
    segments: CanonicalTranscriptSegment[],
    segmentMap: Map<string, CanonicalTranscriptSegment>,
    dropped: string[]
  ): Promise<any> {
    const before = measureNoteDepth(note);

    try {
      const raw = await client.generate(
        'You are a clinical completeness reviewer. Return valid JSON.',
        buildCompletenessPrompt(note, segments)
      );
      const parsed = JSON.parse(this.stripCodeFence(raw));

      const revisions = parsed?.revisions;
      const additionalFlags = Array.isArray(parsed?.additionalFlags) ? parsed.additionalFlags : [];

      let revised = note;
      if (revisions && typeof revisions === 'object' && Object.keys(revisions).length > 0) {
        revised = groundClaims(mergeModelNote(note, revisions), segmentMap, dropped);
      }

      if (additionalFlags.length > 0) {
        revised.clinicianReviewFlags = [
          ...(revised.clinicianReviewFlags ?? []),
          ...additionalFlags.filter((f: any) => f && typeof f.description === 'string')
        ];
      }

      const after = measureNoteDepth(revised);
      if (after.totalWords > before.totalWords) {
        console.log(
          `[OpenRouterLLMProvider] Completeness pass deepened note from ${before.totalWords} to ${after.totalWords} words.`
        );
      }

      return revised;
    } catch (err: any) {
      console.warn(`[OpenRouterLLMProvider] Completeness pass skipped: ${err?.message ?? err}`);
      return note;
    }
  }

  async extractStructuredNote(
    segments: CanonicalTranscriptSegment[]
  ): Promise<StructuredClinicalExtraction> {
    if (!segments || segments.length === 0) {
      throw new Error(
        '[OpenRouterLLMProvider] No transcript segments supplied. A clinical note cannot be ' +
          'generated without a transcript.'
      );
    }

    const apiKey = this.getApiKey();
    const modelName = this.getModelName();
    const client = new OpenRouterModelClient(apiKey, modelName);

    const repairNotes: string[] = [];
    // Credit Optimization: Only run transcript pre-repair pass for long or dense transcripts
    const workingSegments = segments.length > 20
      ? await this.repairTranscript(client, segments, repairNotes)
      : segments;

    const skeleton = await new AIExtractionService().extractStructuredClinicalNote(workingSegments);

    const userPrompt =
      `TRANSCRIPT (segmentId values below are the ONLY valid evidence references):\n` +
      `${JSON.stringify(transcriptForModel(workingSegments), null, 2)}\n\n` +
      `Return the JSON object now.`;

    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const raw = await client.generate(generateSystemPrompt(), userPrompt);
        const parsed = unwrapRoot(JSON.parse(this.stripCodeFence(raw)));

        const merged = mergeModelNote(skeleton, parsed);

        const segmentMap = new Map(workingSegments.map((s) => [s.id, s]));
        const dropped: string[] = [];
        let grounded = groundClaims(merged, segmentMap, dropped);

        // Credit Optimization: Skip optional deepening pass if primary extraction is already detailed
        const currentDepth = measureNoteDepth(grounded);
        if (currentDepth.totalWords < 60) {
          grounded = await this.deepenNote(client, grounded, workingSegments, segmentMap, dropped);
        }

        grounded.promptVersion = PROMPT_VERSION;
        grounded.warnings = {
          ...(grounded.warnings ?? {}),
          geminiProcessingFailure: false,
          deterministicFallbackUsed: false,
          warningMessages: [
            ...(grounded.warnings?.warningMessages ?? []).filter(
              (m: string) => !m.startsWith('This draft was produced by the deterministic fallback')
            ),
            ...repairNotes
          ]
        };

        if (dropped.length > 0) {
          grounded.warnings.warningMessages.push(
            `${dropped.length} generated statement(s) were removed because they could not be ` +
              'traced to the transcript.'
          );
        }

        return StructuredClinicalExtractionSchema.parse(grounded);
      } catch (err: any) {
        lastError = err;
        console.error(`[OpenRouterLLMProvider] Attempt ${attempt}/3 failed: ${err?.message ?? err}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }

    console.error(
      '[OpenRouterLLMProvider] All attempts failed; returning the deterministic fallback draft.'
    );
    const fallback: any = { ...skeleton };
    fallback.warnings = {
      ...(fallback.warnings ?? { warningMessages: [] }),
      geminiProcessingFailure: true,
      deterministicFallbackUsed: true,
      warningMessages: [
        ...(fallback.warnings?.warningMessages ?? []),
        `OpenRouter language model unavailable (${lastError?.message ?? 'unknown error'}).`
      ]
    };
    return StructuredClinicalExtractionSchema.parse(fallback);
  }
}
