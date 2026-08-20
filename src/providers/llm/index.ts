import { LLMProvider } from './LLMProvider';
import { MockLLMProvider } from './MockLLMProvider';
import { GeminiLLMProvider } from './GeminiLLMProvider';
import { env } from '../../config/env';

export function getLLMProvider(): LLMProvider {
  if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'mock') {
    throw new Error('CRITICAL CONFIGURATION ERROR: LLM_PROVIDER cannot be set to "mock" in production mode.');
  }

  if (env.LLM_PROVIDER === 'gemini') {
    return new GeminiLLMProvider();
  }

  return new MockLLMProvider();
}
