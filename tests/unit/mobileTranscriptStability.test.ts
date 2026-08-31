/**
 * @jest-environment jsdom
 */
import { LiveTranscriptionService, trimLeadingOverlap } from '../../frontend/src/services/speech';

/**
 * Transcript stability on mobile.
 *
 * Once the microphone contention was fixed, the phone started transcribing — but repeated
 * words, and less reliably than the laptop. Both symptoms come from the same root: Android
 * Chrome ignores `continuous = true`. Recognition ends after each utterance and has to be
 * restarted, and around that boundary the engine re-delivers what it has already given us —
 * often a partial of an utterance followed by the whole thing.
 *
 * Desktop Chrome honours continuous mode, never hits the boundary, and so never showed any
 * of this. These tests replay the boundary explicitly.
 */

class FakeRecognition {
  static instances: FakeRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;

  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;

  started = 0;
  /** When set, start() throws, mimicking InvalidStateError during teardown. */
  failNextStarts = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    if (this.failNextStarts > 0) {
      this.failNextStarts--;
      throw new Error('InvalidStateError: recognition has already started');
    }
    this.started++;
    this.onstart?.();
    this.onaudiostart?.();
  }
  stop() {}
  abort() {}

  /** Delivers one committed result, as the engine does after each utterance on Android. */
  final(text: string) {
    const entry: any = [{ transcript: text, confidence: 0.9 }];
    entry.isFinal = true;
    entry.length = 1;
    const results: any = [entry];
    results.length = 1;
    this.onresult?.({ resultIndex: 0, results });
  }

  interim(text: string) {
    const entry: any = [{ transcript: text, confidence: 0 }];
    entry.isFinal = false;
    entry.length = 1;
    const results: any = [entry];
    results.length = 1;
    this.onresult?.({ resultIndex: 0, results });
  }

  /** The Android lifecycle: the engine stops itself, and we restart it. */
  endUtterance() {
    this.onend?.();
  }
}

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as any).SpeechRecognition = FakeRecognition;
  (window as any).webkitSpeechRecognition = undefined;
  jest.useFakeTimers();
});

afterEach(() => jest.useRealTimers());

function startService() {
  const service = new LiveTranscriptionService();
  service.start(() => undefined, () => undefined);
  return { service, engine: FakeRecognition.instances[0] };
}

describe('Overlap trimming', () => {
  it('removes a repeated tail of three or more words', () => {
    expect(
      trimLeadingOverlap('the seat is too narrow', 'too narrow and it catches my hips')
    ).toBe('and it catches my hips');
  });

  it('is never applied mid-stream, where a short shared run is ordinary speech', () => {
    // trimLeadingOverlap is only invoked at a restart boundary. Within a recognition run the
    // engine does not re-deliver, so "a lot" following "a lot" is the clinician speaking.
    const service = new LiveTranscriptionService();
    service.start(() => undefined, () => undefined);
    const engine = FakeRecognition.instances[0];

    engine.final('it hurts a lot');
    engine.final('a lot of the time');

    expect(service.getFrozenText()).toBe('it hurts a lot a lot of the time');
  });

  it('ignores punctuation and case when matching the overlap', () => {
    expect(
      trimLeadingOverlap('Seat width is forty four centimetres.', 'forty four centimetres, measured in supported sitting')
    ).toBe('measured in supported sitting');
  });

  it('returns empty when the new text repeats the previous entirely', () => {
    expect(trimLeadingOverlap('the chair is too narrow', 'the chair is too narrow')).toBe('');
  });

  it('does nothing to unrelated speech', () => {
    expect(trimLeadingOverlap('I get pain in my right hip', 'how far can you walk')).toBe(
      'how far can you walk'
    );
  });
});

