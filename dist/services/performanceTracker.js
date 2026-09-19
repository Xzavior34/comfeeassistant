"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.performanceTracker = exports.PerformanceTrackerService = void 0;
class PerformanceTrackerService {
    metricsMap = new Map();
    startTracking(meetingId, recordingDurationMs) {
        this.metricsMap.set(meetingId, {
            meetingId,
            recordingDurationMs,
            timestamp: new Date().toISOString()
        });
    }
    recordPhase(meetingId, phase, durationMs) {
        const existing = this.metricsMap.get(meetingId) || { meetingId, timestamp: new Date().toISOString() };
        existing[phase] = durationMs;
        this.metricsMap.set(meetingId, existing);
    }
    finalize(meetingId) {
        const existing = this.metricsMap.get(meetingId) || { meetingId, timestamp: new Date().toISOString() };
        const uploadMs = existing.uploadDurationMs || 0;
        const speechMs = existing.speechProcessingDurationMs || 0;
        const aiMs = existing.aiExtractionDurationMs || 0;
        const groundingMs = existing.groundingValidationDurationMs || 0;
        const docMs = existing.documentGenerationDurationMs || 0;
        const totalPipelineDurationMs = uploadMs + speechMs + aiMs + groundingMs + docMs;
        const finalMetrics = {
            meetingId,
            recordingDurationMs: existing.recordingDurationMs || 45000,
            uploadDurationMs: uploadMs,
            speechProcessingDurationMs: speechMs,
            aiExtractionDurationMs: aiMs,
            groundingValidationDurationMs: groundingMs,
            documentGenerationDurationMs: docMs,
            totalPipelineDurationMs,
            timestamp: existing.timestamp || new Date().toISOString()
        };
        console.log(`[PerformanceTracker] Meeting: ${meetingId} | Total Processing: ${totalPipelineDurationMs}ms (Speech: ${speechMs}ms, AI: ${aiMs}ms, Doc: ${docMs}ms)`);
        return finalMetrics;
    }
}
exports.PerformanceTrackerService = PerformanceTrackerService;
exports.performanceTracker = new PerformanceTrackerService();
