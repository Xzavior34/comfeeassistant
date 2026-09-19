"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceSpeechProvider = void 0;
/**
 * On-device (browser) speech capture.
 *
 * Recognition happens in the clinician's browser via the W3C SpeechRecognition API; the
 * server never receives audio. This class therefore only *carries* segments that the
 * client has already produced.
 *
 * It must never synthesise clinical text. Fabricated content reaching a patient record is
 * a clinical safety incident, so every path that has no real transcript throws instead.
 */
class DeviceSpeechProvider {
    name = 'DeviceSpeechProvider';
    language;
    finalSegments = [];
    interimText = '';
    constructor(language = process.env.SPEECH_LANGUAGE || 'en-GB') {
        this.language = language;
    }
    /** True only in a browser context. Always false in the Node API/worker process. */
    isSupported() {
        const globalObj = typeof globalThis !== 'undefined' ? globalThis : {};
        const win = globalObj.window || globalObj;
        return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
    }
    /** True when this instance is running server-side, where capture is impossible. */
    isServerSide() {
        return typeof globalThis.window === 'undefined';
    }
    async checkHealth() {
        if (this.isServerSide()) {
            return {
                status: 'NOT CONFIGURED',
                providerName: this.name,
                details: 'Device speech captures audio in the clinician browser and cannot transcribe ' +
                    'server-side. Segments must be submitted from the client via POST /api/transcripts/process. ' +
                    'For server-side transcription set SPEECH_PROVIDER to "google" or "azure".'
            };
        }
        if (!this.isSupported()) {
            return {
                status: 'NOT CONFIGURED',
                providerName: this.name,
                details: 'W3C SpeechRecognition API unavailable in this browser'
            };
        }
        return {
            status: 'CONNECTED',
            providerName: this.name,
            details: `Browser SpeechRecognition available. Language: ${this.language}`
        };
    }
    async transcribe(_audioUri, _options) {
        if (this.finalSegments.length > 0) {
            return {
                providerName: this.name,
                durationMs: Math.max(...this.finalSegments.map((s) => s.endTimeMs), 0),
                segments: this.finalSegments
            };
        }
        throw new Error('[DeviceSpeechProvider] No captured speech segments are available for this session. ' +
            'Device speech recognition runs in the clinician browser: the client must submit its ' +
            'captured segments. No clinical note can be generated without a real transcript.');
    }
    addFinalSegment(text, startTimeMs, endTimeMs, confidence = null, speakerId = 'UNKNOWN') {
        this.finalSegments.push({ speakerId, startTimeMs, endTimeMs, text, confidence });
    }
    setInterimText(text) {
        this.interimText = text;
    }
    getInterimText() {
        return this.interimText;
    }
    getFinalSegments() {
        return this.finalSegments;
    }
}
exports.DeviceSpeechProvider = DeviceSpeechProvider;
