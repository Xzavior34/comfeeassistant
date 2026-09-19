"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureSpeechProvider = void 0;
const clinicalLexicon_1 = require("../../services/clinicalLexicon");
const storage_1 = require("../storage");
class AzureSpeechProvider {
    name = 'AzureSpeech';
    key() {
        return process.env.AZURE_SPEECH_KEY || null;
    }
    region() {
        return process.env.AZURE_SPEECH_REGION || null;
    }
    async checkHealth() {
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
            details: `Region ${this.region()}. Speaker diarisation enabled. Clinical phrase list active ` +
                `(${(0, clinicalLexicon_1.getRecognitionPhraseHints)().length} terms).`
        };
    }
    /**
     * Azure caps the phrase list, and an over-long list dilutes the bias applied to each
     * entry. The most distinctive multi-word clinical terms are kept in preference to short
     * common words, which the base model already handles.
     */
    phraseList(extra) {
        const ranked = [...(0, clinicalLexicon_1.getRecognitionPhraseHints)()].sort((a, b) => b.length - a.length);
        return [...extra, ...ranked].slice(0, 500).map((text) => ({ text }));
    }
    async transcribe(audioUri, options) {
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
        const audio = await (0, storage_1.getStorageProvider)().retrieve(audioUri);
        const form = new FormData();
        form.append('audio', new Blob([new Uint8Array(audio)]), 'consultation.wav');
        form.append('definition', JSON.stringify(definition));
        const endpoint = `https://${this.region()}.api.cognitive.microsoft.com` +
            `/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Ocp-Apim-Subscription-Key': this.key() },
            body: form
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => res.statusText);
            throw new Error(`[AzureSpeechProvider] Transcription failed (HTTP ${res.status}): ${detail}`);
        }
        const payload = await res.json();
        return this.toProviderTranscript(payload);
    }
    toProviderTranscript(payload) {
        const phrases = payload?.phrases ?? [];
        if (phrases.length === 0) {
            throw new Error('[AzureSpeechProvider] Transcription returned no speech. No clinical note can be ' +
                'generated from this recording.');
        }
        const segments = phrases.map((p) => ({
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
exports.AzureSpeechProvider = AzureSpeechProvider;
