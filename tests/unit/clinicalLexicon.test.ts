import {
  correctClinicalText,
  rescoreAlternatives,
  normaliseMeasurements,
  clinicalScore,
  getRecognitionPhraseHints
} from '../../src/services/clinicalLexicon';

describe('Clinical lexicon: hearing the correct words', () => {
  it('corrects clinical homophones and compounds without altering meaning', () => {
    const cases: [string, string][] = [
      ['Observed pelvic oblique on the left.', 'pelvic obliquity'],
      ['She has a press sore over the sacrum.', 'pressure sore'],
      ['The wheel chair is too narrow.', 'wheelchair'],
      ['Reduced seat dep is required.', 'seat depth'],
      ['Uses a stand pivot transfer.', 'stand-pivot'],
      ['Foot is plant grade bilaterally.', 'plantigrade'],
      ['Referred to tissue viapility nursing.', 'tissue viability'],
      ['Diagnosis of motor neuron disease.', 'motor neurone disease']
    ];

    for (const [input, expected] of cases) {
      const result = correctClinicalText(input);
      expect(result.text).toContain(expected);
      expect(result.isCorrected).toBe(true);
      // The untouched engine output is always retained for the audit trail.
      expect(result.rawText).toBe(input);
    }
  });

  it('only applies a context-dependent correction when the context is present', () => {
    expect(correctClinicalText('The transfer chair to the bad went well.').text).toContain('chair to the bed');
    // No transfer context: ordinary English must not be rewritten into clinical jargon.
    expect(correctClinicalText('The weather was bad.').text).toBe('The weather was bad.');
  });

  it('normalises spoken measurements to digits with canonical units', () => {
    expect(normaliseMeasurements('seat width of forty four centimetres').text).toContain('44 cm');
    expect(normaliseMeasurements('fifteen degrees posterior tilt').text).toContain('15 degrees');
    expect(normaliseMeasurements('eighteen inches across').text).toContain('18 inches');
    // Numbers not attached to a unit are left alone.
    expect(normaliseMeasurements('she has three children').text).toBe('she has three children');
  });

  it('promotes the ASR alternative containing real clinical vocabulary', () => {
    const result = rescoreAlternatives([
      { transcript: 'observed public ability on the left', confidence: 0.6 },
      { transcript: 'observed pelvic obliquity on the left', confidence: 0.55 }
    ]);
    expect(result.transcript).toBe('observed pelvic obliquity on the left');
    expect(result.promoted).toBe(true);
    // The engine's own preference is still recorded so a clinician can compare.
    expect(result.engineTopHypothesis).toBe('observed public ability on the left');
  });

  it('keeps the engine ranking when no alternative is clearly more clinical', () => {
    const result = rescoreAlternatives([
      { transcript: 'he uses a wheelchair indoors', confidence: 0.9 },
      { transcript: 'he uses a wheelchair in doors', confidence: 0.4 }
    ]);
    expect(result.transcript).toBe('he uses a wheelchair indoors');
    expect(result.promoted).toBe(false);
  });

  it('never reports a fabricated confidence when the engine supplied none', () => {
    const result = rescoreAlternatives([{ transcript: 'pressure relief every 30 minutes', confidence: 0 }]);
    expect(result.confidence).toBeNull();
  });

  it('scores clinical vocabulary above general English', () => {
    expect(clinicalScore('posterior pelvic tilt of 15 degrees')).toBeGreaterThan(
      clinicalScore('it was quite a nice day outside')
    );
  });

  it('exposes a non-empty phrase-bias list for engines that support it', () => {
    const hints = getRecognitionPhraseHints();
    expect(hints.length).toBeGreaterThan(50);
    expect(hints).toContain('pelvic obliquity');
  });
});
