/**
 * Clinical lexicon and post-ASR correction engine for UK wheelchair & seating assessment.
 *
 * Consumer speech engines (W3C SpeechRecognition, generic cloud STT models) are trained on
 * general English and systematically mis-hear clinical terminology. This module provides:
 *   1. A phrase list usable as recognition bias / grammar hints.
 *   2. A deterministic, evidence-preserving correction pass applied AFTER recognition.
 *   3. Alternative-hypothesis rescoring, so the alternative containing real clinical
 *      vocabulary is preferred over the engine's top general-English guess.
 *   4. Spoken-number and unit normalisation for measurements.
 *
 * Design rules (Clinical AI Documentation Template, Layer 1):
 *  - Never change clinical meaning. Corrections are lexical only.
 *  - Raw verbatim text is always preserved by the caller as evidence.
 *  - A correction that is not strongly supported is NOT applied; the text is instead
 *    marked uncertain for clinician review.
 */

export interface CorrectionRecord {
  from: string;
  to: string;
  rule: string;
}

export interface CorrectionResult {
  text: string;
  rawText: string;
  corrections: CorrectionRecord[];
  isCorrected: boolean;
  suspectedMishearings: string[];
}

/** Canonical clinical vocabulary: recognition phrase-bias list and rescoring target set. */
export const CLINICAL_PHRASES: string[] = [
  'MAT assessment', 'pelvic obliquity', 'posterior pelvic tilt', 'anterior pelvic tilt',
  'pelvic rotation', 'windswept posture', 'windsweeping', 'scoliosis', 'kyphosis',
  'lordosis', 'kyphoscoliosis', 'trunk lean', 'lateral lean', 'sitting balance',
  'hands-free sitting balance', 'postural asymmetry', 'midline', 'plantigrade',
  'hip abduction', 'hip adduction', 'hip flexion', 'knee extension', 'knee flexion',
  'hamstring length', 'popliteal', 'contracture', 'subluxation', 'tone', 'spasticity',
  'clonus', 'hypertonia', 'hypotonia', 'range of movement', 'passive range',
  'active range', 'proprioception',
  'pressure injury', 'pressure ulcer', 'pressure sore', 'pressure relief',
  'pressure redistribution', 'tissue viability', 'ischial tuberosity', 'sacrum',
  'sacral', 'greater trochanter', 'bony prominence', 'skin integrity',
  'blanching erythema', 'non-blanching erythema', 'maceration', 'shear', 'friction',
  'Waterlow score', 'weight shift', 'forward lean pressure relief',
  'wheelchair', 'self-propelling wheelchair', 'attendant-propelled wheelchair',
  'powered wheelchair', 'tilt-in-space', 'recline', 'backrest', 'back support',
  'tension-adjustable backrest', 'seat cushion', 'ROHO cushion', 'Jay cushion',
  'gel cushion', 'foam cushion', 'air cell cushion', 'high-specification foam',
  'pressure-redistributing cushion', 'seat depth', 'seat width',
  'seat-to-floor height', 'footplate', 'foot support', 'legrest', 'elevating legrest',
  'armrest', 'push rim', 'castor', 'rear wheel', 'axle position', 'anti-tip',
  'headrest', 'lateral support', 'pelvic belt', 'four-point harness', 'pommel',
  'ramp', 'kerb climber', 'transit tie-downs', 'crashworthiness',
  'stand-pivot transfer', 'sliding board transfer', 'hoist transfer', 'sling',
  'stand aid', 'walking frame', 'rollator', 'Zimmer frame', 'crutches', 'gait',
  'transfer', 'independent transfer', 'assisted transfer',
  'activities of daily living', 'personal care', 'continence',
  'occupational therapist', 'physiotherapist', 'wheelchair service',
  'tissue viability nurse', 'orthotist', 'rehabilitation engineer',
  'multidisciplinary team', 'best interests decision', 'mental capacity',
  'cerebral palsy', 'multiple sclerosis', 'motor neurone disease',
  'spinal cord injury', 'tetraplegia', 'paraplegia', 'hemiplegia', 'hemiparesis',
  'muscular dystrophy', 'spina bifida', 'stroke', 'osteoarthritis',
  'rheumatoid arthritis', 'osteoporosis', 'lymphoedema', 'orthostatic hypotension',
  'autonomic dysreflexia', 'dysphagia', 'aphasia'
];

interface CorrectionRule {
  pattern: RegExp;
  replacement: string;
  /** At least one of these must appear in the utterance for the rule to fire. */
  requiresContext?: string[];
  rule: string;
}

