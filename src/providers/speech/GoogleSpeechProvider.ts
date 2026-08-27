import { SpeechProvider, TranscriptionOptions, ProviderHealthCheckResult } from './SpeechProvider';
import { ProviderTranscript, ProviderTranscriptSegment } from '../../types';
import { getRecognitionPhraseHints } from '../../services/clinicalLexicon';
import { getStorageProvider } from '../storage';

/**
 * Google Cloud Speech-to-Text with speaker diarisation and clinical speech adaptation.
 *
 * This provider exists because the two capabilities the product actually needs are not
 * available in the browser:
 *
 *   1. Speaker diarisation. The W3C SpeechRecognition API returns text with no indication
 *      of who spoke. Any speaker label produced in the browser is therefore invented. Cloud
 *      recognition returns a per-word speaker tag derived from the audio itself.
 *
 *   2. Speech adaptation. Correcting "public ability" to "pelvic obliquity" after the fact
 *      is guesswork against a decision already made. Passing the clinical vocabulary to the
 *      recogniser as a boosted phrase set changes the decision itself, which is far more
 *      accurate than any post-hoc repair.
 *
 * Implemented against the v1 REST surface rather than the client library so the service
 * carries no additional native dependency and authenticates the same way as the existing
 * Gemini provider.
 */

const SPEECH_ENDPOINT = 'https://speech.googleapis.com/v1/speech';

/** Words the recogniser should be strongly biased toward, with per-class boost weight. */
interface PhraseSet {
  phrases: string[];
  boost: number;
}

/**
 * Builds the speech-adaptation contexts.
 *
 * Boost values are deliberately conservative. Google treats boost as a log-odds nudge, and
 * an aggressive value makes the recogniser hallucinate clinical terms into ordinary speech —
 * which in this product would mean inventing findings. 15 reliably recovers genuine clinical
 * terminology; above about 20 the false-positive rate climbs sharply.
 */
export function buildSpeechContexts(extraPhrases: string[] = []): PhraseSet[] {
  const clinical = getRecognitionPhraseHints();

  // Measurement patterns use Google's class tokens so spoken numbers attach to units.
  const measurementPatterns = [
    '$OPERAND centimetres',
    '$OPERAND cm',
    '$OPERAND millimetres',
    '$OPERAND inches',
    '$OPERAND degrees',
    '$OPERAND kilograms',
    'seat width $OPERAND',
    'seat depth $OPERAND',
    'seat to floor height $OPERAND',
    '$OPERAND degree posterior pelvic tilt',
    '$OPERAND degree pelvic obliquity'
  ];

  const sets: PhraseSet[] = [
    { phrases: clinical, boost: 15 },
    { phrases: measurementPatterns, boost: 12 }
  ];

  if (extraPhrases.length > 0) {
    // Session-specific terms (equipment model names, the person's own vocabulary) are
    // boosted harder because they are known to be present.
    sets.push({ phrases: extraPhrases, boost: 18 });
  }

  return sets;
}

interface GoogleWord {
  word: string;
  startTime?: string;
  endTime?: string;
  speakerTag?: number;
  confidence?: number;
}

/** Google returns durations as "12.300s". */
function parseDuration(value: string | undefined): number {
  if (!value) return 0;
  return Math.round(parseFloat(String(value).replace(/s$/, '')) * 1000) || 0;
}

/**
 * Collapses Google's per-word speaker tags into contiguous utterances.
 *
 * Diarisation is reported per word, not per sentence, so a naive mapping produces one
 * "segment" per word. Words are grouped while the speaker tag holds, and a new segment is
 * also started at a long pause so a single speaker's monologue does not become one
 * unmanageable block that later routing cannot split usefully.
 */
