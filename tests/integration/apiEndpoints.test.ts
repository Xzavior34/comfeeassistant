import request from 'supertest';
import app from '../../src/app';

describe('Vabatim API Integration Tests', () => {
  let authToken: string;

  it('GET /health should return 200 HEALTHY without revealing sensitive info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HEALTHY');
  });

  it('POST /api/auth/login should authenticate clinician and return JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sarah.jenkins@nhs.uk', password: 'ClinicianSecure123!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    authToken = res.body.token;
  });

  it('POST /api/meetings should create a new meeting under clinician organisation', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ clientReference: 'CLIENT-TEST-99', expectedSpeakerCount: 2 });

    expect(res.status).toBe(201);
    expect(res.body.meeting.clientReference).toBe('CLIENT-TEST-99');
  });

  it('GET /api/meetings without token should return 401 Unauthorized', async () => {
    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(401);
  });
});