const CORRECTION_RULES: CorrectionRule[] = [
  // --- Postural terminology ---
  { pattern: /\bpelvic o[bp]lique(?:ity)?\b/gi, replacement: 'pelvic obliquity', rule: 'homophone' },
  { pattern: /\bpelvic ability\b/gi, replacement: 'pelvic obliquity', requiresContext: ['tilt', 'posture', 'seating', 'pelvis', 'sitting'], rule: 'homophone' },
  { pattern: /\bposterior pelvic till?\b/gi, replacement: 'posterior pelvic tilt', rule: 'homophone' },
  { pattern: /\bwind swept\b/gi, replacement: 'windswept', rule: 'compound' },
  { pattern: /\bwind sweeping\b/gi, replacement: 'windsweeping', rule: 'compound' },
  { pattern: /\bkyfosis\b|\bkiphosis\b/gi, replacement: 'kyphosis', rule: 'orthography' },
  { pattern: /\bscholiosis\b|\bskoliosis\b|\bscoliosus\b/gi, replacement: 'scoliosis', rule: 'orthography' },
  { pattern: /\blawdosis\b|\blordoses\b/gi, replacement: 'lordosis', rule: 'orthography' },
  { pattern: /\bplant[ai]? grade\b/gi, replacement: 'plantigrade', rule: 'compound' },
  { pattern: /\bmat assessment\b/gi, replacement: 'MAT assessment', rule: 'canonical-form' },
  { pattern: /\bmatt? assess\b/gi, replacement: 'MAT assessment', requiresContext: ['pelvis', 'hip', 'supine', 'posture', 'sitting', 'range'], rule: 'homophone' },
  { pattern: /\bhamstring lengths\b/gi, replacement: 'hamstring length', rule: 'canonical-form' },
  { pattern: /\bpop lit[ea]l\b/gi, replacement: 'popliteal', rule: 'orthography' },
  { pattern: /\bsub luxation\b/gi, replacement: 'subluxation', rule: 'compound' },
  { pattern: /\brange of motion\b/gi, replacement: 'range of movement', rule: 'en-GB' },

  // --- Pressure / skin ---
  { pattern: /\bpress sore\b|\bpressure saw\b/gi, replacement: 'pressure sore', rule: 'homophone' },
  { pattern: /\bpressure in jury\b/gi, replacement: 'pressure injury', rule: 'compound' },
  { pattern: /\bis[ck]hial tube(?:r|ro)sit(?:y|ies)\b/gi, replacement: 'ischial tuberosity', rule: 'homophone' },
  { pattern: /\bgreater cantor\b|\bgreater tro?canter\b/gi, replacement: 'greater trochanter', requiresContext: ['pressure', 'skin', 'hip', 'lateral', 'seating'], rule: 'homophone' },
  { pattern: /\btissue via[bp]ility\b/gi, replacement: 'tissue viability', rule: 'orthography' },
  { pattern: /\bnon blanching\b/gi, replacement: 'non-blanching', rule: 'compound' },
  { pattern: /\bwater low score\b|\bwaterloo score\b/gi, replacement: 'Waterlow score', rule: 'homophone' },
  { pattern: /\bpressure really[ef]?\b/gi, replacement: 'pressure relief', rule: 'homophone' },

  // --- Equipment ---
  { pattern: /\bwheel chair\b/gi, replacement: 'wheelchair', rule: 'compound' },
  { pattern: /\bwill chair\b|\bwheel share\b/gi, replacement: 'wheelchair', requiresContext: ['seat', 'cushion', 'propel', 'transfer', 'push'], rule: 'homophone' },
  { pattern: /\btilt in space\b/gi, replacement: 'tilt-in-space', rule: 'compound' },
  { pattern: /\bback rest\b/gi, replacement: 'backrest', rule: 'compound' },
  { pattern: /\bfoot plate\b/gi, replacement: 'footplate', rule: 'compound' },
  { pattern: /\bleg rest\b/gi, replacement: 'legrest', rule: 'compound' },
  { pattern: /\barm rest\b/gi, replacement: 'armrest', rule: 'compound' },
  { pattern: /\bhead rest\b/gi, replacement: 'headrest', rule: 'compound' },
  { pattern: /\bpush ring\b/gi, replacement: 'push rim', rule: 'homophone' },
  { pattern: /\bcaster\b/gi, replacement: 'castor', rule: 'en-GB' },
  { pattern: /\banti tip\b/gi, replacement: 'anti-tip', rule: 'compound' },
  { pattern: /\bseat dep\b|\bseat def\b|\bsit depth\b/gi, replacement: 'seat depth', rule: 'homophone' },
  { pattern: /\bro ho cushion\b|\broho cushion\b/gi, replacement: 'ROHO cushion', rule: 'brand' },
  { pattern: /\bjay cushion\b/gi, replacement: 'Jay cushion', rule: 'brand' },
  { pattern: /\bhigh spec(?:ification)? foam\b/gi, replacement: 'high-specification foam', rule: 'compound' },
  { pattern: /\blap belt\b/gi, replacement: 'pelvic belt', rule: 'canonical-form' },
  { pattern: /\bcurb climber\b/gi, replacement: 'kerb climber', rule: 'en-GB' },

  // --- Transfers / function ---
  { pattern: /\bstand pivot\b/gi, replacement: 'stand-pivot', rule: 'compound' },
  { pattern: /\bbanana board\b|\bslide board\b/gi, replacement: 'sliding board', rule: 'canonical-form' },
  { pattern: /\bsimmer frame\b/gi, replacement: 'Zimmer frame', rule: 'homophone' },
  { pattern: /\brolator\b|\broller ator\b/gi, replacement: 'rollator', rule: 'orthography' },
  { pattern: /\bchair to the bad\b/gi, replacement: 'chair to the bed', requiresContext: ['transfer', 'bed', 'move', 'hoist'], rule: 'homophone' },
  { pattern: /\btransfer to the bad\b/gi, replacement: 'transfer to the bed', rule: 'homophone' },

  // --- Conditions ---
  { pattern: /\bcerebral pausy\b|\bsevere all palsy\b/gi, replacement: 'cerebral palsy', rule: 'homophone' },
  { pattern: /\bmultiple sclerosies\b|\bmultiple sclerosus\b/gi, replacement: 'multiple sclerosis', rule: 'orthography' },
  { pattern: /\bmotor neuron disease\b/gi, replacement: 'motor neurone disease', rule: 'en-GB' },
  { pattern: /\bquadriplegi([ac])\b/gi, replacement: 'tetraplegia', rule: 'en-GB' },
  { pattern: /\bhemi paresis\b/gi, replacement: 'hemiparesis', rule: 'compound' },
  { pattern: /\bspiner bifida\b/gi, replacement: 'spina bifida', rule: 'homophone' },
  { pattern: /\bautonomic dys reflexia\b/gi, replacement: 'autonomic dysreflexia', rule: 'compound' },
  { pattern: /\bortho static hypotension\b/gi, replacement: 'orthostatic hypotension', rule: 'compound' },
  { pattern: /\bdis phagia\b/gi, replacement: 'dysphagia', rule: 'orthography' },
  { pattern: /\blymphedema\b/gi, replacement: 'lymphoedema', rule: 'en-GB' },

  // --- Roles ---
  { pattern: /\bm d t\b/gi, replacement: 'multidisciplinary team', rule: 'expansion' }
];

