import { getStorageProvider } from '../providers/storage';
import { getEmailProvider } from '../providers/email';

export class DeliveryService {
  private storage = getStorageProvider();
  private email = getEmailProvider();

  async deliverSecureDocumentLink(
    recipientEmail: string,
    recipientName: string,
    documentKey: string,
    expiresInMinutes: number = 15
  ): Promise<string> {
    const signedUrl = await this.storage.getSignedUrl(documentKey, expiresInMinutes * 60);

    await this.email.sendSecureDocumentLink({
      to: recipientEmail,
      subject: 'Vabatim Secure Clinical Document Link',
      recipientName,
      secureDocumentUrl: signedUrl,
      expiresInMinutes
    });

    return signedUrl;
  }
}
