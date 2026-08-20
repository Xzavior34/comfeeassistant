import { StorageProvider } from './StorageProvider';
import { LocalStorageProvider } from './LocalStorageProvider';
import { SupabaseStorageProvider } from './SupabaseStorageProvider';
import { env } from '../../config/env';

export function getStorageProvider(): StorageProvider {
  if (env.STORAGE_PROVIDER === 'supabase') {
    return new SupabaseStorageProvider();
  }
  return new LocalStorageProvider();
}
