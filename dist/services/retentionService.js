"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetentionService = void 0;
const storage_1 = require("../providers/storage");
class RetentionService {
    storage = (0, storage_1.getStorageProvider)();
    async executeRetentionCleanup(meetingId, storageKeysToDelete) {
        let deletedCount = 0;
        for (const key of storageKeysToDelete) {
            try {
                await this.storage.delete(key);
                deletedCount++;
                console.log(`[RetentionService]: Deleted resource ${key} for meeting ${meetingId} per retention policy.`);
            }
            catch (err) {
                console.error(`[RetentionService]: Deletion failed for key ${key}`, err);
            }
        }
        return { deletedCount };
    }
}
exports.RetentionService = RetentionService;
