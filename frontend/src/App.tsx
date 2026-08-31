import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  API_BASE_URL,
  checkApiHealth,
  loginClinician,
  createMeeting,
  recordConsent,
  submitTranscript,
  getJobStatus,
  retryDocumentation,
  getReviewDraft,
  saveReviewEdits,
  approveReview,
  downloadDocumentBlob,
  JobStatus
} from './services/api';
import { liveTranscription, LiveTranscriptState, TranscriptEntry } from './services/speech';
import { consultationRecorder, ConsultationRecorder, RecordingState, canRecordAlongsideRecognition } from './services/audioRecorder';
import { sessionCheckpoint, pendingUpload } from './services/sessionCheckpoint';
import { MetricsDashboard } from './components/MetricsDashboard';
import './App.css';

type Screen = 'LOGIN' | 'MEETINGS' | 'CONSENT' | 'RECORDING' | 'PROCESSING' | 'REVIEW' | 'COMPLETED' | 'METRICS';
type TemplateType = 'INITIAL_ASSESSMENT' | 'REVIEW';
type SessionFormat = 'FACE_TO_FACE' | 'VIRTUAL';

interface NarrativeEntry {
  text: string;
  requiresReview: boolean;
  fieldId: string;
}
interface NarrativeSection {
  id: string;
  title: string;
  entries: NarrativeEntry[];
  notEstablished?: string;
}

