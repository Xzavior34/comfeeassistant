import request from 'supertest';
import app from '../../src/app';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

describe('Security & Authorization Hardening Tests (IDOR / BOLA Prevention)', () => {
  // Tenant A: Clinician 1 (NHS Trust 1)
  const tokenOrgA = jwt.sign(
    { id: 'user-clinician-1', email: 'sarah@nhs.uk', role: 'CLINICIAN', organisationId: 'NHS-TRUST-ALPHA' },
    env.JWT_SECRET
  );

  // Tenant B: Clinician 2 (NHS Trust 2 - Foreign Organisation)
  const tokenOrgB = jwt.sign(
    { id: 'user-clinician-2', email: 'john@nhs.uk', role: 'CLINICIAN', organisationId: 'NHS-TRUST-BETA' },
    env.JWT_SECRET
  );

  it('1. CROSS-TENANT ISOLATION: Clinician B cannot access meetings belonging to Organisation A', async () => {
    // Create meeting under Organisation A
    const createRes = await request(app)
      .post('/api/meetings')
      .set('Authorization', `Bearer ${tokenOrgA}`)
      .send({ clientReference: 'CLIENT-ALPHA-100' });

    const meetingId = createRes.body.meeting.id;

    // Attempt to access meeting using Clinician B token (Organisation B)
    const accessRes = await request(app)
      .patch(`/api/meetings/${meetingId}/state`)
      .set('Authorization', `Bearer ${tokenOrgB}`)
      .send({ targetState: 'READY' });

    expect(accessRes.status).toBe(403);
    expect(accessRes.body.error).toContain('Access denied');
  });

  it('2. EXPIRED SIGNED LINKS: Access endpoint rejects expired document token', async () => {
    const expiredToken = Buffer.from(`document-key-101:${Date.now() - 60000}`).toString('base64url');

    const res = await request(app).get(`/api/documents/secure-access?token=${expiredToken}&key=document-key-101`);

    expect(res.status).toBe(410);
    expect(res.body.error).toContain('expired');
  });

  it('3. REJECT MANIPULATED TOKEN: Access endpoint rejects invalid signature token', async () => {
    const invalidToken = 'malicious-forged-token-string';

    const res = await request(app).get(`/api/documents/secure-access?token=${invalidToken}&key=document-key-101`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid document access link');
  });
});
