// Set VITE_API_URL at build time to point the app at your API.
// Leave it unset to use same-origin requests, which is correct on Vercel where
// vercel.json rewrites /api/* to the API service — that avoids CORS entirely.
export const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

let authToken = localStorage.getItem('comfee_auth_token') || '';

/** Reads the server's error message, preferring its explanation over a bare status. */
async function describeError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.fields?.length) {
      return `${data.error}: ${data.fields.map((f: any) => `${f.field} (${f.problem})`).join(', ')}`;
    }
    return data?.message || data?.error || `HTTP ${res.status}`;
  } catch {
    return (await res.text().catch(() => '')) || res.statusText || `HTTP ${res.status}`;
  }
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
  };
}

export async function downloadDocumentBlob(noteId: string, format: 'pdf' | 'docx'): Promise<void> {
  const token = authToken || localStorage.getItem('comfee_auth_token') || '';
  // No token in the URL. This is a fetch, so the Authorization header below authenticates it,
  // and a JWT in a query string ends up in server access logs, browser history and Referer.
  const url = `${API_BASE_URL}/api/documents/${noteId}/${format}`;

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(await describeError(res));
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `Vabatim_Assessment_${noteId.slice(0, 8)}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
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

/**
 * Submits the frozen transcript for clinical documentation.
 *
 * Text, not audio. The transcript was produced on the device, so nothing large is uploaded
 * and Gemini receives only what it needs. Returns a job id: generation takes longer than an
 * HTTP request should be held open for, so the client polls.
 */
export async function submitTranscript(
  meetingId: string,
  transcriptText: string,
  clientRef: string,
  templateType: 'INITIAL_ASSESSMENT' | 'REVIEW' = 'INITIAL_ASSESSMENT',
  sessionFormat: 'FACE_TO_FACE' | 'VIRTUAL' = 'FACE_TO_FACE'
): Promise<{ jobId: string; status: string; pollUrl: string }> {
  const res = await fetch(`${API_BASE_URL}/api/transcripts/process`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ meetingId, transcriptText, clientRef, templateType, sessionFormat })
  });

  if (!res.ok) throw new Error(await describeError(res));
  return await res.json();
}

export interface JobStatus {
  jobId: string;
  meetingId: string;
  state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  stage: string;
  progress: number;
  clinicalNoteId: string | null;
  error: string | null;
  canRetry: boolean;
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_BASE_URL}/api/transcripts/job/${jobId}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error(await describeError(res));
  return await res.json();
}

/** Regenerates from the transcript already saved on the server. No re-recording. */
export async function retryDocumentation(meetingId: string) {
  const res = await fetch(`${API_BASE_URL}/api/transcripts/retry/${meetingId}`, {
    method: 'POST',
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error(await describeError(res));
  return await res.json();
}

/** The generated draft, its review flags, and the transcript it came from. */
export async function getReviewDraft(meetingId: string) {
  const res = await fetch(`${API_BASE_URL}/api/reviews/${meetingId}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await describeError(res));
  return await res.json();
}

/** Saves the clinician's edits as a new version. */
export async function saveReviewEdits(
  noteId: string,
  sections: { id: string; entries: { text: string; fieldId?: string }[] }[]
) {
  const res = await fetch(`${API_BASE_URL}/api/reviews/${noteId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ sections })
  });
  if (!res.ok) throw new Error(await describeError(res));
  return await res.json();
}

export async function approveReview(meetingId: string, approvedBy: string) {
  const res = await fetch(`${API_BASE_URL}/api/reviews/approve`, {
    method: 'POST',
    headers: getAuthHeaders(),
    // attested is explicit: the server refuses approval without it, so approval can never
    // be a side effect of some other request.
    body: JSON.stringify({ meetingId, approvedBy, attested: true })
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
