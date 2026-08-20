import { GoogleSpeechProvider } from '../../src/providers/speech/GoogleSpeechProvider';
import { AzureSpeechProvider } from '../../src/providers/speech/AzureSpeechProvider';
import { MockSpeechProvider } from '../../src/providers/speech/MockSpeechProvider';

describe('Speech Providers Integration & API Contract Verification', () => {
  it('MockSpeechProvider should deterministically return transcript with diarized speakers and timestamps', async () => {
    const mockProvider = new MockSpeechProvider();
    const result = await mockProvider.transcribe('local-recording://test.wav', { expectedSpeakerCount: 2 });

    expect(result.providerName).toBe('MockSpeechProvider');
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0].speakerId).toBeDefined();
    expect(result.segments[0].startTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.segments[0].confidence).toBeGreaterThan(0.9);
  });

  it('GoogleSpeechProvider should report unconfigured health status and throw error when credentials are absent', async () => {
    const google = new GoogleSpeechProvider();
    const health = await google.checkHealth();
    expect(health.status).toBe('NOT CONFIGURED');
    await expect(google.transcribe('test.wav')).rejects.toThrow('GoogleSpeechProvider');
  });

  it('AzureSpeechProvider should report unconfigured health status and throw error when credentials are absent', async () => {
    const azure = new AzureSpeechProvider();
    const health = await azure.checkHealth();
    expect(health.status).toBe('NOT CONFIGURED');
    await expect(azure.transcribe('test.wav')).rejects.toThrow('Azure Speech SDK unavailable');
  });
});
