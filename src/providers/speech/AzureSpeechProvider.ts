import { SpeechProvider, TranscriptionOptions, ProviderHealthCheckResult } from './SpeechProvider';
import { ProviderTranscript, ProviderTranscriptSegment } from '../../types';
import { getRecognitionPhraseHints } from '../../services/clinicalLexicon';
import { getStorageProvider } from '../storage';

/**
 * Azure AI Speech fast transcription, with diarisation and clinical phrase biasing.
 *
 * Offered alongside the Google provider because the two differ in ways that matter here:
 * Azure's diarisation handles the short overlapping turns typical of a clinic conversation
 * more gracefully, and UK South keeps audio in-region, which is usually the easier
 * conversation to have with an NHS information-governance team.
 *
 * Uses the REST fast-transcription endpoint rather than the Speech SDK so the service keeps
 * no native dependency and no long-lived websocket.
 */

interface AzurePhrase {
  text: string;
}

export class AzureSpeechProvider implements SpeechProvider {
  name = 'AzureSpeech';

  private key(): string | null {
    return process.env.AZURE_SPEECH_KEY || null;
  }

  private region(): string | null {
    return process.env.AZURE_SPEECH_REGION || null;
  }

  async checkHealth(): Promise<ProviderHealthCheckResult> {
    if (!this.key() || !this.region()) {
      return {
        status: 'NOT CONFIGURED',
        providerName: this.name,
        details: 'Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (e.g. uksouth) to enable diarised transcription.'
      };
    }

    return {
      status: 'CONNECTED',
      providerName: this.name,
      details:
        `Region ${this.region()}. Speaker diarisation enabled. Clinical phrase list active ` +
        `(${getRecognitionPhraseHints().length} terms).`
    };
  }

  /**
   * Azure caps the phrase list, and an over-long list dilutes the bias applied to each
   * entry. The most distinctive multi-word clinical terms are kept in preference to short
   * common words, which the base model already handles.
   */
  private phraseList(extra: string[]): AzurePhrase[] {
    const ranked = [...getRecognitionPhraseHints()].sort((a, b) => b.length - a.length);
    return [...extra, ...ranked].slice(0, 500).map((text) => ({ text }));
  }

  async transcribe(audioUri: string, options?: TranscriptionOptions): Promise<ProviderTranscript> {
    const health = await this.checkHealth();
    if (health.status !== 'CONNECTED') {
      throw new Error(`[AzureSpeechProvider] ${health.details}`);
    }

    const locale = options?.languageCode || process.env.SPEECH_LANGUAGE || 'en-GB';
    const expectedSpeakers = options?.expectedSpeakerCount ?? 2;

    const definition = {
      locales: [locale],
      diarization: {
        // Allow one more than expected so an accompanying carer is separated rather than
        // being merged into the patient's voice.
        maxSpeakers: Math.max(2, expectedSpeakers + 1),
        enabled: options?.enableDiarization !== false
      },
      profanityFilterMode: 'None',
      phraseLists: this.phraseList(options?.additionalPhrases ?? []).map((p) => p.text)
    };

    const audio = await getStorageProvider().retrieve(audioUri);

    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(audio)]), 'consultation.wav');
    form.append('definition', JSON.stringify(definition));

    const endpoint =
      `https://${this.region()}.api.cognitive.microsoft.com` +
      `/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': this.key() as string },
      body: form as any
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`[AzureSpeechProvider] Transcription failed (HTTP ${res.status}): ${detail}`);
    }

    const payload: any = await res.json();
    return this.toProviderTranscript(payload);
  }

  private toProviderTranscript(payload: any): ProviderTranscript {
    const phrases: any[] = payload?.phrases ?? [];

    if (phrases.length === 0) {
      throw new Error(
        '[AzureSpeechProvider] Transcription returned no speech. No clinical note can be ' +
          'generated from this recording.'
      );
    }

    const segments: ProviderTranscriptSegment[] = phrases.map((p) => ({
      speakerId: typeof p.speaker === 'number' ? `Speaker ${p.speaker}` : 'UNKNOWN',
      startTimeMs: Math.round(p.offsetMilliseconds ?? 0),
      endTimeMs: Math.round((p.offsetMilliseconds ?? 0) + (p.durationMilliseconds ?? 0)),
      text: String(p.text ?? '').trim(),
      // Azure reports its own confidence; absent means unknown, never assumed good.
      confidence: typeof p.confidence === 'number' && p.confidence > 0 ? p.confidence : null
    }));

    return {
      providerName: this.name,
      durationMs: payload?.durationMilliseconds ?? segments[segments.length - 1]?.endTimeMs ?? 0,
      segments: segments.filter((s) => s.text.length > 0)
    };
  }
}
