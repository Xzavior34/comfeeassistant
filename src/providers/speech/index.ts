import { SpeechProvider } from './SpeechProvider';
import { MockSpeechProvider } from './MockSpeechProvider';
import { GoogleSpeechProvider } from './GoogleSpeechProvider';
import { AzureSpeechProvider } from './AzureSpeechProvider';
import { DeviceSpeechProvider } from './DeviceSpeechProvider';
import { env } from '../../config/env';

export function getSpeechProvider(): SpeechProvider {
  if (env.NODE_ENV === 'production' && env.SPEECH_PROVIDER === 'mock') {
    throw new Error('CRITICAL CONFIGURATION ERROR: SPEECH_PROVIDER cannot be set to "mock" in production mode.');
  }

  switch (env.SPEECH_PROVIDER) {
    case 'device':
      return new DeviceSpeechProvider();
    case 'google':
      return new GoogleSpeechProvider();
    case 'azure':
      return new AzureSpeechProvider();
    case 'mock':
      return new MockSpeechProvider();
    default:
      return new DeviceSpeechProvider();
  }
}