/** Markers indicating the engine itself signalled failure. */
const MISHEARING_MARKERS = ['inaudible', 'unintelligible', 'garbled', 'unclear'];

// ---------------------------------------------------------------------------
// Spoken number & unit normalisation
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

const UNIT_CANON: [RegExp, string][] = [
  [/\b(?:centimet(?:re|er)s?|cms)\b/gi, 'cm'],
  [/\b(?:millimet(?:re|er)s?|mms)\b/gi, 'mm'],
  [/\b(?:inch(?:es)?|ins)\b/gi, 'inches'],
  [/\b(?:degrees?|deg)\b/gi, 'degrees'],
  [/\b(?:kilograms?|kgs|kilos?)\b/gi, 'kg']
];

const UNIT_ALT = 'cm|mm|inches|degrees|kg';

/**
 * Converts spoken numerals immediately preceding a unit into digits:
 * "fifteen degrees" -> "15 degrees", "forty four centimetres" -> "44 cm".
 * Only fires directly before a recognised unit, so ordinary prose is untouched.
 */
export function normaliseMeasurements(text: string): { text: string; changed: boolean } {
  const before = text;
  let out = text;

  for (const [re, canon] of UNIT_CANON) {
    out = out.replace(re, canon);
  }

  const tens = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
  const ones = 'one|two|three|four|five|six|seven|eight|nine';
  const under20 =
    'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';

  out = out.replace(
    new RegExp(`\\b(${tens})[\\s-](${ones})\\s+(${UNIT_ALT})\\b`, 'gi'),
    (_m: string, t: string, o: string, u: string) =>
      `${NUMBER_WORDS[t.toLowerCase()] + NUMBER_WORDS[o.toLowerCase()]} ${u}`
  );

  out = out.replace(
    new RegExp(`\\b(${tens}|${under20})\\s+(${UNIT_ALT})\\b`, 'gi'),
    (_m: string, n: string, u: string) => `${NUMBER_WORDS[n.toLowerCase()]} ${u}`
  );

  out = out.replace(new RegExp(`(\\d)\\s*(${UNIT_ALT})\\b`, 'gi'), '$1 $2');

  return { text: out, changed: out !== before };
}

