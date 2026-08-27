import request from 'supertest';
import app from '../../src/app';

/**
 * Health endpoint contract.
 *
 * These previously asserted that every dependency reported CONNECTED — which they did
 * unconditionally, without contacting anything. A check that cannot fail is not a check, and
 * during the recent outage these endpoints reported a healthy system throughout.
 *
 * The contract now distinguishes VERIFIED (something was actually contacted) from CONFIGURED
 * (credentials are present, nothing was contacted), and a genuinely unreachable dependency
 * returns 503.
 */
describe('Health endpoints', () => {
  it('/health reports the operating mode without exposing configuration', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HEALTHY');
    expect(res.body.mode.speech).toBeDefined();
    expect(res.body.mode.processing).toBeDefined();
    expect(res.body.mode.diarization).toBe('none');

    // No secret, connection string or credential may appear anywhere in the response.
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/postgres:\/\//);
    expect(body).not.toMatch(/redis:\/\//);
    expect(body).not.toMatch(/service_role/i);
    expect(body).not.toMatch(/AIza/);
  });

  it('/health/database actually contacts the database and says so', async () => {
    const res = await request(app).get('/health/database');

    // 200 VERIFIED when reachable, 503 UNREACHABLE when not. Never an unconditional pass.
    expect([200, 503]).toContain(res.status);
    expect(['VERIFIED', 'UNREACHABLE']).toContain(res.body.status);
    if (res.status === 503) {
      expect(JSON.stringify(res.body)).not.toMatch(/postgres:\/\//);
    }
  });

  it('/health/storage reports configuration and does not claim verification', async () => {
    const res = await request(app).get('/health/storage');

    expect(res.status).toBe(200);
    expect(['CONFIGURED', 'NOT CONFIGURED']).toContain(res.body.status);
    expect(res.body.providerName).toBeDefined();
    expect(res.body.note).toMatch(/no object was read or written/i);
  });

  it('/health/processing reports the processing mode', async () => {
    const res = await request(app).get('/health/processing');

    expect(res.status).toBe(200);
    expect(['inline', 'queue']).toContain(res.body.mode);
  });

  it('/health/speech-provider describes the device mode honestly', async () => {
    const res = await request(app).get('/health/speech-provider');

    expect(res.status).toBe(200);
    expect(['CONNECTED', 'CONFIGURED', 'NOT CONFIGURED']).toContain(res.body.status);
    expect(res.body.providerName).toBeDefined();
    // Device mode must state that it performs no speaker separation.
    if (res.body.providerName === 'DeviceSpeechProvider') {
      expect(res.body.details).toMatch(/no speaker separation/i);
    }
  });

  it('/health/llm-provider returns a status without leaking the key', async () => {
    const res = await request(app).get('/health/llm-provider');

    expect([200, 503]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/AIza/);
  });
});
