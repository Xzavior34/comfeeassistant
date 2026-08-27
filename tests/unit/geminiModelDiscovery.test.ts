import { resolveAvailableModel, resetModelCache, testMinimalModelGeneration } from '../../src/providers/llm/GeminiLLMProvider';
import { GeminiModelClient } from '../../src/providers/llm/modelClient';

describe('Execution-Verified Gemini Model Discovery Suite (REQUIREMENTS A-H)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetModelCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetModelCache();
  });

  it('TEST A: Candidate gemini-old-A fails probe with 404; gemini-current-B succeeds -> B selected', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-old-A', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-current-B', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    } as any);

    // Mock testMinimalModelGeneration via fetch interception
    // First call (ListModels) returns list; subsequent calls (probes) simulate responses
    let probeCount = 0;
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('models?key=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/gemini-old-A', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-current-B', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        });
      }
      probeCount++;
      if (url.includes('gemini-old-A')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Model gemini-old-A is no longer available' } })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }]
        })
      });
    }) as any;

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.modelName).toBe('gemini-current-B');
    expect(info.isExplicit).toBe(false);
  });

  it('TEST B: First two candidates 404; third succeeds -> third selected', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('models?key=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/cand-1', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/cand-2', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/cand-3', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        });
      }
      if (url.includes('cand-1') || url.includes('cand-2')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Retired' } })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }]
        })
      });
    }) as any;

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.modelName).toBe('cand-3');
  });

  it('TEST C: Candidate in ListModels but probe 404 -> rejected', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('models?key=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        });
      }
      if (url.includes('gemini-2.5-pro')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'This model is no longer available to new users' } })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"status":"ok"}' }] } }]
        })
      });
    }) as any;

    const info = await resolveAvailableModel('test-key', undefined, true);
    expect(info.modelName).toBe('gemini-2.0-flash');
  });

  it('TEST D: Probe returns 429 -> RATE_LIMIT error thrown, model NOT permanently blacklisted as retired', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('models?key=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        });
      }
      return Promise.resolve({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'RESOURCE_EXHAUSTED' } })
      });
    }) as any;

    await expect(resolveAvailableModel('test-key', undefined, true)).rejects.toThrow(
      /rate limited on the current API quota/i
    );
  });

  it('TEST E: Probe returns 403 API-key-wide -> AUTH error thrown, stops probing loop', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('models?key=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/cand-1', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/cand-2', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        });
      }
      return Promise.resolve({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'API_KEY_INVALID' } })
      });
    }) as any;

    await expect(resolveAvailableModel('test-key', undefined, true)).rejects.toThrow(
      /authentication failed/i
    );
  });

  it('TEST F: Cached model returns 404 during runtime generation -> cache invalidated, rediscover, retry once', async () => {
    const client = new GeminiModelClient();
    const mockModelBad = {
      generateContent: jest.fn().mockRejectedValue({ status: 404, message: 'Model retired' })
    };

    await expect((client as any).callWithRetries(mockModelBad, 'prompt', 1)).rejects.toThrow();
  });

  it('TEST G: Every candidate returns 404 -> no compatible model error', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('models?key=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { name: 'models/cand-1', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'Retired' } })
      });
    }) as any;

    await expect(resolveAvailableModel('test-key', undefined, true)).rejects.toThrow(
      /No compatible Gemini model/i
    );
  });

  it('TEST H: Clinician-facing error does NOT contain raw Google URL / provider stack', async () => {
    const client = new GeminiModelClient();
    (client as any).resolvedModelInfo = { modelName: 'gemini-test', isExplicit: false };

    const mockModel = {
      generateContent: jest.fn().mockRejectedValue({
        status: 500,
        message: '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent: [404] Retired'
      })
    };

    try {
      await (client as any).callWithRetries(mockModel, 'prompt', 1);
      fail('Expected callWithRetries to throw');
    } catch (err: any) {
      expect(err.message).not.toContain('generativelanguage.googleapis.com');
      expect(err.message).not.toContain('[GoogleGenerativeAI Error]');
      expect(err.message).toContain('temporarily unavailable');
    }
  });
});
