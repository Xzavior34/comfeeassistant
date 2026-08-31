/**
 * @jest-environment jsdom
 */
import { LiveTranscriptionService } from '../../frontend/src/services/speech';
import { canRecordAlongsideRecognition } from '../../frontend/src/services/audioRecorder';

/**
 * Tests for the mobile microphone-contention fix.
 *
 * The defect: transcription worked on a laptop and produced nothing on a phone. A
 * getUserMedia stream for MediaRecorder was opened before SpeechRecognition started.
 * Desktop Chrome shares the microphone between the two; Android Chrome and iOS give it to
 * whichever consumer asks first. The recogniser therefore started, fired `onstart`, and then
 * received no audio at all — no `onaudiostart`, no results, and crucially no error. The
 * clinician saw an empty transcript with nothing on screen explaining why.
 *
 * The failure mode is silence, which is exactly what makes it hard to catch. These tests
 * reproduce it deterministically: a recogniser that starts and then never delivers audio.
 */

class FakeRecognition {
  static instances: FakeRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;

  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onsoundend: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;

  started = 0;
  stopped = 0;
  aborted = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  /** Mirrors the real API: start() only reports that it began, not that audio flows. */
  start() {
    this.started++;
    this.onstart?.();
  }
  stop() {
    this.stopped++;
  }
  abort() {
    this.aborted++;
  }

  /** The working case: the microphone is available and audio reaches the recogniser. */
  deliverAudio() {
    this.onaudiostart?.();
  }

  emitFinal(text: string) {
    const entry: any = [{ transcript: text, confidence: 0.9 }];
    entry.isFinal = true;
    entry.length = 1;
    const results: any = [entry];
    results.length = 1;
    this.onresult?.({ resultIndex: 0, results });
  }
}

function setUserAgent(ua: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as any).SpeechRecognition = FakeRecognition;
  (window as any).webkitSpeechRecognition = undefined;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const DESKTOP_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

describe('Platform detection decides who gets the microphone', () => {
  it('refuses concurrent recording on the phone the bug was reported from', () => {
    setUserAgent(ANDROID);
    expect(canRecordAlongsideRecognition()).toBe(false);
  });

  it('refuses concurrent recording on iPhone', () => {
    setUserAgent(IPHONE);
    expect(canRecordAlongsideRecognition()).toBe(false);
  });

  it('refuses on iPadOS, which reports a desktop user agent', () => {
    // iPadOS masquerades as macOS; maxTouchPoints is what gives it away, and it arbitrates
    // the microphone like iOS rather than like a desktop.
    setUserAgent(IPAD_DESKTOP_UA, 5);
    expect(canRecordAlongsideRecognition()).toBe(false);
  });

  it('still allows concurrent recording on desktop, where it has always worked', () => {
    setUserAgent(DESKTOP_CHROME);
    expect(canRecordAlongsideRecognition()).toBe(true);

    setUserAgent(DESKTOP_MAC, 0);
    expect(canRecordAlongsideRecognition()).toBe(true);
  });
});

describe('The watchdog catches a recogniser that started but is deaf', () => {
  it('reproduces the reported failure and reports it instead of staying silent', () => {
    setUserAgent(ANDROID);
    const service = new LiveTranscriptionService();
    const statuses: string[] = [];
    let contentionHandlerCalls = 0;

    service.setMicContentionHandler(() => {
      contentionHandlerCalls++;
    });

    service.start(
      () => undefined,
      (m) => statuses.push(m)
    );

    const engine = FakeRecognition.instances[0];
    expect(engine.started).toBe(1);

    // This is the exact bug: onstart fired, so everything looks fine, but no audio ever
    // arrives because MediaRecorder holds the microphone.
    expect(service.getDiagnostics().diagnostics.recognition_started).toBe(true);
    expect(service.getDiagnostics().diagnostics.audio_start).toBe(false);
    expect(service.getDiagnostics().diagnostics.mic_contention).toBe(false);

    jest.advanceTimersByTime(3100);

    // Previously this state persisted forever with nothing on screen.
    expect(service.getDiagnostics().diagnostics.mic_contention).toBe(true);
    expect(contentionHandlerCalls).toBe(1);
    expect(statuses.join(' ')).toMatch(/not receiving audio/i);
    expect(statuses.join(' ')).toMatch(/one of them at a time/i);
  });

  it('stays quiet when the microphone is working', () => {
    setUserAgent(DESKTOP_CHROME);
    const service = new LiveTranscriptionService();
    let contentionHandlerCalls = 0;
    service.setMicContentionHandler(() => {
      contentionHandlerCalls++;
    });

    service.start(() => undefined, () => undefined);
    const engine = FakeRecognition.instances[0];

    engine.deliverAudio();
    jest.advanceTimersByTime(5000);

    expect(service.getDiagnostics().diagnostics.audio_start).toBe(true);
    expect(service.getDiagnostics().diagnostics.mic_contention).toBe(false);
    expect(contentionHandlerCalls).toBe(0);
  });

  it('does not fire after the clinician has ended the assessment', () => {
    setUserAgent(ANDROID);
    const service = new LiveTranscriptionService();
    let contentionHandlerCalls = 0;
    service.setMicContentionHandler(() => {
      contentionHandlerCalls++;
    });

    service.start(() => undefined, () => undefined);
    service.stop();

    jest.advanceTimersByTime(5000);

    // A stale warning after the session has ended would be alarming and meaningless.
    expect(contentionHandlerCalls).toBe(0);
  });
});

describe('Recovery after the microphone is released', () => {
  it('restarts recognition and listens again', () => {
    setUserAgent(ANDROID);
    const service = new LiveTranscriptionService();
    const statuses: string[] = [];

    // Mirrors what App.tsx does: discard the recorder, then retry.
    service.setMicContentionHandler(() => {
      service.retryAfterMicRelease();
    });

    service.start(
      () => undefined,
      (m) => statuses.push(m)
    );
    const engine = FakeRecognition.instances[0];
    const startsBefore = engine.started;

    jest.advanceTimersByTime(3100); // watchdog fires
    jest.advanceTimersByTime(400); // retry delay

    expect(engine.aborted).toBe(1);
    expect(engine.started).toBeGreaterThan(startsBefore);
    expect(service.getDiagnostics().diagnostics.mic_contention).toBe(false);
  });

  it('captures speech normally once the microphone is free', () => {
    setUserAgent(ANDROID);
    const service = new LiveTranscriptionService();

    service.setMicContentionHandler(() => service.retryAfterMicRelease());
    service.start(() => undefined, () => undefined);

    const engine = FakeRecognition.instances[0];
    jest.advanceTimersByTime(3100);
    jest.advanceTimersByTime(400);

    // The retry succeeds and audio now reaches the recogniser.
    engine.deliverAudio();
    engine.emitFinal('The seat width is forty four centimetres.');

    expect(service.getFrozenText()).toBe('The seat width is forty four centimetres.');
  });

  it('does not retry after a fatal permission error', () => {
    setUserAgent(ANDROID);
    const service = new LiveTranscriptionService();
    service.setMicContentionHandler(() => service.retryAfterMicRelease());

    service.start(() => undefined, () => undefined);
    const engine = FakeRecognition.instances[0];
    const startsBefore = engine.started;

    engine.onerror?.({ error: 'not-allowed' });
    jest.advanceTimersByTime(5000);

    // Retrying into a denied microphone is a loop, not a recovery.
    expect(engine.started).toBe(startsBefore);
  });
});
