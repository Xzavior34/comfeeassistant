import { LLMProvider, LLMHealthCheckResult } from './LLMProvider';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../types';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

export interface DiscoveredModelInfo {
  modelName: string;
  isExplicit: boolean;
  selectionMethod: 'explicit' | 'dynamic_discovered' | 'fallback_selected';
  eligibleModelsCount: number;
}

/** Model families acceptable for clinical drafting, in order of preference. */
const MODEL_PREFERENCE = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite'
];

let resolvedModelCache: DiscoveredModelInfo | null = null;

export async function testMinimalModelGeneration(apiKey: string, modelName: string): Promise<boolean> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: 'application/json' }
    });
    const result = await model.generateContent('Return JSON: {"status":"ok"}');
    const text = result.response?.text?.();
    return Boolean(text && text.includes('ok'));
  } catch (err: any) {
    console.warn(`[gemini] Minimal test failed for "${modelName}": ${err?.message || err}`);
    return false;
  }
}

/**
 * Picks a model that the API key can actually use.
 *
 * When GEMINI_MODEL is explicitly set in the environment, that exact model is attempted.
 * When GEMINI_MODEL is unset (undefined or empty), dynamic discovery queries the live
 * Google AI Studio /v1beta/models endpoint for models available to THIS key, filtering for
 * generateContent capability and structured JSON suitability.
 */
export async function resolveAvailableModel(
  apiKey: string,
  configuredModel?: string,
  forceRefresh = false
): Promise<DiscoveredModelInfo> {
  if (resolvedModelCache && !forceRefresh) return resolvedModelCache;

  const isExplicit = Boolean(configuredModel && configuredModel.trim().length > 0);

  if (isExplicit) {
    const explicitName = configuredModel!.trim().replace(/^models\//, '');
    const info: DiscoveredModelInfo = {
      modelName: explicitName,
      isExplicit: true,
      selectionMethod: 'explicit',
      eligibleModelsCount: 1
    };
    resolvedModelCache = info;
    return info;
  }

  // GEMINI_MODEL is UNSET -> Perform dynamic discovery
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) {
      console.warn(`[gemini] ListModels returned HTTP ${res.status}`);
      throw new Error(`ListModels HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const rawModels: any[] = Array.isArray(data?.models) ? data.models : [];

    const candidateModels: string[] = rawModels
      .filter((m: any) => {
        const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        if (!methods.includes('generateContent')) return false;

        const name = String(m.name || '').toLowerCase();
        if (name.includes('embedding') || name.includes('imagen') || name.includes('bison') || name.includes('gemini-1.0')) {
          return false;
        }
        return true;
      })
      .map((m: any) => String(m.name).replace(/^models\//, ''));

    if (candidateModels.length === 0) {
      throw new Error('No compatible Gemini models supporting generateContent are available for this API key');
    }

    let selected: string | null = null;
    let method: 'dynamic_discovered' | 'fallback_selected' = 'dynamic_discovered';

    for (const pref of MODEL_PREFERENCE) {
      const match = candidateModels.find((m) => m === pref) ?? candidateModels.find((m) => m.startsWith(pref));
      if (match) {
        selected = match;
        break;
      }
    }

    if (!selected) {
      selected = candidateModels[0];
      method = 'fallback_selected';
    }

    console.log(
      `[gemini] Dynamic discovery found ${candidateModels.length} eligible model(s). Selected "${selected}" (method: ${method}).`
    );

    const info: DiscoveredModelInfo = {
      modelName: selected,
      isExplicit: false,
      selectionMethod: method,
      eligibleModelsCount: candidateModels.length
    };

    resolvedModelCache = info;
    return info;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    console.warn(`[gemini] Dynamic model discovery failed (${msg}); defaulting to "gemini-1.5-flash".`);
    const info: DiscoveredModelInfo = {
      modelName: 'gemini-1.5-flash',
      isExplicit: false,
      selectionMethod: 'fallback_selected',
      eligibleModelsCount: 0
    };
    resolvedModelCache = info;
    return info;
  }
}

/** Reset the memoised model choice. Used by tests and after errors. */
export function resetModelCache(): void {
  resolvedModelCache = null;
}

const NOT_DOCUMENTED = 'Not documented during this session.';

function notStated(): any[] {
  return [{ value: NOT_DOCUMENTED, evidence: [], confidence: 'LOW', sourceClassification: 'NOT_STATED' }];
}

function isClaim(v: any): boolean {
  return v && typeof v === 'object' && typeof v.value === 'string';
}

/**
 * Merges the model's note onto the schema-complete skeleton.
 *
 * The previous deepMerge replaced any skeleton array with the model's array whenever the
 * model's array was non-empty, with no check that the entries were even claims. Malformed
 * or ungrounded model output therefore overwrote valid structure silently. Here the model
 * supplies content only where it produced well-formed claims; everything else keeps the
 * skeleton's explicit "not documented" marker.
 */
export function mergeModelNote(skeleton: any, model: any): any {
  if (model === null || model === undefined) return skeleton;

  if (Array.isArray(skeleton)) {
    if (!Array.isArray(model)) return skeleton;
    const valid = model.filter(isClaim);
    return valid.length > 0 ? valid : skeleton;
  }

  if (typeof skeleton === 'object' && skeleton !== null) {
    if (typeof model !== 'object' || Array.isArray(model)) return skeleton;
    const out: any = { ...skeleton };
    for (const key of Object.keys(skeleton)) {
      if (key in model) out[key] = mergeModelNote(skeleton[key], model[key]);
    }
    return out;
  }

  return model === undefined ? skeleton : model;
}

/**
 * Drops model claims whose evidence does not resolve to a real transcript segment, and
 * repairs recoverable evidence (correct segment id, drifted timestamps or paraphrased
 * sourceText). A claim that cannot be tied to the transcript never reaches the note.
 */
export function groundClaims(
  node: any,
  segmentMap: Map<string, CanonicalTranscriptSegment>,
  dropped: string[]
): any {
  if (Array.isArray(node)) {
    if (node.length > 0 && isClaim(node[0])) {
      const kept = node.filter((claim: any) => {
        if (claim.value === NOT_DOCUMENTED || claim.sourceClassification === 'NOT_STATED') return true;

        const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
        const valid = evidence.filter((ev: any) => ev && segmentMap.has(ev.segmentId));

        if (valid.length === 0) {
          dropped.push(claim.value);
          return false;
        }

        // Re-anchor evidence to the authoritative segment so downstream validation and the
        // clinician's playback both land on the real audio.
        claim.evidence = valid.map((ev: any) => {
          const seg = segmentMap.get(ev.segmentId)!;
          return {
            segmentId: seg.id,
            startTimeMs: seg.startTimeMs,
            endTimeMs: seg.endTimeMs,
            sourceText: seg.text
          };
        });
        return true;
      });

      return kept.length > 0 ? kept : notStated();
    }
    return node;
  }

  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      node[key] = groundClaims(node[key], segmentMap, dropped);
    }
  }

  return node;
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    return t.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```$/, '').trim();
  }
  return t;
}

