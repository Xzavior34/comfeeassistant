import request from 'supertest';
import app from '../../src/app';

describe('Granular Cloud Health Check & Live Deployment Verification', () => {
  it('1. /health/database should return authentic DB status', async () => {
    const res = await request(app).get('/health/database');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONNECTED');
    expect(res.body.database).toBeDefined();
  });

  it('2. /health/storage should return active storage provider', async () => {
    const res = await request(app).get('/health/storage');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONNECTED');
    expect(res.body.providerName).toBeDefined();
  });

  it('3. /health/queue should return queue readiness status', async () => {
    const res = await request(app).get('/health/queue');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONNECTED');
    expect(res.body.queue).toBeDefined();
  });

  it('4. /health/speech-provider should return speech provider status', async () => {
    const res = await request(app).get('/health/speech-provider');
    expect(res.status).toBe(200);
    expect(res.body.providerName).toBeDefined();
    expect(['CONNECTED', 'NOT CONFIGURED']).toContain(res.body.status);
  });

  it('5. /health/llm-provider should return LLM provider status', async () => {
    const res = await request(app).get('/health/llm-provider');
    expect(res.status).toBe(200);
    expect(res.body.providerName).toBeDefined();
    expect(['CONNECTED', 'NOT CONFIGURED']).toContain(res.body.status);
  });
});