export function groupWordsBySpeaker(
  words: GoogleWord[],
  maxPauseMs = 1500
): ProviderTranscriptSegment[] {
  const segments: ProviderTranscriptSegment[] = [];
  let current: {
    tag: number;
    words: string[];
    start: number;
    end: number;
    confidences: number[];
  } | null = null;

  const flush = () => {
    if (!current || current.words.length === 0) return;
    const scored = current.confidences.filter((c) => typeof c === 'number' && c > 0);
    segments.push({
      speakerId: `Speaker ${current.tag}`,
      startTimeMs: current.start,
      endTimeMs: current.end,
      text: current.words.join(' ').replace(/\s+([,.;:?!])/g, '$1').trim(),
      // Segment confidence is the weakest word in it. Averaging hides the one misheard
      // word that changes a clinical meaning, which is exactly what must be surfaced.
      confidence: scored.length > 0 ? Math.min(...scored) : null
    });
    current = null;
  };

  for (const w of words) {
    const tag = typeof w.speakerTag === 'number' ? w.speakerTag : 0;
    const start = parseDuration(w.startTime);
    const end = parseDuration(w.endTime);

    const speakerChanged = current !== null && current.tag !== tag;
    const longPause = current !== null && start - current.end > maxPauseMs;

    if (speakerChanged || longPause) flush();

    if (current === null) {
      current = { tag, words: [], start, end, confidences: [] };
    }

    current.words.push(w.word);
    current.end = end || current.end;
    if (typeof w.confidence === 'number') current.confidences.push(w.confidence);
  }

  flush();
  return segments;
}

export class GoogleSpeechProvider implements SpeechProvider {
  name = 'GoogleCloudSpeech';

  private getAccessToken(): string | null {
    return process.env.GOOGLE_ACCESS_TOKEN || null;
  }

  private getApiKey(): string | null {
    return process.env.GOOGLE_SPEECH_API_KEY || null;
  }

  async checkHealth(): Promise<ProviderHealthCheckResult> {
    const hasCredential = !!(this.getApiKey() || this.getAccessToken());

    if (!hasCredential) {
      return {
        status: 'NOT CONFIGURED',
        providerName: this.name,
        details:
          'Set GOOGLE_SPEECH_API_KEY (API key) or GOOGLE_ACCESS_TOKEN (OAuth bearer token) to ' +
          'enable diarised cloud transcription.'
      };
    }

    return {
      status: 'CONNECTED',
      providerName: this.name,
      details:
        `Speaker diarisation enabled. Clinical speech adaptation active ` +
        `(${getRecognitionPhraseHints().length} boosted phrases). Language: ${
          process.env.SPEECH_LANGUAGE || 'en-GB'
        }.`
    };
  }

  private authQuery(): string {
    const key = this.getApiKey();
    return key ? `?key=${encodeURIComponent(key)}` : '';
  }

