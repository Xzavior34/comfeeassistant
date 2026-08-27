/**
 * @jest-environment jsdom
 */
import { LiveTranscriptionService } from '../../frontend/src/services/speech';

/**
 * Tests for the live transcription layer.
 *
 * A fake SpeechRecognition stands in for the browser's, so the exact event sequences that
 * caused the transcript defects — growing interim results, a re-delivered final result, an
 * unexpected end mid-session — can be reproduced deterministically.
 */

interface FakeAlternative {
  transcript: string;
  confidence?: number;
}

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;

  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;

  started = 0;
  stopped = 0;

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }

  /** Emits a result event shaped like the real API's. */
  emit(results: { alternatives: FakeAlternative[]; isFinal: boolean }[], resultIndex = 0) {
    const list: any = results.map((r) => {
      const entry: any = r.alternatives.map((a) => ({ ...a }));
      entry.isFinal = r.isFinal;
      entry.length = r.alternatives.length;
      return entry;
    });
    list.length = results.length;
    this.onresult?.({ resultIndex, results: list });
  }
}

beforeEach(() => {
  FakeSpeechRecognition.instances = [];
  (window as any).SpeechRecognition = FakeSpeechRecognition;
  (window as any).webkitSpeechRecognition = undefined;
});

function startService() {
  const service = new LiveTranscriptionService();
  const statuses: string[] = [];
  service.start(
    () => undefined,
    (m) => statuses.push(m)
  );
  return { service, statuses, engine: FakeSpeechRecognition.instances[0] };
}

describe('A. Interim results do not duplicate the transcript', () => {
  it('replaces the interim hypothesis instead of appending each version', () => {
    const { service, engine } = startService();

    // The engine's growing hypothesis, exactly as it arrives in practice.
    engine.emit([{ alternatives: [{ transcript: 'I believe' }], isFinal: false }]);
    engine.emit([{ alternatives: [{ transcript: 'I believe the' }], isFinal: false }]);
    engine.emit([{ alternatives: [{ transcript: 'I believe the chair' }], isFinal: false }]);

    const state = service.getState();
    // None of it is committed while it is still interim.
    expect(state.finalEntries).toHaveLength(0);
    expect(state.interimText).toBe('I believe the chair');
    expect(service.getFrozenText()).toBe('');
  });

  it('commits nothing to the transcript until a result is final', () => {
    const { service, engine } = startService();
    engine.emit([{ alternatives: [{ transcript: 'the seat is too narrow' }], isFinal: false }]);
    expect(service.getFrozenText()).toBe('');
  });
});

describe('B. A final result is appended exactly once', () => {
  it('commits the final text and clears the interim', () => {
    const { service, engine } = startService();

    engine.emit([{ alternatives: [{ transcript: 'I believe the' }], isFinal: false }]);
    engine.emit([{ alternatives: [{ transcript: 'I believe the chair is too narrow', confidence: 0.9 }], isFinal: true }]);

    const state = service.getState();
    expect(state.finalEntries).toHaveLength(1);
    expect(state.interimText).toBe('');
    expect(service.getFrozenText()).toBe('I believe the chair is too narrow');
  });

  it('does not commit a final result the engine re-delivers', () => {
    const { service, engine } = startService();

    engine.emit([{ alternatives: [{ transcript: 'Seat width is 44 centimetres' }], isFinal: true }]);
    engine.emit([{ alternatives: [{ transcript: 'Seat width is 44 centimetres' }], isFinal: true }]);
    // Punctuation and case differences are still the same utterance.
    engine.emit([{ alternatives: [{ transcript: 'seat width is 44 centimetres.' }], isFinal: true }]);

    expect(service.getState().finalEntries).toHaveLength(1);
  });

  it('records a null confidence when the engine supplies none', () => {
    const { service, engine } = startService();
    // Chrome commonly reports 0, which must never be read as high confidence.
    engine.emit([{ alternatives: [{ transcript: 'Hello there', confidence: 0 }], isFinal: true }]);
    expect(service.getState().finalEntries[0].confidence).toBeNull();
    expect(service.getDiagnostics().confidenceUnavailable).toBe(true);
  });
});

describe('C. No alternating fake speaker labels', () => {
  it('produces a transcript with no speaker attribution of any kind', () => {
    const { service, engine } = startService();

    engine.emit([{ alternatives: [{ transcript: 'How long have you had the pain?' }], isFinal: true }]);
    engine.emit([{ alternatives: [{ transcript: 'About six months.' }], isFinal: true }]);
    engine.emit([{ alternatives: [{ transcript: 'Does it get worse when sitting?' }], isFinal: true }]);

    const text = service.getFrozenText();
    expect(text).toBe('How long have you had the pain? About six months. Does it get worse when sitting?');
    expect(text).not.toMatch(/speaker/i);
    expect(text).not.toMatch(/therapist/i);
    expect(text).not.toMatch(/client:/i);

    // There is no speaker field on a transcript entry at all, so nothing downstream can
    // reintroduce a guess.
    expect(Object.keys(service.getState().finalEntries[0]).sort()).toEqual(['atMs', 'confidence', 'text']);
  });
});

