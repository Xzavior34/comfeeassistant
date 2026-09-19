"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockLLMProvider = void 0;
const aiExtraction_1 = require("../../services/aiExtraction");
class MockLLMProvider {
    name = 'MockLLMProvider';
    aiService = new aiExtraction_1.AIExtractionService();
    async checkHealth() {
        return {
            status: 'CONNECTED',
            providerName: this.name,
            details: 'Local Development Rule-Based Extraction Provider Active'
        };
    }
    async extractStructuredNote(segments) {
        return this.aiService.extractStructuredClinicalNote(segments);
    }
}
exports.MockLLMProvider = MockLLMProvider;
