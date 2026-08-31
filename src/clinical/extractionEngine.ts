import {
  StructuredExtraction,
  StructuredExtractionSchema,
  ClinicalFact,
  ReviewFlag,
  SECTION_IDS
} from './provenance';
import {
  buildExtractionPrompt,
  buildRepairPrompt,
  wrapTranscript,
  EXTRACTION_PROMPT_VERSION
} from './extractionPrompt';

export { EXTRACTION_PROMPT_VERSION };

/**
 * Turns a frozen consultation transcript into validated structured clinical facts.
 *
 * Three things this deliberately does not do. It does not write prose — the narrative is a
 * separate step over validated data. It does not summarise chunks and stitch the summaries
 * together, because that loses exactly the measurements, qualifiers and contradictions the
 * record exists to preserve; instead each chunk yields facts, and the facts are merged. And
 * it does not accept malformed output: invalid structure triggers a bounded repair round,
 * then fails honestly.
 */

/** Anything the model layer must provide. Keeps this engine testable without a network. */
export interface ModelClient {
  /** Identifier recorded against the generated note. */
  name?: string;
  /** Returns raw model text for a system instruction plus user content. */
  generate(systemInstruction: string, userContent: string): Promise<string>;
}

export interface ExtractionOptions {
  /**
   * Characters of transcript per extraction call. Chosen well below the model's context so
   * the system instruction, the transcript and a large structured response all fit with
   * room to spare.
   */
  chunkCharBudget?: number;
  /** Overlap between chunks so a fact spanning a boundary is not lost. */
  chunkOverlapChars?: number;
  maxRepairAttempts?: number;
  onProgress?: (stage: string, progress: number) => void;
}

export interface ExtractionResult {
  extraction: StructuredExtraction;
  chunksProcessed: number;
  repairAttempts: number;
  /** Facts dropped because their quote could not be found in the transcript. */
  ungroundedDropped: string[];
  promptVersion: string;
}

/**
 * Chunking defaults.
 *
 * The system instruction is roughly 3,250 tokens and is re-sent with every chunk, because
 * the API is stateless. That fixed overhead, not the transcript, dominates the cost of a
 * consultation: at a 24,000-character budget a 60-minute assessment split into three chunks
 * paid it three times before a word of transcript was billed.
 *
 * 48,000 characters is roughly a 55-minute consultation, so most assessments now extract in
 * a single call and a long one in two. The ceiling is the completion limit rather than the
 * context window — one chunk still has to emit every fact it finds — which is why the
 * provider now sets max_tokens explicitly.
 *
 * Override with EXTRACTION_CHUNK_CHARS if a deployment's model has a smaller output budget.
 */
const DEFAULTS = {
  chunkCharBudget: Number(process.env.EXTRACTION_CHUNK_CHARS) > 0
    ? Number(process.env.EXTRACTION_CHUNK_CHARS)
    : 48000,
  chunkOverlapChars: 1200,
  maxRepairAttempts: 2
};

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Splits a transcript at sentence boundaries, with overlap.
 *
 * Truncating a long consultation from the end would discard the plan and follow-up, which
 * are the sections a clinician most needs. Every part of the transcript is processed.
 */
export function chunkTranscript(
  text: string,
  budget = DEFAULTS.chunkCharBudget,
  overlap = DEFAULTS.chunkOverlapChars
): string[] {
  const clean = text.trim();
  if (clean.length <= budget) return clean.length > 0 ? [clean] : [];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < clean.length) {
    let end = Math.min(cursor + budget, clean.length);

    if (end < clean.length) {
      // Prefer a sentence boundary in the last fifth of the window.
      const window = clean.slice(cursor + Math.floor(budget * 0.8), end);
      const lastStop = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('? '),
        window.lastIndexOf('! ')
      );
      if (lastStop > 0) end = cursor + Math.floor(budget * 0.8) + lastStop + 1;
    }

    chunks.push(clean.slice(cursor, end).trim());
    if (end >= clean.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }

  return chunks.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

