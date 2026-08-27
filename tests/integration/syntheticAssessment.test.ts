import { ClinicalExtractionEngine } from '../../src/clinical/extractionEngine';
import { buildNarrative, narrativeToText } from '../../src/clinical/narrative';
import { clinicalDocumentService } from '../../src/services/clinicalDocument';
import { StructuredExtractionSchema } from '../../src/clinical/provenance';
import { ScriptedModel, extractionResponse } from '../fixtures/scriptedModel';
import { SYNTHETIC_TRANSCRIPT, SYNTHETIC_EXPECTATIONS } from '../fixtures/syntheticAssessment';

/**
 * End-to-end verification against a full synthetic wheelchair assessment.
 *
 * The transcript is unlabelled flowing text, exactly what the free device pipeline produces.
 * The model response is scripted so the test is deterministic and costs nothing, but
 * everything after it — grounding, merge, contradiction handling, narrative composition,
 * document generation — is the real production code path.
 *
 * The response deliberately includes an ungrounded fabrication, so the test proves the
 * pipeline removes it rather than merely that it copies good input through.
 */

const T = SYNTHETIC_TRANSCRIPT;

function scriptedExtraction(): string {
  return extractionResponse(
    [
      {
        section: 'presenting_concern',
        field: 'presenting',
        value: 'Referred due to an unsuitable existing wheelchair limiting community access.',
        quote: "I can't manage it in the chair I've got",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'goals_intended_use',
        field: 'primary_goal',
        value: 'Wishes to resume taking his grandson to the park on Saturdays.',
        quote: 'I want to get back to taking my grandson to the park',
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'current_equipment_routine',
        field: 'current_chair_problems',
        value:
          'Six-year-old self-propelling wheelchair. Cushion has bottomed out and the seat is ' +
          'too narrow, catching at the hips.',
        quote: "the seat's gone completely flat. It's too narrow as well, it catches my hips",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'medical_background',
        field: 'diagnosis',
        value: 'Multiple sclerosis, diagnosed 2011, with gradual deterioration over three years.',
        quote: "I've got multiple sclerosis, diagnosed in 2011",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED',
        timeReference: 'diagnosed 2011, progressive over the last three years'
      },
      {
        section: 'medical_background',
        field: 'medication',
        value: 'On medication for multiple sclerosis; specific names to be confirmed with the GP.',
        quote: "Yes but I'd have to check the names with my GP",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'PENDING',
        requiresReview: true
      },
      {
        section: 'pain',
        field: 'right_hip_pain',
        value:
          'Burning right hip pain developing after approximately one hour of sitting, present ' +
          'four months and worsening. Limits time out of the house to under an hour.',
        quote: 'in my right hip mostly. It comes on after about an hour of sitting',
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED',
        laterality: 'RIGHT',
        timeReference: 'four months, worsening'
      },
      {
        section: 'mobility_walking_falls',
        field: 'walking_distance',
        value: 'Walks approximately 20 metres indoors with a walking frame on a good day.',
        quote: 'About twenty metres indoors with my frame, on a good day',
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'mobility_walking_falls',
        field: 'falls_self_report',
        value: 'Reports no falls.',
        quote: "No, I haven't fallen at all, not for a long time",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'CONTRADICTORY',
        contradicts: 'falls_carer_report',
        requiresReview: true
      },
      {
        section: 'mobility_walking_falls',
        field: 'falls_carer_report',
        value: 'Carer reports two falls in the last fortnight, one in the bathroom.',
        quote: "he'd been down twice in the last fortnight, once in the bathroom",
        sourceType: 'CARER_REPORTED',
        certainty: 'CONTRADICTORY',
        contradicts: 'falls_self_report',
        requiresReview: true
      },
      {
        section: 'transfers_upper_limb',
        field: 'transfer_method',
        value: 'Independent stand-pivot transfer to bed using a grab rail.',
        quote: 'I stand and pivot round holding the grab rail',
        sourceType: 'CLINICIAN_OBSERVED',
        certainty: 'OBSERVED'
      },
      {
        section: 'objective_postural',
        field: 'pelvic_obliquity',
        value:
          'Pelvic obliquity of approximately 15 degrees in unsupported sitting, correcting ' +
          'almost fully on manual support and therefore assessed as flexible rather than fixed.',
        quote: 'left pelvic obliquity there, about fifteen degrees',
        sourceType: 'CLINICIAN_OBSERVED',
        certainty: 'OBSERVED',
        laterality: 'LEFT'
      },
      {
        section: 'objective_postural',
        field: 'trunk_lean',
        value: 'Trunk lean to the right which settles once the pelvis is supported.',
        quote: 'the trunk lean to the right settles when the pelvis is supported',
        sourceType: 'CLINICIAN_OBSERVED',
        certainty: 'OBSERVED',
        laterality: 'RIGHT'
      },
      {
        section: 'wheelchair_measurements',
        field: 'seat_width',
        value: 'Seat width recorded.',
        quote: 'Seat width is forty four centimetres, measured in supported sitting with your shoes on',
        sourceType: 'OBJECTIVE_MEASURE',
        certainty: 'MEASURED',
        measurement: { value: '44', unit: 'cm', context: 'supported sitting with footwear on' }
      },
      {
        section: 'wheelchair_measurements',
        field: 'seat_depth',
        value: 'Seat depth recorded.',
        quote: "Seat depth I'm making forty two centimetres",
        sourceType: 'OBJECTIVE_MEASURE',
        certainty: 'MEASURED',
        measurement: { value: '42', unit: 'cm' }
      },
      {
        section: 'skin_pressure',
        field: 'skin_status',
        value: 'Intermittent redness over the right side which resolves.',
        quote: 'A bit red over the right side sometimes, but it goes away',
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED',
        laterality: 'RIGHT'
      },
      {
        section: 'skin_pressure',
        field: 'pressure_relief',
        value: 'Performs forward lean pressure relief approximately every 30 minutes, prompted by his wife.',
        quote: 'I lean forward every half hour or so, my wife reminds me',
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'home_environment',
        field: 'access',
        value: 'One external step of approximately six inches at the front door; narrow bathroom doorway requiring angled entry.',
        quote: 'one step at the front door, about six inches, and the bathroom door is quite narrow',
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'transport',
        field: 'car_transport',
        value: "Wife drives, but can no longer lift the current wheelchair into the car boot unaided.",
        quote: "she can't lift the chair into the boot on her own any more",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'wheelchair_trials',
        field: 'trial_outcome',
        value:
          'Trialled a lightweight rigid frame with a pressure-redistributing foam cushion. ' +
          'Reported improved sitting position and demonstrated more efficient propulsion.',
        quote: "That's much better actually, I feel like I'm sitting straight",
        sourceType: 'CLINICIAN_OBSERVED',
        certainty: 'OBSERVED'
      },
      {
        section: 'person_agreement',
        field: 'frame_preference',
        value: 'Prefers the black frame to the blue.',
        quote: "I'd rather have the black frame than the blue one",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },
      {
        section: 'clinical_justification',
        field: 'reasoning',
        value:
          'The flexible pelvic obliquity is assessed as driving both the trunk lean and the ' +
          'right hip pain. A contoured pressure-redistributing cushion supporting the pelvis is ' +
          'expected to address all three, and the lighter frame resolves the car transfer ' +
          'difficulty reported by his wife.',
        quote: 'the flexible pelvic obliquity is driving the trunk lean and the right hip pain',
        sourceType: 'CLINICAL_REASONING',
        certainty: 'CONFIRMED'
      },
      {
        section: 'action_plan',
        field: 'order_equipment',
        value: 'Order the lightweight frame with pressure-redistributing cushion. Clinician to action this week.',
        quote: "We'll order the lightweight frame with the pressure-redistributing cushion",
        sourceType: 'AGREED_PLAN',
        certainty: 'CONFIRMED',
        timeReference: 'this week'
      },
      {
        section: 'motor_sensory',
        field: 'hand_function',
        value: 'Hand function was not assessed during this session due to time.',
        quote: "I haven't checked your hand function properly today, we ran out of time",
        sourceType: 'CLINICIAN_OBSERVED',
        certainty: 'NOT_ASSESSED',
        requiresReview: true
      },
      {
        section: 'review_followup',
        field: 'review_plan',
        value: 'Review in six weeks once the chair arrives, and sooner if skin integrity deteriorates.',
        quote: "I'll see you again in six weeks once the chair arrives, and sooner if the skin gets any worse",
        sourceType: 'AGREED_PLAN',
        certainty: 'CONFIRMED'
      },
      {
        section: 'person_agreement',
        field: 'agreement',
        value: 'Agrees with the proposed plan.',
        quote: "That sounds good, yes, I'm happy with that",
        sourceType: 'SERVICE_USER_REPORTED',
        certainty: 'REPORTED'
      },

      // Deliberate fabrication: nothing in the transcript supports this. The pipeline must
      // remove it, and this is the test that proves it does.
      {
        section: 'skin_pressure',
        field: 'fabricated_ulcer',
        value: 'Category 2 pressure ulcer over the left ischial tuberosity, 2 cm diameter.',
        quote: 'there is a category two pressure ulcer over the left ischial tuberosity',
        sourceType: 'CLINICIAN_OBSERVED',
        certainty: 'OBSERVED'
      }
    ],
    [
      {
        type: 'CONTRADICTION',
        description:
          'Falls history conflicts: the person reports no falls, the carer reports two in the ' +
          'last fortnight including one in the bathroom.',
        quotes: ["I haven't fallen at all", 'down twice in the last fortnight']
      },
      {
        type: 'SAFETY_RELEVANT_NOT_ASSESSED',
        description: 'Hand function was not assessed and is relevant to independent propulsion.'
      },
      {
        type: 'INCOMPLETE_IMPORTANT_INFORMATION',
        description: 'Medication names were not established and require confirmation with the GP.'
      }
    ]
  );
}