function App() {
  const [screen, setScreen] = useState<Screen>(
    localStorage.getItem('comfee_auth_token') ? 'MEETINGS' : 'LOGIN'
  );
  const [apiHealth, setApiHealth] = useState<any>(null);

  const [clinicianEmail, setClinicianEmail] = useState('');
  const [clinicianPassword, setClinicianPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [clientRef, setClientRef] = useState('');
  const [templateType, setTemplateType] = useState<TemplateType>('INITIAL_ASSESSMENT');
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>('FACE_TO_FACE');
  const [meetingId, setMeetingId] = useState('');

  const [isListening, setIsListening] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [transcript, setTranscript] = useState<LiveTranscriptState>({ finalEntries: [], interimText: '' });
  const [recorderState, setRecorderState] = useState<RecordingState>('IDLE');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [transcriptionAvailable, setTranscriptionAvailable] = useState(true);

  const [job, setJob] = useState<JobStatus | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [sections, setSections] = useState<NarrativeSection[]>([]);
  const [savingEdits, setSavingEdits] = useState(false);
  const [approving, setApproving] = useState(false);
  const [noteId, setNoteId] = useState<string>('');
  const [recovery, setRecovery] = useState<{ meetingId: string; entries: TranscriptEntry[] } | null>(null);

  // Guards double submission of End Assessment, which would create two jobs.
  const endingRef = useRef(false);
  const [speechDiagnostics, setSpeechDiagnostics] = useState<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    checkApiHealth().then(setApiHealth).catch(() => undefined);
    setTranscriptionAvailable(
      typeof window !== 'undefined' &&
        Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );

    // Offer recovery if a previous session was interrupted.
    void sessionCheckpoint.loadLatest().then((cp) => {
      if (cp && cp.entries.length > 0) setRecovery({ meetingId: cp.meetingId, entries: cp.entries });
    });
  }, []);

  useEffect(() => {
    if (!isListening) return;
    const interval = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isListening]);

  // Backgrounding a tab on mobile commonly suspends capture. Recorded so the clinician is
  // told, rather than discovering a gap in the transcript later.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && isListening) consultationRecorder.noteInterruption();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isListening]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loggingIn) return;
    setLoggingIn(true);
    try {
      await loginClinician(clinicianEmail, clinicianPassword);
      setScreen('MEETINGS');
    } catch (err: any) {
      alert(`Sign in failed: ${err.message}`);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleCreateMeeting = async () => {
    try {
      const data = await createMeeting(clientRef || 'Unspecified', templateType, sessionFormat);
      setMeetingId((data.meeting || data).id);
      setScreen('CONSENT');
    } catch (err: any) {
      alert(`Could not create the session: ${err.message}`);
    }
  };

  const handleGrantConsent = async () => {
    try {
      const result = await recordConsent(meetingId, true);

      // Only advance once the server confirms it stored the consent. Advancing optimistically
      // is how a session reached the recording screen with no consent on record, which then
      // surfaced as a 409 at the end of the consultation — the worst possible moment.
      const confirmed =
        result?.consentStatus === 'GRANTED' ||
        result?.meeting?.consentStatus === true ||
        result?.consentGranted === true;

      if (!confirmed) {
        alert(
          'Consent could not be confirmed by the server, so recording has not started.\n\n' +
            'Please try again. Starting an assessment without recorded consent is not permitted.'
        );
        return;
      }

      setScreen('RECORDING');
    } catch (err: any) {
      alert(`Consent could not be recorded: ${err.message}`);
    }
  };

  const handleStart = async () => {
    setStatusMessage(null);
    liveTranscription.reset();
    setTranscript({ finalEntries: [], interimText: '' });
    setTimerSeconds(0);
    endingRef.current = false;

    let recorderStartMs: number | null = null;

    // Recognition is started FIRST and, on mobile, is given the microphone exclusively.
    //
    // Android Chrome and iOS allow only one consumer of the microphone. Opening a
    // getUserMedia stream for MediaRecorder before starting recognition leaves the
    // recogniser running but deaf: it reports onstart, receives no audio, raises no error,
    // and the transcript stays empty. Desktop Chrome shares the microphone, which is why
    // this only ever failed on a phone.
    const recordingAllowed = ConsultationRecorder.isSupported() && canRecordAlongsideRecognition();

    // Self-heal: if recognition reports it is receiving no audio, free the microphone and
    // retry. This covers desktop browsers that behave like mobile, and any future change in
    // how a browser arbitrates the microphone.
    liveTranscription.setMicContentionHandler(() => {
      consultationRecorder.discard();
      setRecorderState('IDLE');
      liveTranscription.retryAfterMicRelease();
    });

    const started = liveTranscription.start(
      (state) => {
        setTranscript(state);
        void sessionCheckpoint.save({
          meetingId,
          clientRef,
          entries: state.finalEntries,
          startedAtIso: new Date().toISOString(),
          wasRecordingAudio: consultationRecorder.getState() === 'RECORDING'
        });
      },
      (message) => setStatusMessage(message),
      (diag) => {
        setSpeechDiagnostics({
          ...diag,
          mediaRecorderStartTimeMs: recorderStartMs
        });
      }
    );

    if (!started) setTranscriptionAvailable(false);
    setIsListening(true);

    if (recordingAllowed) {
      consultationRecorder.onStateChange((state, detail) => {
        setRecorderState(state);
        if (detail) setStatusMessage(detail);
      });
      // Deliberately after recognition has taken the microphone, and deliberately not
      // awaited: a slow permission prompt must not delay the start of transcription.
      void consultationRecorder.prepare().then((prepared) => {
        if (prepared) {
          consultationRecorder.start();
          recorderStartMs = Date.now();
        }
      });
    } else if (!ConsultationRecorder.isSupported()) {
      setStatusMessage('This browser cannot record audio. The assessment will use live transcription only.');
    } else {
      // Mobile: not an error, and worth saying plainly so nobody hunts for a broken recorder.
      setStatusMessage(
        'Transcribing on this device. Audio is not recorded on phones and tablets so the ' +
          'microphone stays available to the transcriber.'
      );
    }
  };

  /**
   * End Assessment.
   *
   * Order matters: stop recognition and let it settle, stop the recorder and wait for its
   * final data, freeze the transcript, checkpoint it, and only then submit. Tearing the
   * objects down first is how the last sentence of a consultation goes missing.
   */
  const handleEndAssessment = async () => {
    if (endingRef.current) return;
    endingRef.current = true;

    setIsListening(false);
    setStatusMessage('Finalising transcript…');

    const frozen = liveTranscription.stop();
    await consultationRecorder.stop().catch(() => null);

    const transcriptText = frozen.text;

    await sessionCheckpoint.save({
      meetingId,
      clientRef,
      entries: frozen.entries,
      startedAtIso: new Date().toISOString(),
      wasRecordingAudio: false
    });

    if (!transcriptText || transcriptText.trim().length < 5) {
      setStatusMessage(null);
      endingRef.current = false;
      alert(
        'No usable transcript was captured for this assessment.\n\n' +
          'Live transcription may be unavailable in this browser, or the microphone may not ' +
          'have picked up speech. Nothing has been submitted.'
      );
      return;
    }

    setScreen('PROCESSING');
    setStatusMessage('Preparing clinical documentation…');

    try {
      const started = await submitTranscript(meetingId, transcriptText, clientRef, templateType, sessionFormat);
      pendingUpload.clear();
      void sessionCheckpoint.clear(meetingId);
      pollJob(started.jobId);
    } catch (err: any) {
      // The transcript is not lost: it is queued locally and the clinician can retry.
      pendingUpload.save({
        meetingId,
        transcriptText,
        clientRef,
        queuedAtIso: new Date().toISOString()
      });
      setStatusMessage(
        `Assessment saved locally — upload pending. ${err.message}. Use Retry below; you do not ` +
          'need to record the consultation again.'
      );
      endingRef.current = false;
    }
  };

  const pollJob = useCallback((jobId: string) => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const status = await getJobStatus(jobId);
        setJob(status);

        if (status.state === 'SUCCEEDED') {
          await openReview();
          return;
        }
        if (status.state === 'FAILED') return;
      } catch {
        // A transient poll failure is not a job failure; keep polling.
      }
      setTimeout(tick, 2500);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const openReview = async () => {
    const data = await getReviewDraft(meetingId);
    setDraft(data);
    setNoteId(data.noteId);
    setSections(data.narrative?.sections ?? []);
    setScreen('REVIEW');
  };

  const handleRetry = async () => {
    setStatusMessage('Retrying…');
    try {
      const queued = pendingUpload.load();
      const started = queued
        ? await submitTranscript(meetingId, queued.transcriptText, clientRef, templateType, sessionFormat)
        : await retryDocumentation(meetingId);
      pendingUpload.clear();
      setJob(null);
      setScreen('PROCESSING');
      pollJob(started.jobId);
    } catch (err: any) {
      setStatusMessage(`Retry failed: ${err.message}`);
    }
  };

  const updateEntry = (sectionId: string, index: number, text: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sectionId
          ? s
          : { ...s, entries: s.entries.map((e, i) => (i === index ? { ...e, text } : e)) }
      )
    );
  };

  const deleteEntry = (sectionId: string, index: number) => {
    setSections((prev) =>
      prev.map((s) => (s.id !== sectionId ? s : { ...s, entries: s.entries.filter((_, i) => i !== index) }))
    );
  };

  const addEntry = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sectionId
          ? s
          : { ...s, entries: [...s.entries, { text: '', requiresReview: false, fieldId: 'clinician_added' }] }
      )
    );
  };

  const handleSaveEdits = async () => {
    setSavingEdits(true);
    try {
      await saveReviewEdits(
        noteId,
        sections.map((s) => ({
          id: s.id,
          entries: s.entries.filter((e) => e.text.trim()).map((e) => ({ text: e.text, fieldId: e.fieldId }))
        }))
      );
      setStatusMessage('Edits saved.');
    } catch (err: any) {
      setStatusMessage(`Could not save edits: ${err.message}`);
    } finally {
      setSavingEdits(false);
    }
  };

  const handleApprove = async () => {
    if (approving) return;
    setApproving(true);
    try {
      await handleSaveEdits();
      await approveReview(meetingId, clinicianEmail || 'Clinician');
      setScreen('COMPLETED');
    } catch (err: any) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setApproving(false);
    }
  };

  const formatTimer = (sec: number) =>
    `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  const liveText = [
    ...transcript.finalEntries.map((e) => e.text),
    transcript.interimText
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="appContainer">
      <header className="header">
        <div className="logoRow">
          <span style={{ fontSize: '24px' }}>♿</span>
          <h1 className="title">Vabatim</h1>
        </div>
        <div className="healthBadge">
          API:{' '}
          <strong style={{ color: apiHealth?.status === 'HEALTHY' ? '#22c55e' : '#f59e0b' }}>
            {apiHealth?.status || 'CHECKING'}
          </strong>
        </div>
      </header>

      <main className="mainContent">
        {recovery && screen === 'MEETINGS' && (
          <div className="warningBanner">
            An assessment was interrupted with {recovery.entries.length} captured statements.
            The transcript can be recovered; the audio recording cannot, because the browser
            closed.{' '}
            <button
              className="secondaryButton"
              onClick={() => {
                setMeetingId(recovery.meetingId);
                liveTranscription.restore(recovery.entries);
                setTranscript(liveTranscription.getState());
                setRecovery(null);
                setScreen('RECORDING');
              }}
            >
              Recover transcript
            </button>{' '}
            <button
              className="secondaryButton"
              onClick={() => {
                void sessionCheckpoint.clear(recovery.meetingId);
                setRecovery(null);
              }}
            >
              Discard
            </button>
          </div>
        )}

        {screen === 'LOGIN' && (
          <div className="card">
            <h2>Secure clinician access</h2>
            <form onSubmit={handleLogin} className="form">
              <label className="label">Clinician email</label>
              <input
                type="email"
                value={clinicianEmail}
                onChange={(e) => setClinicianEmail(e.target.value)}
                className="input"
                autoComplete="username"
                required
              />
              <label className="label">Password</label>
              <input
                type="password"
                value={clinicianPassword}
                onChange={(e) => setClinicianPassword(e.target.value)}
                className="input"
                autoComplete="current-password"
                required
              />
              <button type="submit" className="primaryButton" disabled={loggingIn}>
                {loggingIn ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        )}

        {screen === 'MEETINGS' && (
          <div className="card">
            <h2>New assessment</h2>
            <div className="form" style={{ marginTop: 20 }}>
              <label className="label">Client reference (pseudonymous — no patient name)</label>
              <input
                type="text"
                value={clientRef}
                onChange={(e) => setClientRef(e.target.value)}
                className="input"
                placeholder="e.g. CLIENT-A8492"
              />
              <label className="label">Assessment template</label>
              <select
                value={templateType}
                onChange={(e: any) => setTemplateType(e.target.value)}
                className="input"
              >
                <option value="INITIAL_ASSESSMENT">Initial wheelchair assessment</option>
                <option value="REVIEW">Review / handover</option>
              </select>
              <label className="label">Assessment mode</label>
              <select
                value={sessionFormat}
                onChange={(e: any) => setSessionFormat(e.target.value)}
                className="input"
              >
                <option value="FACE_TO_FACE">In person</option>
                <option value="VIRTUAL">Remote</option>
              </select>
              <button onClick={handleCreateMeeting} className="primaryButton">
                Continue to consent
              </button>
              <button onClick={() => setScreen('METRICS')} className="secondaryButton">
                Documentation quality
              </button>
            </div>
          </div>
        )}

        {screen === 'CONSENT' && (
          <div className="card">
            <h2>Consent to record</h2>
            <div className="consentBox">
              <p>
                Confirm that the person being assessed has been told this consultation will be
                captured to help produce their clinical notes, and has agreed.
              </p>
              <p className="hint">
                Microphone permission is a browser setting. It is not consent, and granting it
                does not record consent here.
              </p>
            </div>
            <div className="buttonGroup">
              <button onClick={handleGrantConsent} className="primaryButton">
                Consent given — continue
              </button>
              <button onClick={() => setScreen('MEETINGS')} className="secondaryButton">
                Cancel
              </button>
            </div>
          </div>
        )}

        {screen === 'RECORDING' && (
          <div className="card">
            <div className="recordingHeader">
              <div>
                <span className={isListening ? 'liveIndicator' : ''} />
                <strong>{isListening ? 'Assessment in progress' : 'Ready to start'}</strong>
              </div>
              <div className="timerDisplay">{formatTimer(timerSeconds)}</div>
            </div>

            <p className="hint">
              Microphone: {recorderState === 'RECORDING' ? 'recording' : recorderState.toLowerCase()}
              {!transcriptionAvailable && ' · live transcription unavailable in this browser'}
            </p>

            {statusMessage && <div className="warningBanner">{statusMessage}</div>}

            {/*
              A single flowing transcript. There are deliberately no speaker labels: the
              browser cannot tell who is speaking, and showing a guess would be worse than
              showing nothing.
            */}
            <div className="transcriptStream scrollBox">
              <h3 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', margin: '0 0 8px 0' }}>LIVE TRANSCRIPT</h3>
              {liveText ? (
                <p>
                  {transcript.finalEntries.map((e) => e.text).join(' ')}
                  {transcript.interimText && (
                    <span style={{ opacity: 0.55 }}> {transcript.interimText}</span>
                  )}
                </p>
              ) : (
                <p className="hint">
                  {isListening
                    ? 'Listening… speech will appear here as it is recognised.'
                    : 'Press Start assessment and have the consultation as normal.'}
                </p>
              )}
              <div ref={transcriptEndRef} />
            </div>

            <div className="buttonGroup">
              {!isListening ? (
                <button onClick={handleStart} className="primaryButton">
                  Start assessment
                </button>
              ) : (
                <button onClick={handleEndAssessment} className="dangerButton" disabled={endingRef.current}>
                  End assessment
                </button>
              )}
            </div>

            {/* TEMPORARY PRODUCTION DIAGNOSTICS PANEL */}
            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 8,
                fontSize: '12px',
                fontFamily: 'monospace',
                color: '#cbd5e1',
                textAlign: 'left'
              }}
            >
              <h4 style={{ margin: '0 0 10px 0', color: '#38bdf8', fontSize: '13px', fontFamily: 'sans-serif' }}>
                🔍 WEB SPEECH DIAGNOSTICS (PRODUCTION VERIFICATION PANEL)
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 12 }}>
                <div><strong>Recognition API:</strong> <span style={{ color: '#f59e0b' }}>{speechDiagnostics?.api ?? 'unavailable'}</span></div>
                <div><strong>Recognition State:</strong> <span style={{ color: '#f59e0b' }}>{speechDiagnostics?.state ?? 'idle'}</span></div>
                <div><strong>Last Error Code:</strong> <span style={{ color: speechDiagnostics?.lastErrorCode && speechDiagnostics.lastErrorCode !== 'none' ? '#ef4444' : '#10b981' }}>{speechDiagnostics?.lastErrorCode ?? 'none'}</span></div>
                <div><strong>MediaRecorder Start:</strong> {speechDiagnostics?.mediaRecorderStartTimeMs ? `${speechDiagnostics.mediaRecorderStartTimeMs} ms` : 'none'}</div>
                <div><strong>Speech Start Requested:</strong> {speechDiagnostics?.speechStartRequestedTimeMs ? `${speechDiagnostics.speechStartRequestedTimeMs} ms` : 'none'}</div>
                <div><strong>Speech onstart Event:</strong> {speechDiagnostics?.speechOnStartTimeMs ? `${speechDiagnostics.speechOnStartTimeMs} ms` : 'none'}</div>
              </div>

              <h5 style={{ margin: '8px 0 4px 0', color: '#94a3b8', fontSize: '11px', fontFamily: 'sans-serif' }}>EVENT COUNTERS</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px' }}>
                <div>startAttempts: <strong>{speechDiagnostics?.counters?.startAttempts ?? 0}</strong></div>
                <div>onstart: <strong>{speechDiagnostics?.counters?.onstartEvents ?? 0}</strong></div>
                <div>onaudiostart: <strong>{speechDiagnostics?.counters?.onaudiostartEvents ?? 0}</strong></div>
                <div>onsoundstart: <strong>{speechDiagnostics?.counters?.onsoundstartEvents ?? 0}</strong></div>
                <div>onspeechstart: <strong>{speechDiagnostics?.counters?.onspeechstartEvents ?? 0}</strong></div>
                <div>onresult: <strong>{speechDiagnostics?.counters?.onresultEvents ?? 0}</strong></div>
                <div>finalResults: <strong>{speechDiagnostics?.counters?.finalResults ?? 0}</strong></div>
                <div>interimResults: <strong>{speechDiagnostics?.counters?.interimResults ?? 0}</strong></div>
                <div>onend: <strong>{speechDiagnostics?.counters?.onendEvents ?? 0}</strong></div>
                <div>restartAttempts: <strong>{speechDiagnostics?.counters?.restartAttempts ?? 0}</strong></div>
              </div>
            </div>
          </div>
        )}

        {screen === 'PROCESSING' && (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚙️</div>
            <h2>{job?.stage ?? statusMessage ?? 'Preparing clinical documentation…'}</h2>
            <p className="hint">{job ? `${job.progress}%` : ''}</p>

            {job?.state === 'FAILED' && (
              <>
                <div className="warningBanner">
                  Documentation could not be generated. {job.error}
                  <br />
                  Your transcript is saved — you do not need to record the consultation again.
                </div>
                <button onClick={handleRetry} className="primaryButton">
                  Retry documentation generation
                </button>
              </>
            )}
          </div>
        )}

        {screen === 'REVIEW' && (
          <div className="card">
            <div className="draftNoticeBanner">
              <strong>Assessment note generated — review required.</strong> This is a draft. It
              becomes a clinical record only when you approve it.
            </div>

            {draft?.reviewFlags?.length > 0 && (
              <div className="warningBanner">
                <strong>{draft.reviewFlags.length} item(s) need your attention</strong>
                <ul>
                  {draft.reviewFlags.map((f: any, i: number) => (
                    <li key={i}>{f.description}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="scrollBox" style={{ maxHeight: '60vh' }}>
              {sections.map((section) => (
                <div key={section.id} className="noteItem">
                  <h3>{section.title}</h3>
                  {section.entries.length === 0 && (
                    <p className="hint">{section.notEstablished ?? 'Not discussed during this assessment.'}</p>
                  )}
                  {section.entries.map((entry, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <textarea
                        className="input"
                        style={{ flex: 1, minHeight: 60 }}
                        value={entry.text}
                        onChange={(e) => updateEntry(section.id, i, e.target.value)}
                      />
                      <button
                        className="secondaryButton"
                        onClick={() => deleteEntry(section.id, i)}
                        aria-label="Remove this statement"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button className="secondaryButton" onClick={() => addEntry(section.id)}>
                    + Add
                  </button>
                </div>
              ))}
            </div>

            <div className="buttonGroup">
              <button onClick={handleSaveEdits} className="secondaryButton" disabled={savingEdits}>
                {savingEdits ? 'Saving…' : 'Save edits'}
              </button>
              <button onClick={handleApprove} className="successButton" disabled={approving}>
                {approving ? 'Approving…' : 'Approve & finalise'}
              </button>
            </div>
            {statusMessage && <p className="hint">{statusMessage}</p>}
          </div>
        )}

        {screen === 'COMPLETED' && (
          <div className="card">
            <div className="approvedNoticeBanner">
              <strong>Approved.</strong> This assessment note is now a finalised clinical record.
            </div>
            <div className="downloadRow">
              <button
                className="downloadButton"
                onClick={async () => {
                  try {
                    await downloadDocumentBlob(noteId, 'pdf');
                  } catch (err: any) {
                    alert(`Could not download PDF: ${err.message}`);
                  }
                }}
              >
                Download PDF
              </button>
              <button
                className="downloadButton"
                onClick={async () => {
                  try {
                    await downloadDocumentBlob(noteId, 'docx');
                  } catch (err: any) {
                    alert(`Could not download DOCX: ${err.message}`);
                  }
                }}
              >
                Download DOCX
              </button>
            </div>
            <button onClick={() => setScreen('MEETINGS')} className="secondaryButton">
              New assessment
            </button>
          </div>
        )}

        {screen === 'METRICS' && (
          <div className="card">
            <MetricsDashboard />
            <button onClick={() => setScreen('MEETINGS')} className="secondaryButton">
              Back
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
