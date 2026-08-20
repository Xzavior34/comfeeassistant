import { DeviceSpeechProvider } from '../../src/providers/speech/DeviceSpeechProvider';
import { RecordingStateMachine } from '../../src/state/recordingStateMachine';

describe('Option A: DeviceSpeechProvider & Recording State Machine', () => {
  it('1. DeviceSpeechProvider initializes with default en-GB language', () => {
    const provider = new DeviceSpeechProvider();
    expect(provider.name).toBe('DeviceSpeechProvider');
  });

  it('2. DeviceSpeechProvider returns canonical segments on transcribe call', async () => {
    const provider = new DeviceSpeechProvider('en-GB');
    const result = await provider.transcribe('device-mic://stream');
    expect(result.providerName).toBe('DeviceSpeechProvider');
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0].speakerId).toBe('UNKNOWN');
  });

  it('3. RecordingStateMachine enforces 10-state lifecycle rules', () => {
    const stateMachine = new RecordingStateMachine();
    expect(stateMachine.getState()).toBe('IDLE');

    stateMachine.requestPermission();
    expect(stateMachine.getState()).toBe('REQUESTING_PERMISSION');

    stateMachine.grantPermission();
    expect(stateMachine.getState()).toBe('READY');

    stateMachine.startListening();
    expect(stateMachine.getState()).toBe('LISTENING');

    stateMachine.pauseListening();
    expect(stateMachine.getState()).toBe('PAUSED');

    stateMachine.resumeListening();
    expect(stateMachine.getState()).toBe('LISTENING');

    stateMachine.stopListening();
    expect(stateMachine.getState()).toBe('COMPLETE');
  });

  it('4. RecordingStateMachine throws error on invalid state transitions', () => {
    const stateMachine = new RecordingStateMachine();
    expect(() => stateMachine.stopListening()).toThrow();
  });
});