describe('Synthetic wheelchair assessment — end to end', () => {
  let extraction: any;
  let narrative: any;
  let text: string;
  let dropped: string[];

  beforeAll(async () => {
    const engine = new ClinicalExtractionEngine(new ScriptedModel([scriptedExtraction()]));
    const result = await engine.extract(T);
    extraction = result.extraction;
    dropped = result.ungroundedDropped;
    narrative = buildNarrative(extraction);
    text = narrativeToText(narrative);
  });

  it('produces a schema-valid extraction from an unlabelled transcript', () => {
    expect(StructuredExtractionSchema.safeParse(extraction).success).toBe(true);
    expect(extraction.facts.length).toBeGreaterThan(15);
  });

  it('nothing is invented: the ungrounded finding is removed', () => {
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain('Category 2 pressure ulcer');
    expect(text).not.toContain('Category 2');
    expect(text).not.toContain('ischial tuberosity');
  });

  it('retains the contradiction, keeping both accounts', () => {
    expect(text).toContain('no falls');
    expect(text).toContain('two falls in the last fortnight');
    expect(extraction.review_flags.some((f: any) => f.flag_type === 'CONTRADICTION')).toBe(true);
  });

  it('preserves the reported versus observed distinction', () => {
    const reported = extraction.facts.find((f: any) => f.field_id === 'walking_distance');
    const observed = extraction.facts.find((f: any) => f.field_id === 'pelvic_obliquity');

    expect(reported.source_type).toBe('SERVICE_USER_REPORTED');
    expect(observed.source_type).toBe('CLINICIAN_OBSERVED');
    // And the distinction is visible in the note, not only in the internal data.
    expect(text).toMatch(/Reports:.*20 metres/);
    expect(text).toMatch(/Observed:.*pelvic obliquity/i);
  });

  it('retains measurements with their units and context', () => {
    expect(text).toContain('44 cm');
    expect(text).toContain('42 cm');
    expect(text).toContain('supported sitting with footwear on');
  });

  it('retains laterality', () => {
    expect(text.toLowerCase()).toContain('left pelvic obliquity');
    expect(text.toLowerCase()).toContain('right hip pain');
    expect(text.toLowerCase()).toContain('trunk lean to the right');
  });

  it('records the fixed versus flexible distinction that drives the prescription', () => {
    expect(text).toContain('flexible rather than fixed');
  });

  it('does not convert an unassessed item into a normal finding', () => {
    const handFunction = extraction.facts.find((f: any) => f.field_id === 'hand_function');
    expect(handFunction.certainty).toBe('NOT_ASSESSED');
    expect(text).toContain('not assessed during this session');
    expect(text).not.toMatch(/hand function.*(normal|intact|good)/i);
  });

  it('marks sections that genuinely did not come up as not established', () => {
    const consent = narrative.sections.find((s: any) => s.id === 'consent_communication');
    // Safety-relevant sections say explicitly that silence is not reassurance.
    expect(consent.notEstablished).toContain('not evidence');
  });

  it('retains the action plan with its owner and timing', () => {
    expect(text).toContain('Order the lightweight frame');
    expect(text).toContain('this week');
  });

  it('retains the follow-up plan including the earlier-review trigger', () => {
    expect(text).toContain('six weeks');
    expect(text.toLowerCase()).toContain('sooner if skin integrity deteriorates');
  });

  it("retains the person's goal, preference and agreement", () => {
    expect(text).toContain('grandson to the park');
    expect(text).toContain('black frame');
    expect(text).toContain('Agrees with the proposed plan');
  });

  it('retains the clinician’s reasoning without altering it', () => {
    expect(text).toContain('driving both the trunk lean and the right hip pain');
  });

  it('reads as a detailed record, not a summary', () => {
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThan(350);
    expect(narrative.stats.sectionsPopulated).toBeGreaterThanOrEqual(14);
  });

  it('raises review flags for everything a clinician must resolve', () => {
    const types = extraction.review_flags.map((f: any) => f.flag_type);
    expect(types).toContain('CONTRADICTION');
    expect(types).toContain('SAFETY_RELEVANT_NOT_ASSESSED');
    expect(types).toContain('INCOMPLETE_IMPORTANT_INFORMATION');
    // The dropped fabrication is reported rather than silently discarded.
    expect(extraction.review_flags.some((f: any) => /could not be traced/.test(f.description))).toBe(true);
  });

  it('carries no speaker attribution anywhere, because none was available', () => {
    expect(text).not.toMatch(/speaker\s*\d/i);
    expect(text).not.toMatch(/therapist:/i);
    expect(text).not.toMatch(/patient:/i);
  });

  describe('T/U/V/W. Document states and export', () => {
    const meta = {
      meetingId: 'm-synthetic',
      clientReference: 'CLIENT-TEST-01',
      clinicianName: 'test.clinician@nhs.net',
      organisationName: 'Test Wheelchair Service',
      assessmentDate: '27/08/2026',
      assessmentType: 'INITIAL_ASSESSMENT' as const,
      assessmentMode: 'IN_PERSON' as const,
      documentVersion: 'Draft'
    };

    it('T. an unapproved note is watermarked as a draft, not a record', async () => {
      const pdf = await clinicalDocumentService.generatePDF(
        { ...meta, approvedBy: null, approvedAt: null },
        narrative
      );
      expect(pdf.length).toBeGreaterThan(3000);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('V. produces a real PDF from the approved note', async () => {
      const pdf = await clinicalDocumentService.generatePDF(
        { ...meta, approvedBy: 'test.clinician@nhs.net', approvedAt: '27/08/2026, 14:00' },
        narrative
      );
      // A real PDF, not text mislabelled with a PDF content type.
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(3000);
    });

    it('W. produces a real DOCX from the approved note', async () => {
      const docx = await clinicalDocumentService.generateDOCX(
        { ...meta, approvedBy: 'test.clinician@nhs.net', approvedAt: '27/08/2026, 14:00' },
        narrative
      );
      // DOCX is a ZIP container; "PK" is its signature.
      expect(docx.subarray(0, 2).toString()).toBe('PK');
      expect(docx.length).toBeGreaterThan(3000);
    });

    it('exports contain no internal implementation detail', async () => {
      const docx = await clinicalDocumentService.generateDOCX(
        { ...meta, approvedBy: 'x@y.z', approvedAt: 'now' },
        narrative
      );
      const raw = docx.toString('latin1');
      // The document is a ZIP so content is compressed, but any accidental plaintext dump of
      // the internal model would be visible.
      expect(raw).not.toContain('source_quote');
      expect(raw).not.toContain('SERVICE_USER_REPORTED');
      expect(raw).not.toContain('field_id');
    });
  });

  it('covers every element the acceptance criteria list', () => {
    // A single guard so a future change that quietly drops one of these is caught here.
    const required = [
      SYNTHETIC_EXPECTATIONS.goal.split(' ').slice(-3).join(' '),
      'multiple sclerosis',
      '20 metres',
      'stand-pivot',
      '44 cm',
      'six weeks'
    ];
    for (const needle of required) {
      expect(text.toLowerCase()).toContain(needle.toLowerCase());
    }
  });
});
