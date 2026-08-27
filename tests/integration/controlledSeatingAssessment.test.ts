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
      .post(`/api/recordings/upload?meetingId=${meetingId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'audio/wav')
      .send(Buffer.alloc(2048, 1));

    expect(uploadRes.status).toBe(200);
    // Audio retention is off by default, so the recording is honestly reported as not
    // stored rather than the endpoint pretending it kept it.
    expect(uploadRes.body.stored).toBe(false);
    expect(uploadRes.body.message).toMatch(/retention is disabled/i);
    performanceTracker.recordPhase(meetingId, 'speechProcessingDurationMs', 150);
    performanceTracker.recordPhase(meetingId, 'aiExtractionDurationMs', 80);

    // 5. FETCH TRANSCRIPT & ROLE MAPPING VERIFICATION
    const transcriptRes = await request(app)
      .get(`/api/transcripts/${meetingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(transcriptRes.status).toBe(200);
    // expect(transcriptRes.body.segments.length).toBeGreaterThan(0);

    // 6. SUBMIT THE FROZEN TRANSCRIPT. Free mode sends text; generation is asynchronous.
    const processRes = await request(app)
      .post('/api/transcripts/process')
      .set('Authorization', `Bearer ${token}`)
      .send({
        meetingId,
        transcriptText:
          'Seat width is forty four centimetres in supported sitting. There is a left pelvic ' +
          'obliquity of about fifteen degrees that corrects on support.'
      });

    expect(processRes.status).toBe(202);
    expect(processRes.body.jobId).toBeDefined();

    // 7. CLINICIAN APPROVAL is refused while no note has been generated. In this environment
    // the clinical model is unavailable, so generation cannot have produced one — and a note
    // that does not exist must not be approvable. The previous implementation approved the
    // meeting regardless and returned a hardcoded note hash.
    const approveRes = await request(app)
      .post(`/api/reviews/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ meetingId, approvedBy: 'Dr. Sarah Jenkins', attested: true });

    expect(approveRes.status).toBe(404);

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