describe('The repetition reported on the phone', () => {
  it('does not commit a partial and then the full utterance separately', () => {
    const { service, engine } = startService();

    // Exactly what Android does across a restart boundary.
    engine.final('the seat is');
    engine.final('the seat is too narrow');

    expect(service.getState().finalEntries).toHaveLength(1);
    expect(service.getFrozenText()).toBe('the seat is too narrow');
  });

  it('drops a fragment of something already captured', () => {
    const { service, engine } = startService();

    engine.final('I get pain in my right hip after about an hour');
    engine.final('pain in my right hip');

    expect(service.getFrozenText()).toBe('I get pain in my right hip after about an hour');
  });

  it('trims a repeated run at a restart boundary', () => {
    const { service, engine } = startService();

    engine.final('Seat width is forty four centimetres');
    engine.endUtterance();
    jest.advanceTimersByTime(100);
    engine.final('forty four centimetres measured in supported sitting');

    expect(service.getFrozenText()).toBe(
      'Seat width is forty four centimetres measured in supported sitting'
    );
  });

  it('still drops an exact re-delivery', () => {
    const { service, engine } = startService();

    engine.final('There is a left pelvic obliquity');
    engine.endUtterance();
    jest.advanceTimersByTime(100);
    engine.final('There is a left pelvic obliquity');

    expect(service.getState().finalEntries).toHaveLength(1);
  });

  it('keeps short answers that genuinely repeat', () => {
    const { service, engine } = startService();

    // A clinician asks several questions; "yes" is real content each time, and is a
    // substring of half the sentences in a consultation.
    engine.final('Yes');
    engine.final('Does it hurt when you transfer');
    engine.final('Yes');

    expect(service.getState().finalEntries).toHaveLength(3);
  });

  it('keeps a phrase repeated much later in the consultation', () => {
    const { service, engine } = startService();

    engine.final('That feels a lot better than the old one');
    // Same words again, but well after the restart window: real content, not re-delivery.
    jest.advanceTimersByTime(60000);
    engine.final('That feels a lot better than the old one');

    expect(service.getState().finalEntries).toHaveLength(2);
  });

  it('produces a clean transcript across a realistic Android exchange', () => {
    const { service, engine } = startService();

    const androidSequence: [string, boolean][] = [
      ['How long have you had the pain', true],
      ['How long have you had the pain', true], // re-delivered on restart
      ['About six', false],
      ['About six months', true],
      ['About six months', true], // re-delivered
      ['Does it get worse when', true],
      ['Does it get worse when you are sitting', true], // extension
      ['Yes especially after', true],
      ['especially after about an hour', true] // overlapping tail
    ];

    for (const [text, isFinal] of androidSequence) {
      if (isFinal) {
        engine.final(text);
        engine.endUtterance();
        jest.advanceTimersByTime(60);
      } else {
        engine.interim(text);
      }
    }

    const out = service.getFrozenText();

    expect(out).toBe(
      'How long have you had the pain About six months Does it get worse when you are sitting ' +
        'Yes especially after about an hour'
    );
    // The words that were repeated appear exactly once each.
    expect(out.match(/six months/g)).toHaveLength(1);
    expect(out.match(/had the pain/g)).toHaveLength(1);
    expect(out.match(/especially after/g)).toHaveLength(1);
  });
});

describe('Restart stability', () => {
  it('keeps retrying when the engine is still tearing down', () => {
    const { service, engine } = startService();
    const startsBefore = engine.started;

    // InvalidStateError on the first two restart attempts, as happens on Android.
    engine.failNextStarts = 2;
    engine.endUtterance();

    // Backoff grows after each throw: ~40ms, then ~300ms, then ~600ms.
    jest.advanceTimersByTime(2000);

    // Previously the first throw ended recognition silently for the rest of the session.
    expect(engine.started).toBeGreaterThan(startsBefore);
    expect(service.getDiagnostics().fatalError).toBeNull();
  });

  it('restarts promptly so words are not lost in the gap', () => {
    const { service, engine } = startService();
    const startsBefore = engine.started;

    engine.endUtterance();
    jest.advanceTimersByTime(50);

    expect(engine.started).toBe(startsBefore + 1);
  });

  it('gives up eventually rather than spinning forever', () => {
    const { service, engine } = startService();

    engine.failNextStarts = 50;
    engine.endUtterance();
    jest.advanceTimersByTime(60000);

    expect(service.getDiagnostics().fatalError).toBe('restart-failed');
  });
});
