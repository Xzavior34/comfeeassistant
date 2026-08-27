import { ModelClient } from '../../src/clinical/extractionEngine';

/**
 * A scripted stand-in for the clinical model.
 *
 * The pipeline's guarantees — grounding, contradiction preservation, schema validation,
 * bounded repair, injection resistance — are properties of the code around the model, and
 * they must hold regardless of what the model returns. Testing them against a live API would
 * make the suite slow, non-deterministic, dependent on a paid quota, and unable to exercise
 * the failure modes that matter most.
 *
 * So the model is scripted: each test states exactly what comes back, including malformed,
 * ungrounded and adversarial responses.
 */
export class ScriptedModel implements ModelClient {
  name = 'scripted-test-model';
  public calls: { systemInstruction: string; userContent: string }[] = [];
  private queue: string[];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async generate(systemInstruction: string, userContent: string): Promise<string> {
    this.calls.push({ systemInstruction, userContent });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error('ScriptedModel ran out of responses — the code made more calls than expected.');
    }
    return next;
  }
}

/** Always throws, for exercising the failure path. */
export class FailingModel implements ModelClient {
  name = 'failing-test-model';
  constructor(private message = 'model unavailable') {}
  async generate(): Promise<string> {
    throw new Error(this.message);
  }
}

export interface FactSpec {
  section: string;
  field: string;
  value: string;
  quote: string;
  sourceType?: string;
  certainty?: string;
  laterality?: string;
  measurement?: { value: string; unit: string; context?: string };
  requiresReview?: boolean;
  contradicts?: string;
  timeReference?: string;
}

/** Builds a schema-valid extraction response without hand-writing JSON in every test. */
export function extractionResponse(
  facts: FactSpec[],
  reviewFlags: { type: string; description: string; quotes?: string[] }[] = [],
  notDiscussed: string[] = []
): string {
  return JSON.stringify({
    facts: facts.map((f) => ({
      section_id: f.section,
      field_id: f.field,
      value: f.value,
      source_type: f.sourceType ?? 'CLINICIAN_OBSERVED',
      certainty: f.certainty ?? 'OBSERVED',
      laterality: f.laterality ?? 'UNSPECIFIED',
      time_reference: f.timeReference ?? null,
      measurement: f.measurement
        ? { ...f.measurement, context: f.measurement.context ?? null, laterality: 'UNSPECIFIED' }
        : null,
      source_quote: f.quote,
      assessment_status: 'ESTABLISHED',
      requires_review: f.requiresReview ?? false,
      review_reason: null,
      clinician_approved: false,
      contradicts: f.contradicts ?? null
    })),
    review_flags: reviewFlags.map((r) => ({
      flag_type: r.type,
      description: r.description,
      section_id: null,
      source_quotes: r.quotes ?? [],
      resolved: false
    })),
    sections_not_discussed: notDiscussed
  });
}