  private authHeaders(): Record<string, string> {
    const token = this.getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  /**
   * Transcribes the recording at `audioUri` with diarisation.
   *
   * `audioUri` may be a `gs://` object, which Google reads directly, or a key in the
   * configured storage provider, in which case the bytes are inlined. Inline audio is
   * capped by the API at roughly one minute, so a real consultation must be held in a
   * Cloud Storage bucket; that is enforced rather than silently truncated.
   */
  async transcribe(audioUri: string, options?: TranscriptionOptions): Promise<ProviderTranscript> {
    const health = await this.checkHealth();
    if (health.status !== 'CONNECTED') {
      throw new Error(`[GoogleSpeechProvider] ${health.details}`);
    }

    const languageCode = options?.languageCode || process.env.SPEECH_LANGUAGE || 'en-GB';
    const expectedSpeakers = options?.expectedSpeakerCount ?? 2;
    const diarise = options?.enableDiarization !== false;

    const config: Record<string, unknown> = {
      languageCode,
      // Alternative UK/Irish accents help materially in NHS clinics.
      alternativeLanguageCodes: languageCode.startsWith('en') ? ['en-IE', 'en-US'] : undefined,
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      // Two people in a quiet room at conversational distance.
      model: 'latest_long',
      useEnhanced: true,
      profanityFilter: false,
      maxAlternatives: 1,
      speechContexts: buildSpeechContexts(options?.additionalPhrases ?? []),
      ...(diarise
        ? {
            diarizationConfig: {
              enableSpeakerDiarization: true,
              minSpeakerCount: Math.min(2, expectedSpeakers),
              maxSpeakerCount: Math.max(2, expectedSpeakers + 1) // allow for a carer
            }
          }
        : {})
    };

    const audio = await this.resolveAudio(audioUri);

    const body = JSON.stringify({ config, audio });
    const isLongRunning = 'uri' in audio;
    const method = isLongRunning ? 'longrunningrecognize' : 'recognize';

    const res = await fetch(`${SPEECH_ENDPOINT}:${method}${this.authQuery()}`, {
      method: 'POST',
      headers: this.authHeaders(),
      body
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`[GoogleSpeechProvider] Recognition failed (HTTP ${res.status}): ${detail}`);
    }

    const payload: any = await res.json();
    const response = isLongRunning ? await this.awaitOperation(payload) : payload;

    return this.toProviderTranscript(response);
  }

  /** Polls a long-running recognition operation to completion. */
  private async awaitOperation(operation: any, timeoutMs = 15 * 60 * 1000): Promise<any> {
    if (operation.done) {
      if (operation.error) {
        throw new Error(`[GoogleSpeechProvider] Recognition failed: ${operation.error.message}`);
      }
      return operation.response;
    }

    const name = operation.name;
    if (!name) throw new Error('[GoogleSpeechProvider] Operation returned without a name.');

    const started = Date.now();
    let delay = 2000;

    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 15000);

      const poll = await fetch(
        `https://speech.googleapis.com/v1/operations/${encodeURIComponent(name)}${this.authQuery()}`,
        { headers: this.authHeaders() }
      );

      if (!poll.ok) continue;
      const state: any = await poll.json();

      if (state.done) {
        if (state.error) {
          throw new Error(`[GoogleSpeechProvider] Recognition failed: ${state.error.message}`);
        }
        return state.response;
      }
    }

    throw new Error('[GoogleSpeechProvider] Recognition timed out before the operation completed.');
  }

  /** Resolves the recording to either a Cloud Storage URI or inline bytes. */
  private async resolveAudio(audioUri: string): Promise<{ uri: string } | { content: string }> {
    if (audioUri.startsWith('gs://')) return { uri: audioUri };

    const storage = getStorageProvider();
    const buffer = await storage.retrieve(audioUri);

    // The synchronous endpoint rejects audio beyond ~1 minute. Failing here with a clear
    // message beats a truncated transcript that silently loses half the consultation.
    const approxSeconds = buffer.length / (16000 * 2);
    if (approxSeconds > 55) {
      throw new Error(
        `[GoogleSpeechProvider] Recording is approximately ${Math.round(approxSeconds)}s. ` +
          'Audio longer than one minute must be supplied as a gs:// Cloud Storage URI so the ' +
          'long-running endpoint can be used. Configure STORAGE_PROVIDER for GCS.'
      );
    }

    return { content: buffer.toString('base64') };
  }

  private toProviderTranscript(response: any): ProviderTranscript {
    const results: any[] = response?.results ?? [];

    // With diarisation enabled Google repeats the full word list, tagged, on the final
    // result. That entry is authoritative; earlier ones are per-chunk drafts.
    const withWords = results.filter((r) => r?.alternatives?.[0]?.words?.length);
    const authoritative = withWords[withWords.length - 1];

    if (!authoritative) {
      throw new Error(
        '[GoogleSpeechProvider] Recognition returned no transcribable speech. No clinical note ' +
          'can be generated from this recording.'
      );
    }

    const words: GoogleWord[] = authoritative.alternatives[0].words;
    const segments = groupWordsBySpeaker(words);

    const speakerCount = new Set(segments.map((s) => s.speakerId)).size;
    if (speakerCount < 2) {
      // Not an error: a single-voice recording is legitimate. It is recorded so the note can
      // say attribution was not differentiated rather than implying it was.
      console.warn(
        '[GoogleSpeechProvider] Diarisation distinguished only one voice in this recording.'
      );
    }

    return {
      providerName: this.name,
      durationMs: segments.length > 0 ? segments[segments.length - 1].endTimeMs : 0,
      segments
    };
  }
}
