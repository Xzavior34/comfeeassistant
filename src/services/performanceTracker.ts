export interface PerformanceMetrics {
  meetingId: string;
  recordingDurationMs: number;
  uploadDurationMs: number;
  speechProcessingDurationMs: number;
  aiExtractionDurationMs: number;
  groundingValidationDurationMs: number;
  documentGenerationDurationMs: number;
  totalPipelineDurationMs: number;
  timestamp: string;
}

export class PerformanceTrackerService {
  private metricsMap = new Map<string, Partial<PerformanceMetrics>>();

  startTracking(meetingId: string, recordingDurationMs: number): void {
    this.metricsMap.set(meetingId, {
      meetingId,
      recordingDurationMs,
      timestamp: new Date().toISOString()
    });
  }

  recordPhase(meetingId: string, phase: keyof Omit<PerformanceMetrics, 'meetingId' | 'recordingDurationMs' | 'timestamp' | 'totalPipelineDurationMs'>, durationMs: number): void {
    const existing = this.metricsMap.get(meetingId) || { meetingId, timestamp: new Date().toISOString() };
    existing[phase] = durationMs;
    this.metricsMap.set(meetingId, existing);
  }

  finalize(meetingId: string): PerformanceMetrics {
    const existing = this.metricsMap.get(meetingId) || { meetingId, timestamp: new Date().toISOString() };
    const uploadMs = existing.uploadDurationMs || 0;
    const speechMs = existing.speechProcessingDurationMs || 0;
    const aiMs = existing.aiExtractionDurationMs || 0;
    const groundingMs = existing.groundingValidationDurationMs || 0;
    const docMs = existing.documentGenerationDurationMs || 0;

    const totalPipelineDurationMs = uploadMs + speechMs + aiMs + groundingMs + docMs;

    const finalMetrics: PerformanceMetrics = {
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

export const performanceTracker = new PerformanceTrackerService();
