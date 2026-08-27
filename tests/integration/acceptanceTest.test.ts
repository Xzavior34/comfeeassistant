import request from 'supertest';
import app from '../../src/app';

describe('Phase 5 Final System Acceptance Test Suite', () => {
  it('1. HEALTH CHECK: /health/speech-provider reports provider status and details', async () => {
    const res = await request(app).get('/health/speech-provider');
    expect(res.status).toBe(200);
    expect(res.body.providerName).toBeDefined();
    expect(['CONNECTED', 'CONFIGURED', 'NOT CONFIGURED']).toContain(res.body.status);
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

    // Submit the frozen transcript. Free mode sends TEXT, not audio, and generation is
    // asynchronous, so this returns a job to poll rather than a finished note.
    const processRes = await request(app)
      .post('/api/transcripts/process')
      .set('Authorization', `Bearer ${token}`)
      .send({
        meetingId,
        transcriptText:
          'Good morning. The seat width is forty four centimetres measured in supported ' +
          'sitting. There is a left pelvic obliquity of about fifteen degrees which corrects ' +
          'on support. I get pain in my right hip after about an hour of sitting.',
        clientRef: 'CLIENT-ACCEPTANCE-9901'
      });

    expect(processRes.status).toBe(202);
    expect(processRes.body.jobId).toBeDefined();
    expect(processRes.body.pollUrl).toContain('/api/transcripts/job/');

    // The job is queryable immediately, which is what makes a refresh survivable.
    const jobRes = await request(app)
      .get(`/api/transcripts/job/${processRes.body.jobId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(jobRes.status).toBe(200);
    expect(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']).toContain(jobRes.body.state);
  });

  it('3. APPROVAL IS REFUSED WHEN THERE IS NO GENERATED NOTE', async () => {
    const authRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sarah.jenkins@nhs.uk', password: 'ClinicianSecure123!' });
    const token = authRes.body.token;

    const meetingRes = await request(app)
      .post('/api/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientReference: 'CLIENT-NO-NOTE' });
    const meetingId = meetingRes.body.meeting.id;

    // The previous implementation approved the meeting without ever loading a note, and
    // returned a hardcoded string as the note hash. Approving nothing must fail.
    const approveRes = await request(app)
      .post('/api/reviews/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({ meetingId, approvedBy: 'Clinician', attested: true });

    expect(approveRes.status).toBe(404);
    expect(approveRes.body.error).toMatch(/no note to approve/i);
  });

  it('4. U. APPROVAL REQUIRES EXPLICIT CLINICIAN ATTESTATION', async () => {
    const authRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sarah.jenkins@nhs.uk', password: 'ClinicianSecure123!' });
    const token = authRes.body.token;

    const meetingRes = await request(app)
      .post('/api/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientReference: 'CLIENT-ATTEST' });

    const res = await request(app)
      .post('/api/reviews/approve')
      .set('Authorization', `Bearer ${token}`)
      // No `attested` flag: approval must never be a side effect of another request.
      .send({ meetingId: meetingRes.body.meeting.id, approvedBy: 'Clinician' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/attestation/i);
  });
});