/** Loose normalisation so quoting differences in punctuation or spacing do not fail a match. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'" ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the quote genuinely appears in the transcript.
 *
 * A short quote must match outright. A long quote is allowed a looser test, because models
 * reliably drop a filler word mid-sentence when quoting and rejecting the whole fact for
 * that would throw away good clinical content.
 */
export function isQuoteGrounded(quote: string, transcript: string): boolean {
  const q = normalise(quote);
  const t = normalise(transcript);
  if (q.length === 0) return false;
  if (t.includes(q)) return true;

  const words = q.split(' ').filter((w) => w.length > 3);
  if (words.length < 4) return false;

  const present = words.filter((w) => t.includes(w)).length;
  return present / words.length >= 0.8;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function factKey(f: ClinicalFact): string {
  return `${f.section_id}::${f.field_id}`;
}

/** Ranks certainty so a merge keeps the better-evidenced version of a duplicated fact. */
const CERTAINTY_RANK: Record<string, number> = {
  MEASURED: 6,
  OBSERVED: 5,
  CONFIRMED: 5,
  REPORTED: 4,
  DENIED_ABSENT: 4,
  CONTRADICTORY: 3,
  UNCERTAIN: 2,
  PENDING: 2,
  NOT_ASSESSED: 1,
  NOT_DISCUSSED: 0
};

/**
 * Merges facts from overlapping chunks.
 *
 * Chunk overlap means the same statement can be extracted twice. Duplicates are collapsed on
 * section and field, keeping the richer version. Two facts that share a field but genuinely
 * disagree are NOT collapsed — that is a contradiction, and both survive with a flag.
 */
export function mergeFacts(batches: ClinicalFact[][]): {
  facts: ClinicalFact[];
  generatedFlags: ReviewFlag[];
} {
  const byKey = new Map<string, ClinicalFact[]>();

  for (const batch of batches) {
    for (const fact of batch) {
      const key = factKey(fact);
      const existing = byKey.get(key) ?? [];
      existing.push(fact);
      byKey.set(key, existing);
    }
  }

  const facts: ClinicalFact[] = [];
  const generatedFlags: ReviewFlag[] = [];

  for (const [key, group] of byKey) {
    if (group.length === 1) {
      facts.push(group[0]);
      continue;
    }

    // Identical restatements of the same value: keep the best-evidenced one.
    const distinct: ClinicalFact[] = [];
    for (const fact of group) {
      const same = distinct.find((d) => normalise(d.value) === normalise(fact.value));
      if (!same) {
        distinct.push(fact);
      } else if ((CERTAINTY_RANK[fact.certainty] ?? 0) > (CERTAINTY_RANK[same.certainty] ?? 0)) {
        distinct[distinct.indexOf(same)] = fact;
      }
    }

    if (distinct.length === 1) {
      facts.push(distinct[0]);
      continue;
    }

    // Genuinely different values for the same field. Keep every one and flag it: choosing
    // between them is a clinical judgement, not a merge rule.
    for (const fact of distinct) {
      facts.push({ ...fact, certainty: 'CONTRADICTORY', requires_review: true });
    }
    generatedFlags.push({
      flag_type: 'CONTRADICTION',
      description:
        `Conflicting information recorded for ${key.replace('::', ' / ')}: ` +
        distinct.map((d) => `"${d.value}"`).join(' versus '),
      section_id: distinct[0].section_id,
      source_quotes: distinct.map((d) => d.source_quote).filter(Boolean),
      resolved: false
    });
  }

  return { facts, generatedFlags };
}

function dedupeFlags(flags: ReviewFlag[]): ReviewFlag[] {
  const seen = new Set<string>();
  const out: ReviewFlag[] = [];
  for (const flag of flags) {
    const key = `${flag.flag_type}::${normalise(flag.description)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(flag);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

export function stripFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```$/, '').trim();
}

function parseAndValidate(raw: string): { ok: true; value: StructuredExtraction } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch (err: any) {
    return { ok: false, errors: [`Response is not valid JSON: ${err?.message ?? err}`] };
  }

  const result = StructuredExtractionSchema.safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };

  return {
    ok: false,
    errors: result.error.issues.slice(0, 25).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ClinicalExtractionEngine {
  constructor(private model: ModelClient) {}

  async extract(transcript: string, options: ExtractionOptions = {}): Promise<ExtractionResult> {
    const opts = { ...DEFAULTS, ...options };
    const text = transcript.trim();

    if (text.length === 0) {
      throw new Error(
        'The transcript is empty, so there is nothing to document. The consultation recording ' +
          'was not lost — no clinical note can be generated from an empty transcript.'
      );
    }

    const chunks = chunkTranscript(text, opts.chunkCharBudget, opts.chunkOverlapChars);
    const systemInstruction = buildExtractionPrompt();

    const batches: ClinicalFact[][] = [];
    const allFlags: ReviewFlag[] = [];
    const notDiscussed = new Set<string>();
    const ungroundedDropped: string[] = [];
    let repairAttempts = 0;

    for (let i = 0; i < chunks.length; i++) {
      opts.onProgress?.(
        chunks.length > 1
          ? `Extracting clinical information (part ${i + 1} of ${chunks.length})`
          : 'Extracting clinical information',
        Math.round(((i + 1) / (chunks.length + 1)) * 70)
      );

      const userContent =
        (chunks.length > 1
          ? `This is part ${i + 1} of ${chunks.length} of one consultation. Extract only what ` +
            `this part establishes. Do not speculate about the other parts.\n\n`
          : '') + wrapTranscript(chunks[i]);

      const { extraction, attempts } = await this.extractOne(systemInstruction, userContent, opts.maxRepairAttempts);
      repairAttempts += attempts;

      // Grounding: a fact whose quote is not in the transcript is not documentation, it is
      // invention, and it never reaches the clinician.
      const grounded = extraction.facts.filter((f) => {
        if (f.certainty === 'NOT_DISCUSSED' || f.certainty === 'NOT_ASSESSED') return true;
        if (isQuoteGrounded(f.source_quote, chunks[i])) return true;
        ungroundedDropped.push(f.value);
        return false;
      });

      batches.push(grounded.filter((f) => SECTION_IDS.includes(f.section_id)));
      allFlags.push(...extraction.review_flags);
      extraction.sections_not_discussed.forEach((s) => notDiscussed.add(s));
    }

    opts.onProgress?.('Merging and checking for contradictions', 80);

    const { facts, generatedFlags } = mergeFacts(batches);
    const flags = dedupeFlags([...allFlags, ...generatedFlags]);

    if (ungroundedDropped.length > 0) {
      flags.push({
        flag_type: 'OTHER',
        description:
          `${ungroundedDropped.length} generated statement(s) were removed because they could ` +
          'not be traced to anything said in the consultation.',
        section_id: null,
        source_quotes: [],
        resolved: false
      });
    }

    // A section is only "not discussed" if nothing was extracted for it anywhere.
    const covered = new Set(facts.map((f) => f.section_id));
    const finalNotDiscussed = SECTION_IDS.filter((id) => !covered.has(id));

    return {
      extraction: {
        facts,
        review_flags: flags,
        sections_not_discussed: finalNotDiscussed
      },
      chunksProcessed: chunks.length,
      repairAttempts,
      ungroundedDropped,
      promptVersion: EXTRACTION_PROMPT_VERSION
    };
  }

  /** One chunk, with bounded schema repair. Never loops indefinitely. */
  private async extractOne(
    systemInstruction: string,
    userContent: string,
    maxRepairAttempts: number
  ): Promise<{ extraction: StructuredExtraction; attempts: number }> {
    let raw = await this.model.generate(systemInstruction, userContent);
    let validated = parseAndValidate(raw);
    let attempts = 0;

    while (!validated.ok && attempts < maxRepairAttempts) {
      attempts++;
      raw = await this.model.generate(systemInstruction, buildRepairPrompt(validated.errors, raw));
      validated = parseAndValidate(raw);
    }

    if (!validated.ok) {
      throw new Error(
        `The clinical model returned structured data that does not match the required schema ` +
          `after ${attempts} repair attempt(s). First errors: ${validated.errors.slice(0, 3).join('; ')}`
      );
    }

    return { extraction: validated.value, attempts };
  }
}