function unwrapRoot(parsed: any): any {
  for (const key of ['clinicalNote', 'note', 'data', 'structuredClinicalExtraction', 'output']) {
    if (parsed && typeof parsed === 'object' && parsed[key] && typeof parsed[key] === 'object') {
      return parsed[key];
    }
  }
  return parsed;
}

/**
 * Only the fields the model should author are sent to it. Timestamps, ids and speaker
 * roles are the system's, not the model's, and shipping the full canonical object
 * encouraged the model to echo internal metadata back as clinical content.
 */
function transcriptForModel(segments: CanonicalTranscriptSegment[]) {
  return segments.map((s) => ({
    segmentId: s.id,
    startTimeMs: s.startTimeMs,
    endTimeMs: s.endTimeMs,
    speaker: s.mappedRole ?? 'UNATTRIBUTED',
    text: s.text,
    transcriptionConfidence:
      s.confidence === null || s.confidence === undefined ? 'UNKNOWN' : s.confidence,
    rapidSpeech: !!s.rapidSpeechDetected
  }));
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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      );
      if (!response.ok) {
        return {
          status: 'CONNECTION FAILED',
          providerName: this.name,
          details: `Gemini ListModels returned HTTP ${response.status}`
        };
      }

      const data: any = await response.json();
      const availableModels: string[] = (data.models ?? []).map((m: any) => m.name);
      const activeInfo = await resolveAvailableModel(apiKey, env.GEMINI_MODEL);

      return {
        status: 'CONNECTED',
        providerName: this.name,
        details: `Active model: ${activeInfo.modelName} (method: ${activeInfo.selectionMethod}, eligible: ${activeInfo.eligibleModelsCount})`,
        availableModels
      };
    } catch (err: any) {
      return {
        status: 'CONNECTION FAILED',
        providerName: this.name,
        details: `Gemini API connection failed: ${err?.message ?? err}`
      };
    }
  }


  /**
   * Pass 1 — context-aware transcript repair.
   *
   * Never fatal: if the repair call fails the original transcript is used unchanged, since
   * a slightly misheard transcript is far better than no note at all.
   */
  private async repairTranscript(
    model: any,
    segments: CanonicalTranscriptSegment[],
    notes: string[]
  ): Promise<CanonicalTranscriptSegment[]> {
    try {
      const result = await model.generateContent(buildTranscriptRepairPrompt(segments));
      const parsed = JSON.parse(stripCodeFence(result.response.text()));
      const corrections: TranscriptCorrection[] = Array.isArray(parsed?.corrections)
        ? parsed.corrections
        : [];

      if (corrections.length === 0) return segments;

      const { segments: repaired, applied, refused } = applyRepairs(segments, corrections);

      if (applied.length > 0) {
        notes.push(
          `${applied.length} probable speech-recognition error(s) in clinical terminology were ` +
            'corrected from context. The original wording is retained as evidence against each statement.'
        );
      }
      if (refused.length > 0) {
        notes.push(
          `${refused.length} proposed transcript correction(s) were rejected for altering a ` +
            'number, negation or laterality, and the original wording was kept.'
        );
      }

      return repaired;
    } catch (err: any) {
      console.warn(`[GeminiLLMProvider] Transcript repair pass skipped: ${err?.message ?? err}`);
      return segments;
    }
  }

  /**
   * Pass 3 — completeness and depth review.
   *
   * A single generation reliably produces a strong opening and a thin closing third, and the
   * thin third is the reasoning and the plan. This pass re-reads the draft against the
   * transcript and fills in detail that the transcript supports. Revisions go through the
   * same grounding check as the first pass, so nothing invented survives it.
   *
   * Never fatal: a first-pass note is a usable note.
   */
  private async deepenNote(
    model: any,
    note: any,
    segments: CanonicalTranscriptSegment[],
    segmentMap: Map<string, CanonicalTranscriptSegment>,
    dropped: string[]
  ): Promise<any> {
    const before = measureNoteDepth(note);

    try {
      const result = await model.generateContent(buildCompletenessPrompt(note, segments));
      const parsed = JSON.parse(stripCodeFence(result.response.text()));

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
          `[GeminiLLMProvider] Completeness pass deepened the note: ` +
            `${before.totalWords} to ${after.totalWords} words across ` +
            `${after.populatedFields} populated fields.`
        );
      }

      return revised;
    } catch (err: any) {
      console.warn(`[GeminiLLMProvider] Completeness pass skipped: ${err?.message ?? err}`);
      return note;
    }
  }

  async extractStructuredNote(
    segments: CanonicalTranscriptSegment[]
  ): Promise<StructuredClinicalExtraction> {
    if (!segments || segments.length === 0) {
      throw new Error(
        '[GeminiLLMProvider] No transcript segments supplied. A clinical note cannot be ' +
          'generated without a transcript.'
      );
    }

    const apiKey = env.LLM_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('[GeminiLLMProvider] Missing LLM_API_KEY / GEMINI_API_KEY.');
    }

    const modelInfo = await resolveAvailableModel(apiKey, env.GEMINI_MODEL);
    const modelName = modelInfo.modelName;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        // Clinical documentation must be reproducible; sampling variety is a defect here.
        temperature: 0,
        topP: 0.1,
        // A full initial wheelchair assessment written at specialist depth does not fit in
        // 8k tokens. Truncation here silently drops the final sections, which are the
        // reasoning and the plan.
        maxOutputTokens: 32768
      }
    });

    // Pass 1: context-aware repair of clinical mishearings the lexicon has no rule for.
    const repairNotes: string[] = [];
    const workingSegments = await this.repairTranscript(model, segments, repairNotes);

    // Schema-complete skeleton. Every field the model does not fill keeps an explicit
    // "not documented" marker instead of disappearing.
    const skeleton = await new AIExtractionService().extractStructuredClinicalNote(workingSegments);

    const prompt =
      `${generateSystemPrompt()}\n\n` +
      `TRANSCRIPT (segmentId values below are the ONLY valid evidence references):\n` +
      `${JSON.stringify(transcriptForModel(workingSegments), null, 2)}\n\n` +
      `Return the JSON object now.`;

    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const raw = result.response.text();
        const parsed = unwrapRoot(JSON.parse(stripCodeFence(raw)));

        const merged = mergeModelNote(skeleton, parsed);

        const segmentMap = new Map(workingSegments.map((s) => [s.id, s]));
        const dropped: string[] = [];
        let grounded = groundClaims(merged, segmentMap, dropped);

        // Pass 3: review the draft against the transcript and deepen what is too thin to
        // be clinically useful. Only ever adds detail already present in the transcript.
        grounded = await this.deepenNote(model, grounded, workingSegments, segmentMap, dropped);

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
          grounded.clinicianReviewFlags = [
            ...(grounded.clinicianReviewFlags ?? []),
            {
              flagType: 'OTHER',
              description:
                `Ungrounded statements removed before review: ${dropped.slice(0, 5).join(' | ')}` +
                (dropped.length > 5 ? ` (+${dropped.length - 5} more)` : ''),
              segmentIds: []
            }
          ];
        }

        return StructuredClinicalExtractionSchema.parse(grounded);
      } catch (err: any) {
        lastError = err;
        console.error(`[GeminiLLMProvider] Attempt ${attempt}/3 failed: ${err?.message ?? err}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }

    console.error(
      '[GeminiLLMProvider] All attempts failed; returning the deterministic fallback draft, ' +
        'clearly marked for full clinician authoring.'
    );
    const fallback: any = { ...skeleton };
    fallback.warnings = {
      ...(fallback.warnings ?? { warningMessages: [] }),
      geminiProcessingFailure: true,
      deterministicFallbackUsed: true,
      warningMessages: [
        ...(fallback.warnings?.warningMessages ?? []),
        `Clinical language model unavailable (${lastError?.message ?? 'unknown error'}).`
      ]
    };
    return StructuredClinicalExtractionSchema.parse(fallback);
  }
}
