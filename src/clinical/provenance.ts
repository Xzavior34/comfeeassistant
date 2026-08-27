import { z } from 'zod';

/**
 * Internal provenance model for extracted clinical information.
 *
 * Every clinical fact the system holds carries where it came from, how certain it is, and
 * which words in the consultation support it. This is what makes the difference between a
 * clinical record and a summary: a reader can always ask "who said that, and how do you
 * know?" and get an answer.
 *
 * Field names follow the supplied Clinical AI Documentation Template rather than being
 * renamed to house style, so the specification and the code can be read side by side.
 */

/** Where a piece of information came from. */
export const SourceType = z.enum([
  'SERVICE_USER_REPORTED',
  'CARER_REPORTED',
  'CLINICIAN_OBSERVED',
  'OBJECTIVE_MEASURE',
  'RECORD_SOURCE',
  'CLINICAL_REASONING',
  'AGREED_PLAN',
  'UNRESOLVED',
  'UNKNOWN'
]);
export type SourceType = z.infer<typeof SourceType>;

/**
 * The epistemic state of the information.
 *
 * NOT_ASSESSED and NOT_DISCUSSED are deliberately distinct. "We looked and found nothing"
 * and "it never came up" are different clinical facts, and collapsing them is how an
 * unexamined risk becomes an apparently normal finding.
 */
export const Certainty = z.enum([
  'CONFIRMED',
  'REPORTED',
  'OBSERVED',
  'MEASURED',
  'DENIED_ABSENT',
  'NOT_ASSESSED',
  'NOT_DISCUSSED',
  'UNCERTAIN',
  'CONTRADICTORY',
  'PENDING'
]);
export type Certainty = z.infer<typeof Certainty>;

export const Laterality = z.enum(['LEFT', 'RIGHT', 'BILATERAL', 'MIDLINE', 'NOT_APPLICABLE', 'UNSPECIFIED']);
export type Laterality = z.infer<typeof Laterality>;

export const AssessmentStatus = z.enum([
  'ESTABLISHED',
  'PARTIALLY_ESTABLISHED',
  'REQUIRES_CLARIFICATION',
  'NOT_ESTABLISHED'
]);

/** A measurement kept whole: value, unit and the context that makes it interpretable. */
export const MeasurementSchema = z.object({
  value: z.string(),
  unit: z.string(),
  /**
   * Position, cushion, footwear, equipment — whatever the measurement means nothing without.
   * The template is explicit that context must never be stripped from a measurement.
   */
  context: z.string().nullable().optional(),
  laterality: Laterality.default('UNSPECIFIED')
});
export type Measurement = z.infer<typeof MeasurementSchema>;

/**
 * A single clinical fact.
 *
 * `source_quote` must be text that genuinely appears in the transcript. It is what allows a
 * clinician, or the grounding validator, to check any statement against what was said.
 */
export const ClinicalFactSchema = z.object({
  section_id: z.string(),
  field_id: z.string(),
  value: z.string(),
  source_type: SourceType,
  certainty: Certainty,
  laterality: Laterality.default('UNSPECIFIED'),
  /** Onset, duration, frequency, progression, or when it last occurred. */
  time_reference: z.string().nullable().optional(),
  measurement: MeasurementSchema.nullable().optional(),
  /** Verbatim words from the transcript that support this fact. */
  source_quote: z.string(),
  assessment_status: AssessmentStatus.default('ESTABLISHED'),
  requires_review: z.boolean().default(false),
  review_reason: z.string().nullable().optional(),
  clinician_approved: z.boolean().default(false),
  /** Set when this fact contradicts another; both are kept. */
  contradicts: z.string().nullable().optional()
});
export type ClinicalFact = z.infer<typeof ClinicalFactSchema>;

export const ReviewFlagType = z.enum([
  'CONTRADICTION',
  'UNCERTAIN_INFORMATION',
  'INCOMPLETE_IMPORTANT_INFORMATION',
  'MEASUREMENT_MISSING_UNITS',
  'UNCLEAR_LATERALITY',
  'SAFETY_RELEVANT_NOT_ASSESSED',
  'UNCLEAR_ACTION_OWNER',
  'UNCLEAR_TARGET_DATE',
  'INCOMPLETE_EQUIPMENT_SPECIFICATION',
  'REASONING_REQUIRES_CONFIRMATION',
  'TRANSCRIPTION_UNCERTAINTY',
  'UNATTRIBUTED_SIGNIFICANT_STATEMENT',
  'OTHER'
]);
export type ReviewFlagType = z.infer<typeof ReviewFlagType>;

