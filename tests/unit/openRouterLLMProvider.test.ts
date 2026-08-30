import { OpenRouterLLMProvider, OpenRouterModelClient } from '../../src/providers/llm/OpenRouterLLMProvider';
import { CanonicalTranscriptSegment } from '../../src/types';

describe('OpenRouterLLMProvider Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports NOT CONFIGURED when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_API_KEY;
    const provider = new OpenRouterLLMProvider();
    const health = await provider.checkHealth();
    expect(health.status).toBe('NOT CONFIGURED');
  });

  it('throws error when extractStructuredNote is called with empty segments', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    const provider = new OpenRouterLLMProvider();
    await expect(provider.extractStructuredNote([])).rejects.toThrow('No transcript segments supplied');
  });

  it('initializes OpenRouterModelClient with custom model', () => {
    const client = new OpenRouterModelClient('test-key', 'openai/gpt-4o-mini');
    expect(client.name).toBe('OpenRouter:openai/gpt-4o-mini');
  });
});
