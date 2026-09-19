"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSpeechProvider = getSpeechProvider;
const MockSpeechProvider_1 = require("./MockSpeechProvider");
const GoogleSpeechProvider_1 = require("./GoogleSpeechProvider");
const AzureSpeechProvider_1 = require("./AzureSpeechProvider");
const DeviceSpeechProvider_1 = require("./DeviceSpeechProvider");
const env_1 = require("../../config/env");
function getSpeechProvider() {
    if (env_1.env.NODE_ENV === 'production' && env_1.env.SPEECH_PROVIDER === 'mock') {
        throw new Error('CRITICAL CONFIGURATION ERROR: SPEECH_PROVIDER cannot be set to "mock" in production mode.');
    }
    switch (env_1.env.SPEECH_PROVIDER) {
        case 'device':
            return new DeviceSpeechProvider_1.DeviceSpeechProvider();
        case 'google':
            return new GoogleSpeechProvider_1.GoogleSpeechProvider();
        case 'azure':
            return new AzureSpeechProvider_1.AzureSpeechProvider();
        case 'mock':
            return new MockSpeechProvider_1.MockSpeechProvider();
        default:
            return new DeviceSpeechProvider_1.DeviceSpeechProvider();
    }
}
