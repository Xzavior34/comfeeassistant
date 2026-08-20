import { getStorageProvider } from '../providers/storage';
import { MeetingState } from '@prisma/client';

export interface RetentionPolicyConfig {
  rawAudioRetentionDays: number;
  draftNoteRetentionDays: number;
  approvedNoteRetentionYears: number;
}

export class RetentionService {
  private storage = getStorageProvider();

  async executeRetentionCleanup(meetingId: string, storageKeysToDelete: string[]): Promise<{ deletedCount: number }> {
    let deletedCount = 0;
    for (const key of storageKeysToDelete) {
      try {
        await this.storage.delete(key);
        deletedCount++;
        console.log(`[RetentionService]: Deleted resource ${key} for meeting ${meetingId} per retention policy.`);
      } catch (err) {
        console.error(`[RetentionService]: Deletion failed for key ${key}`, err);
      }
    }
    return { deletedCount };
  }
}
