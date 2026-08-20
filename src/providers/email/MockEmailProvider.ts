import { EmailProvider, SendEmailOptions } from './EmailProvider';

export class MockEmailProvider implements EmailProvider {
  name = 'MockEmailProvider';

  async sendSecureDocumentLink(options: SendEmailOptions): Promise<void> {
    console.log(`[MockEmailProvider]: Secure delivery notification sent to ${options.to}`);
    console.log(`[Link]: ${options.secureDocumentUrl} (Expires in ${options.expiresInMinutes} minutes)`);
  }
}
