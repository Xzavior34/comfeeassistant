import { LLMProvider } from './LLMProvider';
import { MockLLMProvider } from './MockLLMProvider';
import { GeminiLLMProvider } from './GeminiLLMProvider';
import { OpenRouterLLMProvider } from './OpenRouterLLMProvider';
import { env } from '../../config/env';

export function getLLMProvider(): LLMProvider {
  if (
    env.LLM_PROVIDER === 'openrouter' ||
    env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    env.LLM_API_KEY?.startsWith('sk-or-') ||
    process.env.LLM_API_KEY?.startsWith('sk-or-')
  ) {
    return new OpenRouterLLMProvider();
  }

  if (env.LLM_PROVIDER === 'gemini') {
    return new GeminiLLMProvider();
  }

  if (env.NODE_ENV === 'production') {
    const hasKey =
      env.OPENROUTER_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      env.LLM_API_KEY ||
      process.env.LLM_API_KEY;
    if (hasKey) {
      return new OpenRouterLLMProvider();
    }
    if (env.LLM_PROVIDER === 'mock') {
      throw new Error('CRITICAL CONFIGURATION ERROR: LLM_PROVIDER cannot be set to "mock" in production mode.');
    }
  }

  return new MockLLMProvider();
}
