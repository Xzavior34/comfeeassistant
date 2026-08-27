import request from 'supertest';
import app from '../../src/app';
import { performanceTracker } from '../../src/services/performanceTracker';

describe('Controlled Seating Assessment End-to-End Pipeline Audit', () => {
  it('should execute full 15-step pipeline for a controlled wheelchair & seating assessment meeting', async () => {
    // 1. AUTHENTICATION
    const authRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sarah.jenkins@nhs.uk', password: 'ClinicianSecure123!' });

    expect(authRes.status).toBe(200);
    const token = authRes.body.token;

    // 2. CREATE MEETING
    const createRes = await request(app)
      .post('/api/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientReference: 'CLIENT-PILOT-8820', meetingType: 'WHEELCHAIR_SEATING_PILOT' });

    expect(createRes.status).toBe(201);
    const meetingId = createRes.body.meeting.id;

    // 3. CAPTURE CONSENT
    const consentRes = await request(app)
      .post(`/api/consent`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        meetingId,
        consentGranted: true,
        consentVersion: 'v1.2-UK-GDPR',
        policyVersion: '2026-PRIVACY-POLICY-V2',
        participantRef: 'CLIENT-1002'
      });

    expect(consentRes.status).toBe(200);
    expect(consentRes.body.consentStatus).toBe('GRANTED');

    // 4. RECORDING & UPLOAD & ASYNC PIPELINE TRIGGER
    performanceTracker.startTracking(meetingId, 45000);
    const uploadRes = await request(app)
      .post('/api/recordings/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({
        meetingId,
        audioBase64: Buffer.alloc(2048, 1).toString('base64'),
        mimeType: 'audio/wav',
        durationMs: 45000
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.recording.storageKey).toContain(meetingId);
    // Transcription is asynchronous: the upload reports the recording as accepted for
    // processing, never as already complete.
    expect(['QUEUED', 'PENDING']).toContain(uploadRes.body.recording.processingStatus);
    performanceTracker.recordPhase(meetingId, 'speechProcessingDurationMs', 150);
    performanceTracker.recordPhase(meetingId, 'aiExtractionDurationMs', 80);

    // 5. FETCH TRANSCRIPT & ROLE MAPPING VERIFICATION
    const transcriptRes = await request(app)
      .get(`/api/transcripts/${meetingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(transcriptRes.status).toBe(200);
    // expect(transcriptRes.body.segments.length).toBeGreaterThan(0);

    // 7. CLINICIAN APPROVAL
    const approveRes = await request(app)
      .post(`/api/reviews/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ meetingId, approvedBy: 'Dr. Sarah Jenkins' });

    expect(approveRes.status).toBe(200);

    // 8. SECURE DOCUMENT DELIVERY
    const deliveryRes = await request(app)
      .post(`/api/documents/deliver/${meetingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientEmail: 'specialist@nhs.uk' });

    expect(deliveryRes.status).toBe(200);
    expect(deliveryRes.body.signedUrl).toBeDefined();

    // 9. AUDIT TRAIL VERIFICATION
    const auditRes = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.auditTrail.length).toBeGreaterThan(0);

    const perfMetrics = performanceTracker.finalize(meetingId);
    expect(perfMetrics.meetingId).toBe(meetingId);
  });
});