// ---------------------------------------------------------------------------
// Correction pass
// ---------------------------------------------------------------------------

/**
 * Applies the clinical correction pass to one recognised utterance.
 * Lexical only: never adds, removes or negates clinical content.
 */
export function correctClinicalText(rawText: string): CorrectionResult {
  const corrections: CorrectionRecord[] = [];
  let text = rawText;
  const haystack = rawText.toLowerCase();

  for (const rule of CORRECTION_RULES) {
    if (rule.requiresContext && !rule.requiresContext.some((c) => haystack.includes(c))) {
      continue;
    }
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    const replaced = text.replace(re, rule.replacement);
    if (replaced !== text) {
      corrections.push({ from: text, to: replaced, rule: rule.rule });
      text = replaced;
    }
  }

  const measured = normaliseMeasurements(text);
  if (measured.changed) {
    corrections.push({ from: text, to: measured.text, rule: 'measurement-normalisation' });
    text = measured.text;
  }

  return {
    text,
    rawText,
    corrections,
    isCorrected: corrections.length > 0,
    suspectedMishearings: MISHEARING_MARKERS.filter((m) => haystack.includes(m))
  };
}

// ---------------------------------------------------------------------------
// Alternative-hypothesis rescoring
// ---------------------------------------------------------------------------

const PHRASE_TOKENS: Set<string> = new Set(
  CLINICAL_PHRASES.flatMap((p) => p.toLowerCase().split(/[\s-]+/)).filter((w) => w.length > 3)
);

/** How "clinical" a candidate transcription is. Higher is more likely correct. */
export function clinicalScore(candidate: string): number {
  const lower = candidate.toLowerCase();
  let score = 0;

  for (const phrase of CLINICAL_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) score += 3;
  }
  for (const token of lower.split(/[^a-z0-9']+/)) {
    if (token.length > 3 && PHRASE_TOKENS.has(token)) score += 1;
  }
  const measurements = lower.match(new RegExp(`\\d+(\\.\\d+)?\\s*(${UNIT_ALT})\\b`, 'g'));
  if (measurements) score += measurements.length * 2;

  return score;
}

export interface AsrAlternative {
  transcript: string;
  confidence?: number | null;
}

export interface RescoreResult {
  transcript: string;
  confidence: number | null;
  /** True when a lower-ranked alternative was promoted over the engine's top guess. */
  promoted: boolean;
  /** The engine's original top hypothesis, always retained for the audit trail. */
  engineTopHypothesis: string;
  consideredAlternatives: string[];
}

/**
 * Picks the best hypothesis from the engine's n-best list. The engine's own ranking wins
 * unless another alternative contains materially more clinical vocabulary; that margin
 * requirement stops the system rewriting the clinician on a coin-flip.
 */
export function rescoreAlternatives(alternatives: AsrAlternative[]): RescoreResult {
  const cleaned = alternatives.filter(
    (a) => a && typeof a.transcript === 'string' && a.transcript.trim().length > 0
  );

  if (cleaned.length === 0) {
    return {
      transcript: '',
      confidence: null,
      promoted: false,
      engineTopHypothesis: '',
      consideredAlternatives: []
    };
  }

  const top = cleaned[0];
  let best = top;
  let bestScore = clinicalScore(top.transcript);

  for (const alt of cleaned.slice(1)) {
    const score = clinicalScore(alt.transcript);
    // Require a clear margin before overriding the engine's preferred hypothesis.
    if (score >= bestScore + 2) {
      best = alt;
      bestScore = score;
    }
  }

  return {
    transcript: best.transcript.trim(),
    confidence:
      typeof best.confidence === 'number' && best.confidence > 0 ? best.confidence : null,
    promoted: best !== top,
    engineTopHypothesis: top.transcript.trim(),
    consideredAlternatives: cleaned.map((a) => a.transcript.trim())
  };
}

/**
 * Phrase list for engines that accept recognition bias
 * (Google Cloud STT `speechContexts.phrases`, Azure `PhraseListGrammar`).
 */
export function getRecognitionPhraseHints(): string[] {
  return [...CLINICAL_PHRASES];
}

/** JSGF grammar for the W3C SpeechGrammarList, where the browser supports it. */
export function buildJsgfGrammar(): string {
  const escaped = CLINICAL_PHRASES.map((p) => p.replace(/[;|=<>*+()[\]{}]/g, '')).join(' | ');
  return `#JSGF V1.0; grammar clinical; public <clinical> = ${escaped};`;
}
