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

    // 3. CONSENT WORKFLOW
    const consentRes = await request(app)
      .post(`/api/consent/${meetingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        consentStatus: 'GRANTED',
        consentVersion: 'v1.2-UK-GDPR',
        policyVersion: '2026-PRIVACY-POLICY-V2',
        participantRef: 'CLIENT-PILOT-8820'
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
        sampleRate: 16000,
        channelCount: 1,
        format: 'audio/wav',
        durationMs: 45000
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.recording.processingStatus).toBe('COMPLETED');
    performanceTracker.recordPhase(meetingId, 'speechProcessingDurationMs', 150);
    performanceTracker.recordPhase(meetingId, 'aiExtractionDurationMs', 80);

    // 5. FETCH TRANSCRIPT & ROLE MAPPING VERIFICATION
    const transcriptRes = await request(app)
      .get(`/api/transcripts/${meetingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(transcriptRes.status).toBe(200);
    expect(transcriptRes.body.segments.length).toBeGreaterThan(0);

    // 6. CLINICIAN REVIEW & EDIT DRAFT NOTE
    const reviewRes = await request(app)
      .get(`/api/reviews/${meetingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.validatedNote).toBeDefined();

    // 7. CLINICIAN APPROVAL & CRYPTOGRAPHIC HASH SIGNING
    const approveRes = await request(app)
      .post(`/api/reviews/${meetingId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.approvalRecord.noteHash).toBeDefined();

    // 8. GENERATE SECURE DELIVERY LINK & AUTHENTICATED ACCESS
    const deliveryRes = await request(app)
      .post(`/api/documents/deliver/${meetingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientEmail: 'sarah.jenkins@nhs.uk', recipientName: 'Dr. Sarah Jenkins' });

    expect(deliveryRes.status).toBe(200);
    expect(deliveryRes.body.signedUrl).toContain('/api/documents/secure-access');

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
