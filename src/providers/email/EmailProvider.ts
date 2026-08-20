export interface SendEmailOptions {
  to: string;
  subject: string;
  recipientName: string;
  secureDocumentUrl: string;
  expiresInMinutes: number;
}

export interface EmailProvider {
  name: string;
  sendSecureDocumentLink(options: SendEmailOptions): Promise<void>;
}
