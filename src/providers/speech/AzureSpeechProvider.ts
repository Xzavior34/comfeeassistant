import { SpeechProvider, TranscriptionOptions, ProviderHealthCheckResult } from './SpeechProvider';
import { ProviderTranscript } from '../../types';

export class AzureSpeechProvider implements SpeechProvider {
  name = 'AzureSpeechSDK';

  async checkHealth(): Promise<ProviderHealthCheckResult> {
    const speechKey = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    if (!speechKey || !region) {
      return {
        status: 'NOT CONFIGURED',
        providerName: this.name,
        details: 'Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION in environment'
      };
    }

    return {
      status: 'CONNECTED',
      providerName: this.name,
      details: `Configured for Azure Speech Region: ${region}`
    };
  }

  async transcribe(audioUri: string, options?: TranscriptionOptions): Promise<ProviderTranscript> {
    const health = await this.checkHealth();
    if (health.status !== 'CONNECTED') {
      throw new Error(`Azure Speech SDK unavailable: ${health.details}`);
    }

    throw new Error('Real Azure Speech SDK API requires live cloud credentials. Set AZURE_SPEECH_KEY in .env');
  }
}