describe('D. Restart does not duplicate content', () => {
  it('restarts recognition when it ends unexpectedly mid-session', async () => {
    const { service, engine } = startService();

    engine.emit([{ alternatives: [{ transcript: 'First statement.' }], isFinal: true }]);
    engine.onend?.();

    await new Promise((r) => setTimeout(r, 400));

    expect(engine.started).toBeGreaterThan(1);
    expect(service.getDiagnostics().restartCount).toBe(1);
    expect(service.getFrozenText()).toBe('First statement.');
  });

  it('does not duplicate a result re-delivered after a restart', async () => {
    const { service, engine } = startService();

    engine.emit([{ alternatives: [{ transcript: 'Pelvic obliquity on the left.' }], isFinal: true }]);
    engine.onend?.();
    await new Promise((r) => setTimeout(r, 400));
    engine.emit([{ alternatives: [{ transcript: 'Pelvic obliquity on the left.' }], isFinal: true }]);

    expect(service.getState().finalEntries).toHaveLength(1);
  });

  it('does not restart after the clinician stops', async () => {
    const { service, engine } = startService();
    service.stop();
    const startsAtStop = engine.started;

    engine.onend?.();
    await new Promise((r) => setTimeout(r, 400));

    expect(engine.started).toBe(startsAtStop);
  });

  it('does not restart after a fatal permission error', async () => {
    const { service, engine, statuses } = startService();

    engine.onerror?.({ error: 'not-allowed' });
    const startsAtError = engine.started;
    engine.onend?.();
    await new Promise((r) => setTimeout(r, 400));

    expect(engine.started).toBe(startsAtError);
    expect(service.getDiagnostics().fatalError).toBe('not-allowed');
    expect(statuses.join(' ')).toMatch(/microphone access was blocked/i);
  });

  it('treats no-speech as routine and keeps going', () => {
    const { service, engine, statuses } = startService();
    engine.onerror?.({ error: 'no-speech' });
    expect(service.getDiagnostics().fatalError).toBeNull();
    expect(statuses).toHaveLength(0);
  });
});

describe('E. End Assessment freezes the transcript', () => {
  it('returns the committed text and discards the uncommitted hypothesis', () => {
    const { service, engine } = startService();

    engine.emit([{ alternatives: [{ transcript: 'The seat has gone flat.' }], isFinal: true }]);
    engine.emit([{ alternatives: [{ transcript: 'and it is too nar' }], isFinal: false }]);

    const frozen = service.stop();

    expect(frozen.text).toBe('The seat has gone flat.');
    // Promoting an uncommitted hypothesis would be inventing the one thing the engine
    // declined to assert.
    expect(frozen.discardedInterim).toBe('and it is too nar');
    expect(engine.stopped).toBe(1);
  });

  it('leaves the frozen transcript stable after stopping', () => {
    const { service, engine } = startService();
    engine.emit([{ alternatives: [{ transcript: 'Final content.' }], isFinal: true }]);
    const frozen = service.stop();
    engine.emit([{ alternatives: [{ transcript: 'Late arrival.' }], isFinal: true }]);
    expect(service.getFrozenText()).toBe(frozen.text);
  });
});

describe('F. Empty transcript is handled', () => {
  it('returns empty text rather than throwing when nothing was recognised', () => {
    const { service } = startService();
    const frozen = service.stop();
    expect(frozen.text).toBe('');
    expect(frozen.entries).toHaveLength(0);
    expect(service.getDiagnostics().producedAnyText).toBe(false);
  });

  it('reports unsupported browsers without preventing the assessment', () => {
    (window as any).SpeechRecognition = undefined;
    (window as any).webkitSpeechRecognition = undefined;

    const service = new LiveTranscriptionService();
    const statuses: string[] = [];
    const started = service.start(
      () => undefined,
      (m) => statuses.push(m)
    );

    expect(started).toBe(false);
    expect(statuses[0]).toMatch(/audio recording will continue/i);
  });
});

describe('Recovery', () => {
  it('restores a checkpointed transcript', () => {
    const service = new LiveTranscriptionService();
    service.restore([
      { text: 'Recovered statement one.', atMs: 0, confidence: null },
      { text: 'Recovered statement two.', atMs: 100, confidence: 0.8 }
    ]);
    expect(service.getFrozenText()).toBe('Recovered statement one. Recovered statement two.');
  });
});