export const ReviewFlagSchema = z.object({
  flag_type: ReviewFlagType,
  description: z.string(),
  section_id: z.string().nullable().optional(),
  source_quotes: z.array(z.string()).default([]),
  resolved: z.boolean().default(false)
});
export type ReviewFlag = z.infer<typeof ReviewFlagSchema>;

/**
 * The complete structured extraction: facts plus flags, before any narrative is written.
 *
 * Generating this first and validating it is what stops the system producing fluent prose
 * that nobody can trace back to the consultation.
 */
export const StructuredExtractionSchema = z.object({
  facts: z.array(ClinicalFactSchema),
  review_flags: z.array(ReviewFlagSchema).default([]),
  /** Sections the model looked for and found nothing on. Recorded, not silently omitted. */
  sections_not_discussed: z.array(z.string()).default([])
});
export type StructuredExtraction = z.infer<typeof StructuredExtractionSchema>;

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

export interface SectionDefinition {
  id: string;
  title: string;
  /** What belongs here, used both in the prompt and in the review UI. */
  guidance: string;
  /** True when absence of information is itself a safety concern worth flagging. */
  safetyRelevant?: boolean;
}

/**
 * The clinical document's sections, in the order the template specifies. This single list
 * drives the extraction prompt, the narrative generator, the review screen and the exported
 * document, so those four can never drift apart.
 */
