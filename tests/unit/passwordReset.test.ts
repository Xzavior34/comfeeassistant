import request from 'supertest';
import app from '../../src/app';

describe('Password Reset Workflow Unit & Integration Tests', () => {
  const testEmail = 'sarah.jenkins@nhs.uk';
  const initialPassword = 'ClinicianSecure123!';
  const updatedPassword = 'NewSecurePassword456!';

  it('rejects forgot-password request with invalid email payload', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email address is required/i);
  });

  it('returns generic success message for non-existent email (enumeration protection)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nonexistent-clinician-999@vabatim.nhs.uk' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password reset instructions have been sent/i);
  });

  it('generates a reset token when requesting password reset for an existing user', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: testEmail });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password reset instructions have been sent/i);
    expect(res.body.debugResetToken).toBeDefined();
    expect(typeof res.body.debugResetToken).toBe('string');
  });

  it('rejects reset-password when token is missing or password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'some-token', newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);
  });

  it('rejects reset-password when token is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'invalid-nonexistent-token', newPassword: updatedPassword });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('successfully resets password with a valid token and allows login with new password', async () => {
    // 1. Request reset token
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: testEmail });

    const token = forgotRes.body.debugResetToken;
    expect(token).toBeDefined();

    // 2. Submit reset-password with valid token
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: updatedPassword });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.message).toMatch(/password has been reset successfully/i);

    // 3. Verify login with OLD password fails
    const oldLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: initialPassword });
    expect(oldLoginRes.status).toBe(401);

    // 4. Verify login with NEW password succeeds
    const newLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: updatedPassword });
    expect(newLoginRes.status).toBe(200);
    expect(newLoginRes.body.token).toBeDefined();
  });
});
