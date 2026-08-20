const DEFAULT_API_URL = 'https://comfeeassistant.onrender.com';

export const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || DEFAULT_API_URL;

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
    body: JSON.stringify({ email, password: password || 'ClinicianSecure123!' })
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
  const res = await fetch(`${API_BASE_URL}/api/transcripts/process`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ meetingId, segments, clinicianName, clientRef, templateType, sessionFormat })
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
