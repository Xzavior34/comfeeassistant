import { StorageProvider } from './StorageProvider';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/env';
import { createSignedLinkToken } from '../../services/signedLinks';

export class LocalStorageProvider implements StorageProvider {
  name = 'LocalStorageProvider';
  private storageDir: string;

  constructor() {
    this.storageDir = path.resolve(env.STORAGE_LOCAL_DIR);
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    const filePath = path.join(this.storageDir, key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, data);
    return `file://${filePath}`;
  }

  async retrieve(key: string): Promise<Buffer> {
    const filePath = path.join(this.storageDir, key.replace(/^file:\/\//, ''));
    if (!fs.existsSync(filePath)) {
      throw new Error(`[LocalStorageProvider] Object not found: ${key}`);
    }
    return fs.readFileSync(filePath);
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    // HMAC-signed: the old unsigned token could be minted by anyone for any document.
    const token = createSignedLinkToken(key, expiresInSeconds);
    return `${env.APP_BASE_URL}/api/documents/secure-access?token=${encodeURIComponent(token)}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.storageDir, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
