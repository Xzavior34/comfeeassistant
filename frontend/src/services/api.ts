const DEFAULT_API_URL = 'https://comfeeassistant.onrender.com';

export const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || DEFAULT_API_URL;

export async function checkApiHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { status: 'OFFLINE', error: err.message };
  }
}

export async function loginClinician(email: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo-clinician-auth-pass' }) // Real auth logic needed in future
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.statusText}`);
  }
  return await res.json();
}

export async function createMeeting(clientReference: string, templateType: 'INITIAL_ASSESSMENT' | 'REVIEW' = 'INITIAL_ASSESSMENT', sessionFormat: 'FACE_TO_FACE' | 'VIRTUAL' = 'FACE_TO_FACE') {
  const res = await fetch(`${API_BASE_URL}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    throw new Error(`Meeting creation failed: ${res.statusText}`);
  }
  return await res.json();
}

export async function recordConsent(meetingId: string, consentGranted: boolean) {
  const res = await fetch(`${API_BASE_URL}/api/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meetingId,
      consentGranted,
      consentVersion: 'v2.1',
      participantRef: 'Client-01'
    })
  });
  if (!res.ok) {
    throw new Error(`Consent recording failed: ${res.statusText}`);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, segments, clinicianName, clientRef, templateType, sessionFormat })
  });
  if (!res.ok) {
    throw new Error(`Transcript processing failed: ${res.statusText}`);
  }
  return await res.json();
}

export async function approveReview(meetingId: string, approvedBy: string) {
  const res = await fetch(`${API_BASE_URL}/api/reviews/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, approvedBy })
  });
  if (!res.ok) {
    throw new Error(`Approval failed: ${res.statusText}`);
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
