import { GeminiLLMProvider } from '../../src/providers/llm/GeminiLLMProvider';
import { GoogleSpeechProvider } from '../../src/providers/speech/GoogleSpeechProvider';
import { getLLMProvider } from '../../src/providers/llm';
import { getSpeechProvider } from '../../src/providers/speech';

describe('Pre-Live Credential & Model Audit Verification', () => {
  it('GeminiLLMProvider checkHealth should return NOT CONFIGURED when LLM_API_KEY is absent', async () => {
    const gemini = new GeminiLLMProvider();
    const health = await gemini.checkHealth();
    expect(health.status).toBe('NOT CONFIGURED');
    expect(health.providerName).toBe('GoogleGeminiAPI');
  });

  it('GoogleSpeechProvider checkHealth should return NOT CONFIGURED when credentials are absent', async () => {
    const speech = new GoogleSpeechProvider();
    const health = await speech.checkHealth();
    expect(health.status).toBe('NOT CONFIGURED');
    expect(health.providerName).toBe('GoogleCloudSpeech');
  });

  it('LLM provider factory should return MockLLMProvider in development mode', () => {
    const provider = getLLMProvider();
    expect(provider.name).toBe('MockLLMProvider');
  });

  it('Speech provider factory should return DeviceSpeechProvider as default Option A provider', () => {
    const provider = getSpeechProvider();
    expect(provider.name).toBe('DeviceSpeechProvider');
  });
});
