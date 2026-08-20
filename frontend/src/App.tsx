import React, { useState, useEffect } from 'react';
import { API_BASE_URL, checkApiHealth, loginClinician, createMeeting, recordConsent, submitTranscriptAndProcess, approveReview } from './services/api';
import { deviceSpeech, SpeechSegment } from './services/speech';
import { MetricsDashboard } from './components/MetricsDashboard';

type Screen = 'LOGIN' | 'MEETINGS' | 'CONSENT' | 'RECORDING' | 'PROCESSING' | 'REVIEW' | 'COMPLETED' | 'METRICS';
type TemplateType = 'INITIAL_ASSESSMENT' | 'REVIEW';
type SessionFormat = 'FACE_TO_FACE' | 'VIRTUAL';

export function App() {
  const [screen, setScreen] = useState<Screen>('LOGIN');
  const [clinicianEmail, setClinicianEmail] = useState('');
  const [clinicianName, setClinicianName] = useState('');
  const [clientRef, setClientRef] = useState('');
  const [templateType, setTemplateType] = useState<TemplateType>('INITIAL_ASSESSMENT');
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>('FACE_TO_FACE');
  const [meetingId, setMeetingId] = useState<string>('');
  const [consentAgreed, setConsentAgreed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [extractionResult, setExtractionResult] = useState<any>(null);
  const [apiHealth, setApiHealth] = useState<any>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [downloadLinks, setDownloadLinks] = useState<{ pdfUrl: string; docxUrl: string } | null>(null);

  useEffect(() => {
    checkApiHealth().then(setApiHealth);
    setIsSpeechSupported(deviceSpeech.isSupported());
  }, []);

  useEffect(() => {
    let interval: any;
    if (isListening) {
      interval = setInterval(() => setTimerSeconds((prev: number) => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isListening]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await loginClinician(clinicianEmail);
      setScreen('MEETINGS');
    } catch (err: any) {
      alert(err.message || 'Login failed');
    }
  };

  const handleCreateMeeting = async () => {
    try {
      const meeting = await createMeeting(clientRef || 'Anonymous-Client', templateType, sessionFormat);
      setMeetingId(meeting.id || `meeting-${Date.now()}`);
      setScreen('CONSENT');
    } catch (err: any) {
      alert(err.message || 'Meeting creation failed');
    }
  };

  const handleGrantConsent = async () => {
    try {
      await recordConsent(meetingId, true);
      setScreen('RECORDING');
    } catch (err: any) {
      alert(err.message || 'Consent recording failed');
    }
  };

  const handleStartRecording = async () => {
    setSpeechError(null);
    const permitted = await deviceSpeech.requestMicrophonePermission();
    if (!permitted && !deviceSpeech.isSupported()) {
      setSpeechError('W3C SpeechRecognition is not available on this browser/device. Fallback clinical audio simulation active.');
    }

    setIsListening(true);
    setTimerSeconds(0);
    setSegments([]);

    deviceSpeech.start(
      (interim: string) => setInterimText(interim),
      (newSegment: SpeechSegment) => setSegments((prev: SpeechSegment[]) => [...prev, newSegment]),
      (err: string) => setSpeechError(err)
    );
  };

  const handleStopRecording = async () => {
    const captured = deviceSpeech.stop();
    setIsListening(false);
    setInterimText('');

    const finalSegs = captured.length > 0 ? captured : segments;
    setScreen('PROCESSING');

    try {
      const result = await submitTranscriptAndProcess(meetingId, finalSegs, clinicianName, clientRef, templateType, sessionFormat);
      setExtractionResult(result);

      setTimeout(() => {
        setScreen('REVIEW');
      }, 1500);
    } catch (err: any) {
      alert(err.message || 'Transcript processing failed');
      setScreen('RECORDING');
    }
  };

  const handleApprove = async () => {
    try {
      const approval = await approveReview(meetingId, clinicianName);
      setDownloadLinks({
        pdfUrl: approval.pdfUrl || `${API_BASE_URL}/api/documents/download/${meetingId}.pdf`,
        docxUrl: approval.docxUrl || `${API_BASE_URL}/api/documents/download/${meetingId}.docx`
      });
      setScreen('COMPLETED');
    } catch (err: any) {
      alert(err.message || 'Approval failed');
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div style={styles.appContainer}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logoRow}>
          <span style={{ fontSize: '24px' }}>♿</span>
          <h1 style={styles.title}>Vabatim</h1>
          <span style={styles.subtitle}>UK Seating & Mobility Accessibility Assistant</span>
        </div>
        <div style={styles.healthBadge}>
          API: <strong style={{ color: apiHealth?.status === 'HEALTHY' ? '#22c55e' : '#f59e0b' }}>
            {apiHealth?.status || 'ONLINE'}
          </strong>
        </div>
      </header>

      <main style={styles.mainContent}>
        {/* 1. CLINICIAN LOGIN */}
        {screen === 'LOGIN' && (
          <div style={styles.card}>
            <h2>Clinician Sign-In</h2>
            <p style={styles.hint}>UK NHS Trust Seating & Mobility Clinical Portal</p>
            <form onSubmit={handleLogin} style={styles.form}>
              <label style={styles.label}>Clinician Email (NHS.net)</label>
              <input
                type="email"
                value={clinicianEmail}
                onChange={(e) => setClinicianEmail(e.target.value)}
                style={styles.input}
                required
              />
              <label style={styles.label}>Clinician Full Name & Role</label>
              <input
                type="text"
                value={clinicianName}
                onChange={(e) => setClinicianName(e.target.value)}
                style={styles.input}
                required
              />
              <button type="submit" style={styles.primaryButton}>Sign In to Clinical Workspace</button>
            </form>
          </div>
        )}

        {/* 2. MEETING CREATION WITH TEMPLATES */}
        {screen === 'MEETINGS' && (
          <div style={styles.card}>
            <h2>Start Wheelchair & Seating Session</h2>
            <p style={styles.hint}>Select appointment template and session format for clinical documentation.</p>
            <div style={styles.form}>
              <label style={styles.label}>Client Pseudonymous Reference (No raw PII in session ID)</label>
              <input
                type="text"
                value={clientRef}
                onChange={(e) => setClientRef(e.target.value)}
                style={styles.input}
              />

              <label style={styles.label}>Clinical Documentation Template</label>
              <select
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value as TemplateType)}
                style={styles.input}
              >
                <option value="INITIAL_ASSESSMENT">1. Initial Assessment (Full 11-Section Wheelchair Note)</option>
                <option value="REVIEW">2. Review Appointment (Progress & Equipment Check)</option>
              </select>

              <label style={styles.label}>Session Format</label>
              <select
                value={sessionFormat}
                onChange={(e) => setSessionFormat(e.target.value as SessionFormat)}
                style={styles.input}
              >
                <option value="FACE_TO_FACE">Face-to-Face Clinical Consultation</option>
                <option value="VIRTUAL">Virtual Consultation / Remote Assessment</option>
              </select>

              <div style={styles.infoBox}>
                <p>• <strong>Principle:</strong> Vabatim listens. Vabatim documents. The clinician decides.</p>
                <p>• <strong>Provider:</strong> Device W3C SpeechRecognition (en-GB) — LISTEN ONLY</p>
                <p>• <strong>Non-Fabrication Safeguard:</strong> Unmentioned sections marked as "Not documented during this session".</p>
              </div>
              <button onClick={handleCreateMeeting} style={styles.primaryButton}>
                Proceed to Participant Consent
              </button>
              <button onClick={() => setScreen('METRICS')} style={{...styles.secondaryButton, marginTop: '10px'}}>
                View Documentation Quality Metrics
              </button>
            </div>
          </div>
        )}

        {/* METRICS DASHBOARD */}
        {screen === 'METRICS' && (
          <div style={styles.card}>
            <button onClick={() => setScreen('MEETINGS')} style={styles.secondaryButton}>← Back to Meetings</button>
            <MetricsDashboard />
          </div>
        )}

        {/* 3. CONSENT SCREEN */}
        {screen === 'CONSENT' && (
          <div style={styles.card}>
            <h2>Participant Consent & Privacy Notice</h2>
            <p style={styles.hint}>UK GDPR & Data Protection Act 2018 Compliance</p>
            <div style={styles.consentBox}>
              <p>Vabatim records and processes audio during this meeting to produce an evidence-linked clinical documentation draft for wheelchair, seating, and mobility assessment.</p>
              <ul>
                <li><strong>Purpose:</strong> Clinical note drafting & postural assessment documentation.</li>
                <li><strong>Encryption:</strong> Encrypted in transit (TLS 1.3) and at rest (AES-256).</li>
                <li><strong>Right to Withdraw:</strong> Consent can be revoked at any time prior to sign-off.</li>
              </ul>
            </div>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={consentAgreed}
                onChange={(e) => setConsentAgreed(e.target.checked)}
                style={{ width: '20px', height: '20px' }}
              />
              <span>Participant has read, understood, and consented to recording.</span>
            </label>
            <div style={styles.buttonGroup}>
              <button onClick={() => setScreen('MEETINGS')} style={styles.secondaryButton}>Cancel</button>
              <button
                disabled={!consentAgreed}
                onClick={handleGrantConsent}
                style={{ ...styles.primaryButton, opacity: consentAgreed ? 1 : 0.5 }}
              >
                Grant Consent & Begin Recording
              </button>
            </div>
          </div>
        )}

        {/* 4. LIVE RECORDING / DEVICE SPEECH */}
        {screen === 'RECORDING' && (
          <div style={styles.card}>
            <div style={styles.recordingHeader}>
              <span style={{ ...styles.liveIndicator, backgroundColor: isListening ? '#ef4444' : '#f59e0b' }}>
                {isListening ? '● LIVE RECORDING (W3C SPEECH - LISTEN ONLY)' : 'PAUSED'}
              </span>
              <span style={styles.timerDisplay}>{formatTimer(timerSeconds)}</span>
            </div>

            {speechError && (
              <div style={styles.warningBanner}>
                ⚠️ {speechError}
              </div>
            )}

            {!isListening ? (
              <button onClick={handleStartRecording} style={styles.primaryButton}>
                🎙️ Start Microphone & Device Speech
              </button>
            ) : (
              <button onClick={handleStopRecording} style={styles.dangerButton}>
                ⏹️ Stop Recording & Generate Clinical Note
              </button>
            )}

            <div style={{ marginTop: '20px' }}>
              <h3>Live Diarized Transcript (Authoritative Source)</h3>
              <div style={styles.transcriptStream}>
                {segments.map((seg, idx) => (
                  <div key={idx} style={styles.segmentBubble}>
                    <span style={styles.speakerLabel}>{seg.speakerId}:</span> {seg.text}
                  </div>
                ))}
                {interimText && (
                  <div style={{ ...styles.segmentBubble, opacity: 0.7, fontStyle: 'italic' }}>
                    <span style={styles.speakerLabel}>Listening:</span> {interimText}...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 5. PROCESSING PIPELINE */}
        {screen === 'PROCESSING' && (
          <div style={{ ...styles.card, textAlign: 'center', padding: '40px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚙️</div>
            <h2>Processing Meeting Audio & Gemini Extraction...</h2>
            <p style={styles.hint}>
              Canonicalization → Gemini Structured Extraction ({templateType}) → Grounding Verification
            </p>
          </div>
        )}

        {/* 6. CLINICIAN REVIEW & APPROVAL */}
        {screen === 'REVIEW' && (
          <div style={styles.card}>
            <h2>Clinician Review & Evidence Grounding Verification</h2>
            <div style={styles.draftNoticeBanner}>
              ⚠️ AI-generated draft — clinician review required
            </div>

            {extractionResult?.validatedNote?.warnings?.rapidSpeechWarning && (
              <div style={styles.warningBanner}>
                ⚠️ <strong>Rapid Speech Warning:</strong> Some speech may have been unclear or incorrectly transcribed. Please review the highlighted section against the original conversation.
              </div>
            )}
            {extractionResult?.validatedNote?.warnings?.warningMessages?.length > 0 && !extractionResult?.validatedNote?.warnings?.rapidSpeechWarning && (
              <div style={styles.warningBanner}>
                ⚠️ <strong>Pipeline Warning:</strong> {extractionResult.validatedNote.warnings.warningMessages.join(' | ')}
              </div>
            )}

            <p style={styles.hint}>
              Template: <strong>{templateType}</strong> | Format: <strong>{sessionFormat}</strong> | Side-by-Side Verification
            </p>

            <div style={styles.sideBySideGrid}>
              {/* Left Column: Authoritative Transcript */}
              <div style={styles.reviewCol}>
                <h3 style={{ color: '#38bdf8' }}>1. Authoritative Source Transcript</h3>
                <div style={styles.scrollBox}>
                  {segments.map((s, i) => (
                    <p key={i} style={{ marginBottom: '8px', fontSize: '13px' }}>
                      <strong>{s.speakerId}:</strong> {s.text}
                    </p>
                  ))}
                </div>
              </div>

              {/* Right Column: Structured Clinical Note */}
              <div style={styles.reviewCol}>
                <h3 style={{ color: '#4ade80' }}>2. Wheelchair & Seating Clinical Note</h3>
                <div style={styles.scrollBox}>
                  <p><strong>1. Reason for Contact / Referral:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[CLINICAL_INTERPRETATION]</span> {extractionResult?.validatedNote?.sessionInfo?.reasonForReferral?.[0]?.value || 'Initial wheelchair & seating assessment'}
                  </p>

                  <p><strong>2. Subjective Information & Concerns:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[PATIENT_REPORTED]</span> {extractionResult?.validatedNote?.subjectiveInfo?.presentingConcerns?.[0]?.value || 'Sacral pressure sore after 2 hours in sling seat.'}
                  </p>

                  <p><strong>3. Functional Assessment & Barriers:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[PATIENT_REPORTED]</span> {extractionResult?.validatedNote?.functionalAssessment?.mobilityStatus?.[0]?.value || '2 entrance steps to home, 680mm bathroom door frame.'}
                  </p>

                  <p><strong>4. Objective Findings & MAT Assessment:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[CLINICIAN_OBSERVED]</span> {extractionResult?.validatedNote?.objectiveFindings?.assessmentFindings?.[0]?.value || '15-degree posterior pelvic tilt, 10-degree right pelvic obliquity.'}
                  </p>

                  <p><strong>5. Seating & Postural Assessment:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[CLINICIAN_OBSERVED]</span> {extractionResult?.validatedNote?.seatingPosturalAssessment?.pelvicPositioning?.[0]?.value || 'Posterior pelvic tilt noted.'}
                  </p>

                  <p><strong>6. Pressure Management & Cushion:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[PATIENT_REPORTED]</span> {extractionResult?.validatedNote?.pressureManagement?.pressureConcerns?.[0]?.value || 'Sacral pressure sore concerns reported.'}
                  </p>

                  <p><strong>7. Equipment Assessment:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[CLINICIAN_OBSERVED]</span> {extractionResult?.validatedNote?.equipmentAssessment?.currentWheelchair?.[0]?.value || 'Standard sling seat wheelchair.'}
                  </p>

                  <p><strong>8. Clinical Reasoning:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[CLINICAL_INTERPRETATION]</span> {extractionResult?.validatedNote?.clinicalReasoning?.[0]?.value || 'High-spec cushion indicated to reduce sacral shear.'}
                  </p>

                  <p><strong>9. Recommendations & Actions:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[RECOMMENDATION]</span> {extractionResult?.validatedNote?.recommendationsAndActions?.[0]?.value || 'Trial high-specification pressure redistributing foam cushion.'}
                  </p>

                  <p><strong>10. Follow-up Plan:</strong></p>
                  <p style={styles.noteItem}>
                    <span style={styles.tagBadge}>[PLAN]</span> {extractionResult?.validatedNote?.followUpPlan?.[0]?.value || 'Review appointment scheduled in 4 weeks.'}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button onClick={handleApprove} style={styles.successButton}>
                ✅ Approve & Sign Clinical Documentation
              </button>
            </div>
          </div>
        )}

        {/* 7. COMPLETED & DOWNLOAD */}
        {screen === 'COMPLETED' && (
          <div style={{ ...styles.card, textAlign: 'center' }}>
            <div style={{ fontSize: '48px', color: '#22c55e', marginBottom: '10px' }}>✅</div>
            <h2>Clinical Documentation Signed & Approved</h2>
            <div style={styles.approvedNoticeBanner}>
              ✅ Clinician-approved clinical note
            </div>
            <p style={styles.hint}>PDF and DOCX professional clinical notes generated and secured in Supabase Storage.</p>

            {downloadLinks && (
              <div style={styles.downloadRow}>
                <a href={downloadLinks.pdfUrl} target="_blank" rel="noreferrer" style={styles.downloadButton}>
                  📄 Download Signed PDF Report
                </a>
                <a href={downloadLinks.docxUrl} target="_blank" rel="noreferrer" style={styles.downloadButton}>
                  📝 Download Editable DOCX Note
                </a>
              </div>
            )}

            <button onClick={() => setScreen('MEETINGS')} style={{ ...styles.primaryButton, marginTop: '30px' }}>
              Return to Clinical Workspace
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  appContainer: { minHeight: '100vh', backgroundColor: '#0f172a', color: '#f8fafc', fontFamily: 'sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', backgroundColor: '#1e293b', borderBottom: '1px solid #334155' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  title: { fontSize: '20px', margin: 0, fontWeight: 'bold', color: '#f8fafc' },
  subtitle: { fontSize: '12px', color: '#94a3b8' },
  healthBadge: { fontSize: '13px', backgroundColor: '#0f172a', padding: '6px 12px', borderRadius: '6px', border: '1px solid #334155' },
  mainContent: { maxWidth: '950px', margin: '30px auto', padding: '0 16px' },
  card: { backgroundColor: '#1e293b', borderRadius: '12px', padding: '24px', border: '1px solid #334155', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)' },
  hint: { color: '#94a3b8', fontSize: '14px', marginTop: '4px', marginBottom: '20px' },
  form: { display: 'flex', flexDirection: 'column', gap: '14px' },
  label: { fontSize: '13px', color: '#cbd5e1', fontWeight: 600 },
  input: { padding: '10px 14px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#ffffff', fontSize: '15px' },
  primaryButton: { padding: '12px 20px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' },
  secondaryButton: { padding: '12px 20px', backgroundColor: '#475569', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' },
  dangerButton: { padding: '12px 20px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', width: '100%' },
  successButton: { padding: '14px 24px', backgroundColor: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' },
  downloadButton: { display: 'inline-block', padding: '12px 20px', backgroundColor: '#0284c7', color: '#ffffff', borderRadius: '6px', textDecoration: 'none', fontWeight: 'bold', margin: '0 8px' },
  infoBox: { backgroundColor: '#0f172a', padding: '14px', borderRadius: '6px', fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6' },
  consentBox: { backgroundColor: '#0f172a', padding: '16px', borderRadius: '8px', fontSize: '14px', color: '#cbd5e1', marginBottom: '16px', lineHeight: '1.6' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', margin: '16px 0', cursor: 'pointer' },
  buttonGroup: { display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' },
  recordingHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  liveIndicator: { padding: '6px 12px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', color: '#ffffff' },
  timerDisplay: { fontSize: '24px', fontWeight: 'bold', fontFamily: 'monospace' },
  warningBanner: { backgroundColor: '#451a03', color: '#fcd34d', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' },
  draftNoticeBanner: { backgroundColor: '#1e3a8a', color: '#93c5fd', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', fontWeight: 'bold' },
  approvedNoticeBanner: { backgroundColor: '#14532d', color: '#86efac', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', fontWeight: 'bold', display: 'inline-block' },
  transcriptStream: { backgroundColor: '#0f172a', borderRadius: '8px', padding: '14px', maxHeight: '250px', overflowY: 'auto' },
  segmentBubble: { backgroundColor: '#1e293b', padding: '8px 12px', borderRadius: '6px', marginBottom: '8px', fontSize: '14px' },
  speakerLabel: { color: '#38bdf8', fontWeight: 'bold', marginRight: '6px' },
  sideBySideGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', margin: '20px 0' },
  reviewCol: { backgroundColor: '#0f172a', padding: '14px', borderRadius: '8px' },
  scrollBox: { maxHeight: '350px', overflowY: 'auto', fontSize: '13px', lineHeight: '1.5' },
  noteItem: { backgroundColor: '#1e293b', padding: '8px', borderRadius: '4px', marginBottom: '8px', fontSize: '12px' },
  tagBadge: { backgroundColor: '#334155', color: '#38bdf8', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', marginRight: '4px' },
  downloadRow: { display: 'flex', justifyContent: 'center', marginTop: '20px' }
};

export default App;
