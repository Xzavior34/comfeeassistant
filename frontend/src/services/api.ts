// Set VITE_API_URL at build time to point the app at your API.
// Leave it unset to use same-origin requests, which is correct on Vercel where
// vercel.json rewrites /api/* to the API service — that avoids CORS entirely.
export const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

let authToken = localStorage.getItem('comfee_auth_token') || '';

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
  };
}

export async function checkApiHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { status: 'OFFLINE', error: err.message };
  }
}

export async function loginClinician(email: string, password?: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    let errorText = '';
    try {
      const errData = await res.json();
      errorText = errData.error || errData.message || JSON.stringify(errData);
    } catch {
      errorText = await res.text().catch(() => res.statusText);
    }
    throw new Error(errorText);
  }
  const data = await res.json();
  authToken = data.token;
  localStorage.setItem('comfee_auth_token', authToken);
  return data;
}

export async function createMeeting(clientReference: string, templateType: 'INITIAL_ASSESSMENT' | 'REVIEW' = 'INITIAL_ASSESSMENT', sessionFormat: 'FACE_TO_FACE' | 'VIRTUAL' = 'FACE_TO_FACE') {
  const res = await fetch(`${API_BASE_URL}/api/meetings`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      clientReference,
      meetingType: 'WHEELCHAIR_ASSESSMENT',
      templateType,
      sessionFormat,
      expectedSpeakerCount: 2,
      retentionPolicy: 'UK_NHS_STANDARD_8Y'
    })
  });
  if (!res.ok) {
    let errorText = '';
    try {
      const errData = await res.json();
      errorText = errData.error || errData.message || JSON.stringify(errData);
    } catch {
      errorText = await res.text().catch(() => res.statusText);
    }
    throw new Error(errorText);
  }
  return await res.json();
}

export async function recordConsent(meetingId: string, consentGranted: boolean) {
  const res = await fetch(`${API_BASE_URL}/api/consent`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      meetingId,
      consentGranted,
      consentVersion: 'v2.1',
      participantRef: 'Client-01'
    })
  });
  if (!res.ok) {
    let errorText = '';
    try {
      const errData = await res.json();
      errorText = errData.error || errData.message || JSON.stringify(errData);
    } catch {
      errorText = await res.text().catch(() => res.statusText);
    }
    throw new Error(errorText);
  }
  return await res.json();
}

export async function submitTranscriptAndProcess(
  meetingId: string,
  segments: any[],
  clinicianName: string,
  clientRef: string,
  templateType: 'INITIAL_ASSESSMENT' | 'REVIEW' = 'INITIAL_ASSESSMENT',
  sessionFormat: 'FACE_TO_FACE' | 'VIRTUAL' = 'FACE_TO_FACE'
) {
  // Sanitize and normalize transcript segments
  const sanitizedSegments = (segments || [])
    .filter((s: any) => s && typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s: any, idx: number) => {
      const start = Math.round(Math.max(0, Number(s.startTimeMs) || 0));
      const rawEnd = Math.round(Math.max(start, Number(s.endTimeMs) || start + 1000));
      const end = rawEnd <= start ? start + 1000 : rawEnd;
      const confidence = typeof s.confidence === 'number' && !isNaN(s.confidence)
        ? Math.min(1, Math.max(0, s.confidence))
        : null;

      return {
        id: s.id || `seg-${idx + 1}`,
        speakerId: s.speakerId && s.speakerId !== 'UNKNOWN' ? String(s.speakerId) : 'UNKNOWN',
        mappedRole: s.mappedRole || null,
        text: s.text.trim(),
        rawText: s.rawText ? String(s.rawText).trim() : s.text.trim(),
        startTimeMs: start,
        endTimeMs: end,
        confidence,
        isCorrected: Boolean(s.isCorrected),
        engineTopHypothesis: s.engineTopHypothesis ? String(s.engineTopHypothesis) : s.text.trim()
      };
    });

  if (sanitizedSegments.length === 0) {
    throw new Error('No final transcript was captured. Your recording has been preserved.');
  }

  const res = await fetch(`${API_BASE_URL}/api/transcripts/process`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      meetingId,
      segments: sanitizedSegments,
      clinicianName,
      clientRef,
      templateType,
      sessionFormat
    })
  });

  if (!res.ok) {
    let errorText = '';
    try {
      const errData = await res.json();
      errorText = errData.details
        ? `Validation error: ${Array.isArray(errData.details) ? errData.details.join(', ') : errData.details}`
        : errData.error || errData.message || JSON.stringify(errData);
    } catch {
      errorText = await res.text().catch(() => res.statusText);
    }
    throw new Error(errorText);
  }
  return await res.json();
}

/**
 * Uploads the consultation recording for speaker-differentiated transcription.
 *
 * The live on-screen text comes from browser recognition, which cannot separate speakers.
 * This recording is what the diarising cloud recogniser transcribes, and that transcript is
 * what becomes the clinical record.
 */
export async function uploadRecording(
  meetingId: string,
  blob: Blob,
  mimeType: string,
  durationMs: number,
  sessionPhrases: string[] = []
) {
  const audioBase64 = await blobToBase64(blob);

  const res = await fetch(`${API_BASE_URL}/api/recordings/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      meetingId,
      audioBase64,
      mimeType,
      durationMs,
      sessionPhrases,
      expectedSpeakerCount: 2
    })
  });

  if (!res.ok) {
    let errorText = '';
    try {
      const errData = await res.json();
      errorText = errData.error || errData.message || JSON.stringify(errData);
    } catch {
      errorText = await res.text().catch(() => res.statusText);
    }
    throw new Error(errorText);
  }

  return await res.json();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      // Strip the "data:audio/webm;base64," prefix.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the recording for upload.'));
    reader.readAsDataURL(blob);
  });
}

export async function approveReview(meetingId: string, approvedBy: string) {
  const res = await fetch(`${API_BASE_URL}/api/reviews/approve`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ meetingId, approvedBy })
  });
  if (!res.ok) {
    let errorText = '';
    try {
      const errData = await res.json();
      errorText = errData.error || errData.message || JSON.stringify(errData);
    } catch {
      errorText = await res.text().catch(() => res.statusText);
    }
    throw new Error(errorText);
  }
  return await res.json();
}

export async function getDocumentationQualityMetrics() {
  const res = await fetch(`${API_BASE_URL}/api/metrics/documentation-quality`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!res.ok) {
    throw new Error(`Failed to load metrics: ${res.statusText}`);
  }
  return await res.json();
}
