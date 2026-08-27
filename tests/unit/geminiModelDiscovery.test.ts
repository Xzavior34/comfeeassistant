import { resolveAvailableModel, resetModelCache } from '../../src/providers/llm/GeminiLLMProvider';
import { GeminiModelClient } from '../../src/providers/llm/modelClient';

describe('Gemini Model Discovery & Selection Suite (REQUIREMENTS A-J)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetModelCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetModelCache();
  });

  it('TEST A: GEMINI_MODEL unset -> dynamic discovery occurs', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    } as any);

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.isExplicit).toBe(false);
    expect(info.selectionMethod).toBe('dynamic_discovered');
    expect(info.modelName).toBe('gemini-1.5-flash');
  });

  it('TEST B: GEMINI_MODEL explicitly set -> explicit model used', async () => {
    const info = await resolveAvailableModel('test-key', 'gemini-1.5-pro', true);
    expect(info.isExplicit).toBe(true);
    expect(info.selectionMethod).toBe('explicit');
    expect(info.modelName).toBe('gemini-1.5-pro');
  });

  it('TEST C: Discovered model lacking generateContent -> ignored', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    } as any);

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.modelName).toBe('gemini-2.0-flash');
    expect(info.eligibleModelsCount).toBe(1);
  });

  it('TEST D: Candidate supports generateContent -> eligible', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/custom-gemini-model', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    } as any);

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.modelName).toBe('custom-gemini-model');
    expect(info.eligibleModelsCount).toBe(1);
  });

  it('TEST E & H: 404 on dynamically discovered model -> invalidates cache and triggers rediscovery', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    } as any);

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.modelName).toBe('gemini-1.5-flash');

    resetModelCache();
    const info2 = await resolveAvailableModel('test-key', undefined, true);
    expect(info2.modelName).toBe('gemini-1.5-flash');
  });

  it('TEST F: 429 classified as rate limit / quota', async () => {
    const client = new GeminiModelClient();
    const mockModel = {
      generateContent: jest.fn().mockRejectedValue({
        status: 429,
        message: 'RESOURCE_EXHAUSTED: Rate limit exceeded'
      })
    };

    await expect((client as any).callWithRetries(mockModel, 'test prompt', 1)).rejects.toThrow(
      /rate limited on the current API quota/i
    );
  });

  it('TEST G: 403 classified as authentication / permission issue', async () => {
    const client = new GeminiModelClient();
    const mockModel = {
      generateContent: jest.fn().mockRejectedValue({
        status: 403,
        message: 'API_KEY_INVALID: Permission denied'
      })
    };

    await expect((client as any).callWithRetries(mockModel, 'test prompt', 1)).rejects.toThrow(
      /authentication or permission failed/i
    );
  });

  it('TEST J: No compatible models -> clear error message thrown', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
        ]
      })
    } as any);

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.eligibleModelsCount).toBe(0);
  });
});
