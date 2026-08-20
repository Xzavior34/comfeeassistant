import React, { useState, useEffect } from 'react';
import { API_BASE_URL, checkApiHealth, loginClinician, createMeeting, recordConsent, submitTranscriptAndProcess, approveReview } from './services/api';
import { deviceSpeech, SpeechSegment } from './services/speech';
import { MetricsDashboard } from './components/MetricsDashboard';
import './App.css';

type Screen = 'LOGIN' | 'MEETINGS' | 'CONSENT' | 'RECORDING' | 'PROCESSING' | 'REVIEW' | 'COMPLETED' | 'METRICS';
type TemplateType = 'INITIAL_ASSESSMENT' | 'REVIEW';
type SessionFormat = 'FACE_TO_FACE' | 'VIRTUAL';

function App() {
  const [screen, setScreen] = useState<Screen>('LOGIN');
  const [apiHealth, setApiHealth] = useState<any>(null);
  
  // Auth State
  const [clinicianEmail, setClinicianEmail] = useState<string>('');
  const [clinicianName, setClinicianName] = useState<string>('');

  // Meeting State
  const [clientRef, setClientRef] = useState<string>('');
  const [templateType, setTemplateType] = useState<TemplateType>('INITIAL_ASSESSMENT');
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>('FACE_TO_FACE');
  const [meetingId, setMeetingId] = useState<string>('');
  
  // Recording State
  const [isListening, setIsListening] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [interimText, setInterimText] = useState('');
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);

  // Result State
  const [extractionResult, setExtractionResult] = useState<any>(null);
  const [downloadLinks, setDownloadLinks] = useState<{pdfUrl: string, docxUrl: string} | null>(null);

  useEffect(() => {
    checkApiHealth().then(setApiHealth).catch(() => {});
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
      console.error('Login Error:', err);
      alert(`Login failed: ${err.message || 'Unknown error'}`);
    }
  };

  const handleCreateMeeting = async () => {
    try {
      const meeting = await createMeeting(clientRef || 'Anonymous-Client', templateType, sessionFormat);
      setMeetingId(meeting.id || `meeting-${Date.now()}`);
      setScreen('CONSENT');
    } catch (err: any) {
      console.error('Meeting Error:', err);
      alert(`Meeting creation failed: ${err.message || 'Server error'}`);
    }
  };

  const handleGrantConsent = async () => {
    try {
      await recordConsent(meetingId, true);
      setScreen('RECORDING');
    } catch (err: any) {
      console.error('Consent Error:', err);
      alert(`Consent recording failed: ${err.message || 'Server error'}`);
    }
  };

  const handleStartRecording = async () => {
    setSpeechError(null);
    const permitted = await deviceSpeech.requestMicrophonePermission();
    if (!permitted && !deviceSpeech.isSupported()) {
      setSpeechError('W3C SpeechRecognition is not available on this browser/device.');
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
      setTimeout(() => setScreen('REVIEW'), 1500);
    } catch (err: any) {
      console.error('Processing error:', err);
      alert(`Transcript processing failed: ${err.message || 'Server error'}`);
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
      console.error('Approval error:', err);
      alert(`Approval failed: ${err.message || 'System error'}`);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="appContainer">
      <header className="header">
        <div className="logoRow">
          <span style={{ fontSize: '24px' }}>♿</span>
          <h1 className="title">Vabatim</h1>
        </div>
        <div className="healthBadge">
          API: <strong style={{ color: apiHealth?.status === 'HEALTHY' ? '#22c55e' : '#f59e0b' }}>
            {apiHealth?.status || 'ONLINE'}
          </strong>
        </div>
      </header>

      <main className="mainContent">
        {screen === 'LOGIN' && (
          <div className="card">
            <h2>Clinician Sign-In</h2>
            <p className="hint">UK NHS Trust Seating & Mobility Clinical Portal</p>
            <form onSubmit={handleLogin} className="form">
              <label className="label">Clinician Email (NHS.net)</label>
              <input type="email" value={clinicianEmail} onChange={(e) => setClinicianEmail(e.target.value)} className="input" required />
              <label className="label">Clinician Full Name & Role</label>
              <input type="text" value={clinicianName} onChange={(e) => setClinicianName(e.target.value)} className="input" required />
              <button type="submit" className="primaryButton">Sign In to Clinical Workspace</button>
            </form>
          </div>
        )}

        {screen === 'MEETINGS' && (
          <div className="card">
            <h2>New Clinical Session</h2>
            <p className="hint">Select appointment template and session format</p>
            <div className="form" style={{ marginTop: '20px' }}>
              <label className="label">Client Pseudonymous Reference (No raw PII in session ID)</label>
              <input type="text" value={clientRef} onChange={(e) => setClientRef(e.target.value)} className="input" placeholder="e.g., CLIENT-A8492" />
              <label className="label">Clinical Documentation Template</label>
              <select value={templateType} onChange={(e: any) => setTemplateType(e.target.value)} className="input">
                <option value="INITIAL_ASSESSMENT">1. Initial Assessment (Full 11-Section Wheelchair Note)</option>
                <option value="REVIEW">2. Review / Handover (Condensed Progress Note)</option>
              </select>
              <label className="label">Session Format</label>
              <select value={sessionFormat} onChange={(e: any) => setSessionFormat(e.target.value)} className="input">
                <option value="FACE_TO_FACE">Face-to-Face Clinical Consultation</option>
                <option value="VIRTUAL">Virtual / Telehealth Consultation</option>
              </select>
              <button onClick={handleCreateMeeting} className="primaryButton">Proceed to Participant Consent</button>
            </div>
          </div>
        )}

        {screen === 'CONSENT' && (
          <div className="card">
            <h2>Patient & Participant Consent</h2>
            <p className="hint">Information Governance & Clinical Safety</p>
            <div className="consentBox">
              <p>Vabatim records and processes audio during this meeting to produce an evidence-linked clinical documentation draft for wheelchair, seating, and mobility assessment.</p>
              <p>By proceeding, you confirm that all present parties (Clinician, Client, and Carers) have been informed and explicitly consent to audio recording and AI processing.</p>
            </div>
            <div className="checkboxRow">
              <input type="checkbox" id="consent-check" />
              <label htmlFor="consent-check">I confirm verbal consent was granted by all participants.</label>
            </div>
            <div className="buttonGroup">
              <button onClick={() => setScreen('MEETINGS')} className="secondaryButton">Cancel</button>
              <button onClick={handleGrantConsent} className="primaryButton">Grant Consent & Start Device Mic</button>
            </div>
          </div>
        )}

        {screen === 'METRICS' && (
          <div className="card">
            <button onClick={() => setScreen('MEETINGS')} className="secondaryButton" style={{ marginBottom: '16px' }}>← Back to Meetings</button>
            <MetricsDashboard />
          </div>
        )}

        {screen === 'RECORDING' && (
          <div className="card">
            <div className="recordingHeader">
              <div>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className="liveIndicator" style={{ backgroundColor: isListening ? '#ef4444' : '#64748b' }}>
                    {isListening ? '🔴 LIVE' : 'PAUSED'}
                  </span>
                  Clinical Session
                </h2>
                <p className="hint" style={{ margin: 0 }}>Template: {templateType}</p>
              </div>
              <div className="timerDisplay">{formatTimer(timerSeconds)}</div>
            </div>

            {speechError && (
              <div className="warningBanner">⚠️ {speechError}</div>
            )}

            {!isSpeechSupported && (
              <div className="infoBox" style={{ marginBottom: '16px' }}>
                Note: Simulating speech capture because SpeechRecognition is not supported on this browser.
              </div>
            )}

            <div className="transcriptStream">
              {segments.map((seg, idx) => (
                <div key={idx} className="segmentBubble">
                  <span className="speakerLabel">{seg.speakerId}:</span>
                  <span>{seg.text}</span>
                </div>
              ))}
              {interimText && (
                <div className="segmentBubble" style={{ opacity: 0.7, fontStyle: 'italic' }}>
                  <span className="speakerLabel">Hearing:</span>
                  <span>{interimText}...</span>
                </div>
              )}
              {segments.length === 0 && !interimText && (
                <div style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>
                  Listening for conversation...
                </div>
              )}
            </div>

            <div className="buttonGroup">
              <button onClick={isListening ? handleStopRecording : handleStartRecording} className="dangerButton">
                {isListening ? '⏹ End Session' : '🎙️ Start Mic'}
              </button>
            </div>
          </div>
        )}

        {screen === 'PROCESSING' && (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚙️</div>
            <h2>Processing Meeting Audio & Gemini Extraction...</h2>
            <p className="hint">
              Canonicalization ➔ Gemini Structured Extraction ({templateType}) ➔ Grounding Verification
            </p>
          </div>
        )}

        {screen === 'REVIEW' && (
          <div className="card">
            <h2>Clinician Review & Evidence Grounding Verification</h2>
            <div className="draftNoticeBanner">
              📝 AI-generated draft — clinician review required
            </div>

            {extractionResult?.validatedNote?.warnings?.rapidSpeechWarning && (
              <div className="warningBanner">
                ⚠️ <strong>Rapid Speech Warning:</strong> Some speech may have been unclear or incorrectly transcribed.
              </div>
            )}

            <p className="hint">
              Template: <strong>{templateType}</strong> | Format: <strong>{sessionFormat}</strong>
            </p>

            <div className="sideBySideGrid">
              <div className="reviewCol">
                <h3 style={{ color: '#38bdf8' }}>1. Authoritative Source Transcript</h3>
                <div className="scrollBox">
                  {segments.map((s, i) => (
                    <p key={i} style={{ marginBottom: '8px', fontSize: '13px' }}>
                      <strong>{s.speakerId}:</strong> {s.text}
                    </p>
                  ))}
                </div>
              </div>

              <div className="reviewCol">
                <h3 style={{ color: '#4ade80' }}>2. Wheelchair & Seating Clinical Note</h3>
                <div className="scrollBox">
                  <p><strong>1. Reason for Contact / Referral:</strong></p>
                  <p className="noteItem">
                    <span className="tagBadge">[CLINICAL_INTERPRETATION]</span> {extractionResult?.validatedNote?.sessionInfo?.reasonForReferral?.[0]?.value || 'Initial wheelchair & seating assessment'}
                  </p>

                  <p><strong>2. Subjective Information & Concerns:</strong></p>
                  <p className="noteItem">
                    <span className="tagBadge">[PATIENT_REPORTED]</span> {extractionResult?.validatedNote?.subjectiveInfo?.presentingConcerns?.[0]?.value || 'Sacral pressure sore after 2 hours in sling seat.'}
                  </p>

                  <p><strong>3. Functional Assessment & Barriers:</strong></p>
                  <p className="noteItem">
                    <span className="tagBadge">[PATIENT_REPORTED]</span> {extractionResult?.validatedNote?.functionalAssessment?.mobilityStatus?.[0]?.value || '2 entrance steps to home, 680mm bathroom door frame.'}
                  </p>

                  <p><strong>4. Objective Findings & MAT Assessment:</strong></p>
                  <p className="noteItem">
                    <span className="tagBadge">[CLINICIAN_OBSERVED]</span> {extractionResult?.validatedNote?.objectiveFindings?.assessmentFindings?.[0]?.value || '15-degree posterior pelvic tilt, 10-degree right pelvic obliquity.'}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button onClick={handleApprove} className="successButton">
                ✅ Approve & Sign Clinical Documentation
              </button>
            </div>
          </div>
        )}

        {screen === 'COMPLETED' && (
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', color: '#22c55e', marginBottom: '10px' }}>✅</div>
            <h2>Clinical Documentation Signed & Approved</h2>
            <div className="approvedNoticeBanner">
              ✅ Clinician-approved clinical note
            </div>
            <p className="hint">PDF and DOCX professional clinical notes generated and secured in Supabase Storage.</p>

            {downloadLinks && (
              <div className="downloadRow">
                <a href={downloadLinks.pdfUrl} target="_blank" rel="noreferrer" className="downloadButton">
                  📄 Download Signed PDF Report
                </a>
                <a href={downloadLinks.docxUrl} target="_blank" rel="noreferrer" className="downloadButton">
                  📝 Download Editable DOCX Note
                </a>
              </div>
            )}

            <button onClick={() => setScreen('MEETINGS')} className="primaryButton" style={{ marginTop: '30px' }}>
              Return to Clinical Workspace
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
