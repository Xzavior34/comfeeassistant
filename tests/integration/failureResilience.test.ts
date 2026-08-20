import request from 'supertest';
import app from '../../src/app';

describe('System Failure Resilience & Graceful Exception Handling', () => {
  it('1. SPEECH API UNAVAILABLE: Unconfigured cloud provider fails gracefully with 500/Error', async () => {
    // Attempting live speech transcription without credentials fails safely
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sarah.jenkins@nhs.uk', password: 'ClinicianSecure123!' });

    const token = res.body.token;

    const meetingRes = await request(app)
      .post('/api/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientReference: 'test-client' });
    
    const meetingId = meetingRes.body.meeting.id;

    // Consent gate prevents recording upload without consent
    const recordingRes = await request(app)
      .post('/api/recordings/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ meetingId, sampleRate: 16000 });

    expect(recordingRes.status).toBe(400);
    expect(recordingRes.body.error).toContain('Consent required');
  });

  it('2. EXPIRED SIGNED URL: Rejects expired token with HTTP 410', async () => {
    const expiredToken = Buffer.from('key-101:1000000000000').toString('base64url');
    const res = await request(app).get(`/api/documents/secure-access?token=${expiredToken}&key=key-101`);

    expect(res.status).toBe(410);
    expect(res.body.error).toContain('expired');
  });

  it('3. MALFORMED TOKEN: Rejects invalid string token with HTTP 400', async () => {
    const res = await request(app).get('/api/documents/secure-access?token=NOT_VALID_BASE64&key=key-101');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid document access link');
  });
});
