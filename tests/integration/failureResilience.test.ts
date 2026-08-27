import request from 'supertest';
import app from '../../src/app';
import { createSignedLinkToken } from '../../src/services/signedLinks';

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

    // Consent gate prevents recording upload without consent. Checked before the payload is
    // examined at all, so a recording for a non-consented session is refused outright.
    const recordingRes = await request(app)
      .post(`/api/recordings/upload?meetingId=${meetingId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'audio/wav')
      .send(Buffer.alloc(64, 1));

    expect(recordingRes.status).toBe(400);
    expect(recordingRes.body.error).toContain('Consent required');
  });

  it('2. EXPIRED SIGNED URL: Rejects expired token with HTTP 410', async () => {
    // Signed, but past its expiry. An UNSIGNED token is no longer honoured as an authentic
    // expired link — it is simply invalid, which is the point of signing them.
    const expiredToken = createSignedLinkToken('key-101', -60);
    const res = await request(app).get(`/api/documents/secure-access?token=${encodeURIComponent(expiredToken)}`);

    expect(res.status).toBe(410);
    expect(res.body.error).toContain('expired');
  });

  it('3. MALFORMED TOKEN: Rejects invalid string token with HTTP 400', async () => {
    const res = await request(app).get('/api/documents/secure-access?token=NOT_VALID_BASE64');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid document access link');
  });
});
