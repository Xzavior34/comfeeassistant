import { StorageProvider } from './StorageProvider';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

export class SupabaseStorageProvider implements StorageProvider {
  name = 'SupabaseStorageProvider';
  private supabase: SupabaseClient | null = null;
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.SUPABASE_BUCKET_NAME || 'vabatim-clinical-storage';
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey) {
      this.supabase = createClient(supabaseUrl, serviceRoleKey);
    }
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    if (!this.supabase) {
      throw new Error('Supabase storage not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.');
    }

    const { data: result, error } = await this.supabase.storage
      .from(this.bucketName)
      .upload(key, data, { contentType, upsert: true });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    return `supabase://${this.bucketName}/${result.path}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.supabase) {
      const baseUrl = env.APP_BASE_URL;
      const token = Buffer.from(`${key}:${Date.now() + expiresInSeconds * 1000}`).toString('base64url');
      return `${baseUrl}/api/documents/secure-access?token=${token}&key=${encodeURIComponent(key)}`;
    }

    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .createSignedUrl(key, expiresInSeconds);

    if (error || !data) {
      throw new Error(`Supabase signed URL generation failed: ${error?.message}`);
    }

    return data.signedUrl;
  }

  async delete(key: string): Promise<void> {
    if (!this.supabase) return;

    const { error } = await this.supabase.storage
      .from(this.bucketName)
      .remove([key]);

    if (error) {
      console.error(`Supabase deletion error for key ${key}: ${error.message}`);
    }
  }
}
