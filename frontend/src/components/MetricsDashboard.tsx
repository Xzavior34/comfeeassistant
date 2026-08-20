import React, { useState, useEffect } from 'react';
import { getDocumentationQualityMetrics } from '../services/api';

interface MetricsData {
  totalNotesGenerated: number;
  totalNotesReviewed: number;
  totalNotesApproved: number;
  notesApprovedWithoutEdits: number;
  notesRequiringMinorEdits: number;
  notesRequiringSubstantialEdits: number;
  averageReviewDurationMs: number;
  totalSpeechCorrectionsProposed: number;
  totalSpeechCorrectionsAccepted: number;
  totalGroundingViolations: number;
  correctionRate: number;
}

export function MetricsDashboard() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMetrics() {
      try {
        const data = await getDocumentationQualityMetrics();
        setMetrics(data.metrics);
      } catch (err) {
        console.error('Failed to load metrics:', err);
      } finally {
        setLoading(false);
      }
    }
    loadMetrics();
  }, []);

  if (loading) return <div>Loading Quality Metrics...</div>;
  if (!metrics) return <div>No metrics available.</div>;

  return (
    <div style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px', color: '#f8fafc', marginTop: '20px' }}>
      <h2 style={{ borderBottom: '1px solid #334155', paddingBottom: '10px' }}>Documentation Quality Metrics</h2>
      
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '200px', backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px' }}>
          <h3>Review Status</h3>
          <p>Total Generated: {metrics.totalNotesGenerated}</p>
          <p>Total Reviewed: {metrics.totalNotesReviewed}</p>
          <p>Total Approved: {metrics.totalNotesApproved}</p>
        </div>

        <div style={{ flex: '1', minWidth: '200px', backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px' }}>
          <h3>Correction Rates</h3>
          <p>Correction Rate: {metrics.correctionRate}%</p>
          <p>Unchanged: {metrics.notesApprovedWithoutEdits}</p>
          <p>Minor Edits: {metrics.notesRequiringMinorEdits}</p>
          <p>Substantial Edits: {metrics.notesRequiringSubstantialEdits}</p>
        </div>

        <div style={{ flex: '1', minWidth: '200px', backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px' }}>
          <h3>AI Quality</h3>
          <p>Grounding Violations: {metrics.totalGroundingViolations}</p>
          <p>Speech Corrections Accepted: {metrics.totalSpeechCorrectionsAccepted} / {metrics.totalSpeechCorrectionsProposed}</p>
          <p>Avg Review Time: {Math.round(metrics.averageReviewDurationMs / 1000)}s</p>
        </div>
      </div>
      <p style={{ fontSize: '0.8em', color: '#94a3b8', marginTop: '20px' }}>
        Note: These metrics do not reflect inherent clinical correctness, but rather the degree of modification required by the clinician.
      </p>
    </div>
  );
}
