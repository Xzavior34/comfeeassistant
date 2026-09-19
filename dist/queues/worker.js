"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.worker = exports.QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const queueManager_1 = require("./queueManager");
exports.QUEUE_NAME = 'vabatim-clinical-pipeline';
console.log(`[BullMQ Worker]: Starting worker for queue "${exports.QUEUE_NAME}"...`);
const connection = (0, redis_1.getBullMQRedisOptions)();
exports.worker = new bullmq_1.Worker(exports.QUEUE_NAME, async (job) => {
    console.log(`[BullMQ Worker]: Processing job ${job.id} for meeting ${job.data.meetingId}...`);
    const result = await queueManager_1.queueManager.processFullMeetingPipeline(job.data.meetingId, job.data.audioUri, job.data.clinicianName, job.data.clientRef, job.data.templateType, job.data.sessionFormat, job.data.recognition);
    console.log(`[BullMQ Worker]: Successfully completed job ${job.id} for meeting ${job.data.meetingId}`);
    return result;
}, {
    connection,
    concurrency: 2
});
exports.worker.on('completed', (job) => {
    console.log(`[BullMQ Worker]: Job ${job.id} completed successfully.`);
});
exports.worker.on('failed', (job, err) => {
    console.error(`[BullMQ Worker]: Job ${job?.id} failed with error:`, err);
});
process.on('SIGTERM', async () => {
    console.log('[BullMQ Worker]: SIGTERM received, closing worker...');
    await exports.worker.close();
    process.exit(0);
});
