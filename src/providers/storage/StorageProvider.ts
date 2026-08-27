export interface StorageProvider {
  name: string;
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  /** Reads an object back. Required by speech providers that must submit the audio bytes. */
  retrieve(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
