"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClinicalExtractionEngine = exports.EXTRACTION_PROMPT_VERSION = void 0;
exports.chunkTranscript = chunkTranscript;
exports.isQuoteGrounded = isQuoteGrounded;
exports.mergeFacts = mergeFacts;
exports.stripFence = stripFence;
const provenance_1 = require("./provenance");
const extractionPrompt_1 = require("./extractionPrompt");
Object.defineProperty(exports, "EXTRACTION_PROMPT_VERSION", { enumerable: true, get: function () { return extractionPrompt_1.EXTRACTION_PROMPT_VERSION; } });
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
function chunkTranscript(text, budget = DEFAULTS.chunkCharBudget, overlap = DEFAULTS.chunkOverlapChars) {
    const clean = text.trim();
    if (clean.length <= budget)
        return clean.length > 0 ? [clean] : [];
    const chunks = [];
    let cursor = 0;
    while (cursor < clean.length) {
        let end = Math.min(cursor + budget, clean.length);
        if (end < clean.length) {
            // Prefer a sentence boundary in the last fifth of the window.
            const window = clean.slice(cursor + Math.floor(budget * 0.8), end);
            const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
            if (lastStop > 0)
                end = cursor + Math.floor(budget * 0.8) + lastStop + 1;
        }
        chunks.push(clean.slice(cursor, end).trim());
        if (end >= clean.length)
            break;
        cursor = Math.max(cursor + 1, end - overlap);
    }
    return chunks.filter((c) => c.length > 0);
}
// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------
/** Loose normalisation so quoting differences in punctuation or spacing do not fail a match. */
function normalise(text) {
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
 *
 * That looser test used to check whether 80% of the quote's words were present ANYWHERE in
 * the whole chunk — which, at the default 48,000-character chunk budget, is most of an hour
 * of consultation. A fabricated sentence built from ordinary clinical vocabulary ("reported",
 * "daily", "months", "severe") only needs those words to occur somewhere in the chunk, not
 * near each other or anywhere close to what the quote actually claims, to pass as "grounded" —
 * this is the only grounding check the live pipeline runs (see documentationService.ts), so a
 * loose version of it is a real fabrication risk, not a cosmetic one. The fix keeps the
 * allowance for a dropped filler word, but requires the matched words to cluster within one
 * bounded window of the transcript, sized to the quote itself, so they have to come from the
 * same passage as the fact they are meant to be evidencing.
 */
function isQuoteGrounded(quote, transcript) {
    const q = normalise(quote);
    const t = normalise(transcript);
    if (q.length === 0)
        return false;
    if (t.includes(q))
        return true;
    const words = q.split(' ').filter((w) => w.length > 3);
    if (words.length < 4)
        return false;
    const windowChars = Math.max(q.length * 2, 200);
    const step = Math.max(1, Math.floor(windowChars / 2));
    for (let start = 0; start < Math.max(t.length, 1); start += step) {
        const window = t.slice(start, start + windowChars);
        if (window.length === 0)
            break;
        const present = words.filter((w) => window.includes(w)).length;
        if (present / words.length >= 0.8)
            return true;
        if (start + windowChars >= t.length)
            break;
    }
    return false;
}
// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------
function factKey(f) {
    return `${f.section_id}::${f.field_id}`;
}
/** Ranks certainty so a merge keeps the better-evidenced version of a duplicated fact. */
const CERTAINTY_RANK = {
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
function mergeFacts(batches) {
    const byKey = new Map();
    for (const batch of batches) {
        for (const fact of batch) {
            const key = factKey(fact);
            const existing = byKey.get(key) ?? [];
            existing.push(fact);
            byKey.set(key, existing);
        }
    }
    const facts = [];
    const generatedFlags = [];
    for (const [key, group] of byKey) {
        if (group.length === 1) {
            facts.push(group[0]);
            continue;
        }
        // Identical restatements of the same value: keep the best-evidenced one.
        const distinct = [];
        for (const fact of group) {
            const same = distinct.find((d) => normalise(d.value) === normalise(fact.value));
            if (!same) {
                distinct.push(fact);
            }
            else if ((CERTAINTY_RANK[fact.certainty] ?? 0) > (CERTAINTY_RANK[same.certainty] ?? 0)) {
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
            description: `Conflicting information recorded for ${key.replace('::', ' / ')}: ` +
                distinct.map((d) => `"${d.value}"`).join(' versus '),
            section_id: distinct[0].section_id,
            source_quotes: distinct.map((d) => d.source_quote).filter(Boolean),
            resolved: false
        });
    }
    return { facts, generatedFlags };
}
function dedupeFlags(flags) {
    const seen = new Set();
    const out = [];
    for (const flag of flags) {
        const key = `${flag.flag_type}::${normalise(flag.description)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(flag);
    }
    return out;
}
// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------
function stripFence(text) {
    const t = text.trim();
    if (!t.startsWith('```'))
        return t;
    return t.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```$/, '').trim();
}
function parseAndValidate(raw) {
    let parsed;
    try {
        parsed = JSON.parse(stripFence(raw));
    }
    catch (err) {
        return { ok: false, errors: [`Response is not valid JSON: ${err?.message ?? err}`] };
    }
    const result = provenance_1.StructuredExtractionSchema.safeParse(parsed);
    if (result.success)
        return { ok: true, value: result.data };
    return {
        ok: false,
        errors: result.error.issues.slice(0, 25).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    };
}
// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
class ClinicalExtractionEngine {
    model;
    constructor(model) {
        this.model = model;
    }
    async extract(transcript, options = {}) {
        const opts = { ...DEFAULTS, ...options };
        const text = transcript.trim();
        if (text.length === 0) {
            throw new Error('The transcript is empty, so there is nothing to document. The consultation recording ' +
                'was not lost — no clinical note can be generated from an empty transcript.');
        }
        const chunks = chunkTranscript(text, opts.chunkCharBudget, opts.chunkOverlapChars);
        const systemInstruction = (0, extractionPrompt_1.buildExtractionPrompt)();
        const batches = [];
        const allFlags = [];
        const notDiscussed = new Set();
        const ungroundedDropped = [];
        let repairAttempts = 0;
        for (let i = 0; i < chunks.length; i++) {
            opts.onProgress?.(chunks.length > 1
                ? `Extracting clinical information (part ${i + 1} of ${chunks.length})`
                : 'Extracting clinical information', Math.round(((i + 1) / (chunks.length + 1)) * 70));
            const userContent = (chunks.length > 1
                ? `This is part ${i + 1} of ${chunks.length} of one consultation. Extract only what ` +
                    `this part establishes. Do not speculate about the other parts.\n\n`
                : '') + (0, extractionPrompt_1.wrapTranscript)(chunks[i]);
            const { extraction, attempts } = await this.extractOne(systemInstruction, userContent, opts.maxRepairAttempts);
            repairAttempts += attempts;
            // Grounding: a fact whose quote is not in the transcript is not documentation, it is
            // invention, and it never reaches the clinician.
            const grounded = extraction.facts.filter((f) => {
                if (f.certainty === 'NOT_DISCUSSED' || f.certainty === 'NOT_ASSESSED')
                    return true;
                if (isQuoteGrounded(f.source_quote, chunks[i]))
                    return true;
                ungroundedDropped.push(f.value);
                return false;
            });
            batches.push(grounded.filter((f) => provenance_1.SECTION_IDS.includes(f.section_id)));
            allFlags.push(...extraction.review_flags);
            extraction.sections_not_discussed.forEach((s) => notDiscussed.add(s));
        }
        opts.onProgress?.('Merging and checking for contradictions', 80);
        const { facts, generatedFlags } = mergeFacts(batches);
        const flags = dedupeFlags([...allFlags, ...generatedFlags]);
        if (ungroundedDropped.length > 0) {
            flags.push({
                flag_type: 'OTHER',
                description: `${ungroundedDropped.length} generated statement(s) were removed because they could ` +
                    'not be traced to anything said in the consultation.',
                section_id: null,
                source_quotes: [],
                resolved: false
            });
        }
        // A section is only "not discussed" if nothing was extracted for it anywhere.
        const covered = new Set(facts.map((f) => f.section_id));
        const finalNotDiscussed = provenance_1.SECTION_IDS.filter((id) => !covered.has(id));
        return {
            extraction: {
                facts,
                review_flags: flags,
                sections_not_discussed: finalNotDiscussed
            },
            chunksProcessed: chunks.length,
            repairAttempts,
            ungroundedDropped,
            promptVersion: extractionPrompt_1.EXTRACTION_PROMPT_VERSION
        };
    }
    /** One chunk, with bounded schema repair. Never loops indefinitely. */
    async extractOne(systemInstruction, userContent, maxRepairAttempts) {
        let raw = await this.model.generate(systemInstruction, userContent);
        let validated = parseAndValidate(raw);
        let attempts = 0;
        while (!validated.ok && attempts < maxRepairAttempts) {
            attempts++;
            raw = await this.model.generate(systemInstruction, (0, extractionPrompt_1.buildRepairPrompt)(validated.errors, raw));
            validated = parseAndValidate(raw);
        }
        if (!validated.ok) {
            throw new Error(`The clinical model returned structured data that does not match the required schema ` +
                `after ${attempts} repair attempt(s). First errors: ${validated.errors.slice(0, 3).join('; ')}`);
        }
        return { extraction: validated.value, attempts };
    }
}
exports.ClinicalExtractionEngine = ClinicalExtractionEngine;
