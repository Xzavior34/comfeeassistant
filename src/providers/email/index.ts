import { EmailProvider } from './EmailProvider';
import { MockEmailProvider } from './MockEmailProvider';
import { env } from '../../config/env';

/**
 * Email delivery.
 *
 * The mock provider demonstrates the workflow without pretending anything was delivered.
 * `isEmailDeliveryConfigured()` exists so the UI and the API can tell the clinician the
 * truth — "email delivery is not configured here" — rather than showing "Email sent" for a
 * message that was written to a log line and discarded.
 *
 * Real adapters slot in here when an email service is chosen; none is required for the MVP.
 */
export function getEmailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'smtp':
    case 'resend':
      // No credentials-bearing adapter is bundled. Falling through to the mock keeps the
      // workflow intact and keeps the honest "not configured" signal below accurate.
      console.warn(
        `[email] EMAIL_PROVIDER=${env.EMAIL_PROVIDER} but no delivery adapter is installed; ` +
          'using the mock provider. No email will be sent.'
      );
      return new MockEmailProvider();
    default:
      return new MockEmailProvider();
  }
}

/** True only when mail will genuinely leave the server. */
export function isEmailDeliveryConfigured(): boolean {
  if (env.EMAIL_PROVIDER === 'mock') return false;
  if (env.EMAIL_PROVIDER === 'smtp') return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
  if (env.EMAIL_PROVIDER === 'resend') return Boolean(process.env.RESEND_API_KEY);
  return false;
}
