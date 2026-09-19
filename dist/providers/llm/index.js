"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLLMProvider = getLLMProvider;
const MockLLMProvider_1 = require("./MockLLMProvider");
const GeminiLLMProvider_1 = require("./GeminiLLMProvider");
const OpenRouterLLMProvider_1 = require("./OpenRouterLLMProvider");
const env_1 = require("../../config/env");
function getLLMProvider() {
    if (env_1.env.NODE_ENV === 'production' && env_1.env.LLM_PROVIDER === 'mock') {
        throw new Error('CRITICAL CONFIGURATION ERROR: LLM_PROVIDER cannot be set to "mock" in production mode.');
    }
    if (env_1.env.LLM_PROVIDER === 'openrouter') {
        return new OpenRouterLLMProvider_1.OpenRouterLLMProvider();
    }
    if (env_1.env.LLM_PROVIDER === 'gemini') {
        return new GeminiLLMProvider_1.GeminiLLMProvider();
    }
    return new MockLLMProvider_1.MockLLMProvider();
}
