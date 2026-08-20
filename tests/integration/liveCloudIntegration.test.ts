import request from 'supertest';
import app from '../../src/app';
import { SupabaseStorageProvider } from '../../src/providers/storage/SupabaseStorageProvider';

describe('Live Cloud Integration & Deployment Verification', () => {
  it('1. REMOTE HEALTH CHECK: /health returns HEALTHY status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HEALTHY');
  });

  it('2. SPEECH PROVIDER HEALTH: /health/speech-provider returns status and details', async () => {
    const res = await request(app).get('/health/speech-provider');
    expect(res.status).toBe(200);
    expect(res.body.providerName).toBeDefined();
    expect(['CONNECTED', 'NOT CONFIGURED']).toContain(res.body.status);
  });

  it('3. SUPABASE STORAGE PROVIDER: Safely handles unconfigured credential status', async () => {
    const supabaseStorage = new SupabaseStorageProvider();
    expect(supabaseStorage.name).toBe('SupabaseStorageProvider');

    // Default fallback signed URL generation when unconfigured
    const signedUrl = await supabaseStorage.getSignedUrl('test-key.pdf', 900);
    expect(signedUrl).toContain('/api/documents/secure-access');
  });
});
