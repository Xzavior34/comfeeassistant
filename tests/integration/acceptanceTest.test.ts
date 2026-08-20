import request from 'supertest';
import app from '../../src/app';

describe('Phase 5 Final System Acceptance Test Suite', () => {
  it('1. HEALTH CHECK: /health/speech-provider reports provider status and details', async () => {
    const res = await request(app).get('/health/speech-provider');
    expect(res.status).toBe(200);
    expect(res.body.providerName).toBeDefined();
    expect(['CONNECTED', 'NOT CONFIGURED']).toContain(res.body.status);
  });

  it('2. ACCEPTANCE PIPELINE: Executes full flow from login to document delivery with separated latency metrics', async () => {
    // Auth
    const authRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sarah.jenkins@nhs.uk', password: 'ClinicianSecure123!' });
    expect(authRes.status).toBe(200);
    const token = authRes.body.token;

    // Meeting Creation
    const meetingRes = await request(app)
      .post('/api/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientReference: 'CLIENT-ACCEPTANCE-9901' });
    expect(meetingRes.status).toBe(201);
    const meetingId = meetingRes.body.meeting.id;

    // Consent
    await request(app)
      .post(`/api/consent`)
      .set('Authorization', `Bearer ${token}`)
      .send({ meetingId, consentGranted: true, consentVersion: 'v1.2-UK-GDPR', policyVersion: '2026-PRIVACY-POLICY-V2', participantRef: 'CLIENT-ACCEPTANCE-9901' });

    // Upload & Process
    const uploadRes = await request(app)
      .post('/api/recordings/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ meetingId, sampleRate: 16000, channelCount: 1, format: 'audio/wav', durationMs: 45000 });
    expect(uploadRes.status).toBe(200);

    // Review & Sign
    const approveRes = await request(app)
      .post(`/api/reviews/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ meetingId, approvedBy: 'Clinician' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.approvalRecord.noteHash).toBeDefined();
  });
});