export const SECTIONS: SectionDefinition[] = [
  { id: 'assessment_context', title: 'Assessment context', guidance: 'Assessment type, setting, date, who was present and in what capacity.' },
  { id: 'presenting_concern', title: 'Presenting concern and referral reason', guidance: 'Why the person was referred now, whose concern it is, what has changed, urgency and expectations.' },
  { id: 'consent_communication', title: 'Consent, communication and information sources', guidance: 'How consent was established, communication support, interpreter, advocate or carer involvement. Never infer capacity from participation.', safetyRelevant: true },
  { id: 'goals_intended_use', title: "Person's goals and intended wheelchair use", guidance: 'What matters to the person: activities, independence, participation, comfort, roles. Indoor and outdoor use, distances, surfaces, who propels.' },
  { id: 'current_equipment_routine', title: 'Current equipment and usual functional routine', guidance: 'Current wheelchair and equipment, its age, fit, problems and successful features. The usual day.' },
  { id: 'medical_background', title: 'Relevant medical and health background', guidance: 'Diagnoses, onset, progression, surgery, medication, allergies, precautions. Never infer a diagnosis from symptoms.' },
  { id: 'pain', title: 'Pain', guidance: 'Site, severity, pattern, aggravating and easing factors, functional effect, management. Keep the person’s description and clinician observation separate.' },
  { id: 'mobility_walking_falls', title: 'Mobility, walking and falls', guidance: 'Walking ability and aids, distance, stability, fatigue. Falls, near-falls, circumstances, injury, fear of falling. Distinguish reported capacity from observed performance.', safetyRelevant: true },
  { id: 'transfers_upper_limb', title: 'Transfers and upper-limb function', guidance: 'Transfer method, assistance, equipment, helpers, manual-handling concerns. Upper-limb range, strength, grip, propulsion, pressure-relief capacity. Preserve right/left differences.', safetyRelevant: true },
  { id: 'adls', title: 'Activities of daily living', guidance: 'Self-care, dressing, toileting, domestic tasks, work or education, and the assistance required.' },
  { id: 'objective_postural', title: 'Objective physical and postural assessment', guidance: 'Clinician-observed findings: tone, head and neck, shoulders, trunk, sitting balance, pelvis. Record whether a postural feature is FIXED or FLEXIBLE and how much correction was tolerated.' },
  { id: 'range_of_movement', title: 'Range of movement', guidance: 'Hip, knee and ankle range with laterality. Do not infer contracture from limited movement without assessment.' },
  { id: 'lower_limb_alignment', title: 'Lower-limb alignment', guidance: 'Alignment, windsweeping, plantigrade ability, deformity, orthoses and footwear context.' },
  { id: 'motor_sensory', title: 'Motor and sensory findings', guidance: 'Strength, motor control, tone, sensation across trunk and limbs, laterality, spasms.' },
  { id: 'wheelchair_measurements', title: 'Wheelchair measurements', guidance: 'Every measurement with its unit, laterality and the position, cushion or footwear it was taken in.' },
  { id: 'skin_pressure', title: 'Skin integrity and pressure management', guidance: 'Current skin status, pressure history, risk factors, relief technique and frequency, and the plan. Absence of discussion is not evidence of absent risk.', safetyRelevant: true },
  { id: 'interventions', title: 'Current and previous interventions', guidance: 'Multidisciplinary interventions, what was provided, the outcome, and whether they are active, completed or discontinued.' },
  { id: 'home_environment', title: 'Home environment', guidance: 'Building type, approach, steps, ramps, thresholds, internal doorway widths and turning space. Retain dimensions.' },
  { id: 'community_environment', title: 'Community environment', guidance: 'Gradients, uneven ground, kerbs, distances, destinations and frequency.' },
  { id: 'storage_charging', title: 'Storage and charging', guidance: 'Secure storage, power supply, charging arrangements, lifting or dismantling, fire safety.' },
  { id: 'transport', title: 'Transport', guidance: 'Car, taxi, public transport, accessible vehicle, occupied wheelchair transport, tie-downs. Do not infer transport compliance.', safetyRelevant: true },
  { id: 'wheelchair_trials', title: 'Wheelchair trials', guidance: 'What was trialled and what happened: posture, comfort, propulsion, transfers, fatigue, safety, and the person’s feedback.' },
  { id: 'options_considered', title: 'Options considered', guidance: 'Configurations considered, including those rejected and why.' },
  { id: 'selected_configuration', title: 'Selected wheelchair and configuration', guidance: 'Make, model, frame, dimensions, cushion, back, supports, controls and accessories, only as far as established. Never invent specification.' },
  { id: 'clinical_justification', title: 'Clinical justification', guidance: 'How the selection meets the goals, posture, pressure, mobility, transfers, environment and transport needs. Grounded only in documented findings.' },
  { id: 'problem_list', title: 'Problem list and clinical priorities', guidance: 'Clinical problems ordered by functional and safety impact.' },
  { id: 'objectives_outcomes', title: 'Agreed objectives and outcomes', guidance: 'Agreed objectives and expected outcomes, measurable where the assessment establishes them.' },
  { id: 'risks_mitigation', title: 'Risks and mitigation', guidance: 'Risks established during the assessment, the evidence for each, and the mitigation agreed.', safetyRelevant: true },
  { id: 'actions_today', title: 'Actions completed today', guidance: 'What was actually done during the assessment, kept separate from future actions.' },
  { id: 'action_plan', title: 'Agreed action plan', guidance: 'Action, responsible person or service, and target date, only where explicitly stated. Never invent an owner or a date.' },
  { id: 'provision_training_handover', title: 'Provision, training and handover', guidance: 'Funding, ordering, delivery, handover, and training needs for propulsion, transfers, pressure relief, charging and maintenance.' },
  { id: 'review_followup', title: 'Review and follow-up', guidance: 'Timeframe, earlier-review triggers, outcome measures, contact route and responsible service. Never invent a review date.' },
  { id: 'person_agreement', title: "Person's agreement", guidance: 'Agreement, reservations, declined options and preferences. Preserve disagreement rather than converting it to agreement.' },
  { id: 'concerns', title: 'Concerns', guidance: 'Concerns raised by the person, carer or clinician that remain live.' },
  { id: 'outstanding_information', title: 'Outstanding information', guidance: 'Missing information, unresolved issues, pending referrals or decisions. This is the safety net for incomplete documentation.', safetyRelevant: true },
  { id: 'additional_notes', title: 'Additional relevant clinical notes', guidance: 'Clinically relevant information with no other home. Not a dumping ground.' }
];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

export function getSection(id: string): SectionDefinition | undefined {
  return SECTIONS.find((s) => s.id === id);
}

/** Phrases the template sanctions when information genuinely was not established. */
export const NOT_ESTABLISHED_PHRASES: Record<Certainty, string | null> = {
  CONFIRMED: null,
  REPORTED: null,
  OBSERVED: null,
  MEASURED: null,
  DENIED_ABSENT: null,
  NOT_ASSESSED: 'Not assessed.',
  NOT_DISCUSSED: 'Not discussed during this assessment.',
  UNCERTAIN: 'Requires clarification.',
  CONTRADICTORY: 'Requires clarification.',
  PENDING: 'Pending.'
};
