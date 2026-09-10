import { Worker, Job } from 'bullmq';
import { getBullMQRedisOptions } from '../config/redis';
import { queueManager, RecognitionHints } from './queueManager';
import { TemplateType, SessionFormat } from '../types';

export const QUEUE_NAME = 'vabatim-clinical-pipeline';

// Kept in sync with enqueueMeetingJob's payload in queueManager.ts. It used to only declare
// (and forward) meetingId/audioUri/clinicianName/clientRef, silently dropping templateType,
// sessionFormat and recognition even though the enqueue side always sent them — so a job that
// went through the queue produced different output (default template, default session format,
// no recognition hints) than the exact same call handled inline. Same input, same code path,
// different result depending on whether Redis happened to be available.
interface MeetingJobData {
  meetingId: string;
  audioUri: string;
  clinicianName: string;
  clientRef: string;
  templateType?: TemplateType;
  sessionFormat?: SessionFormat;
  recognition?: RecognitionHints;
}

console.log(`[BullMQ Worker]: Starting worker for queue "${QUEUE_NAME}"...`);

const connection = getBullMQRedisOptions();

export const worker = new Worker<MeetingJobData>(
  QUEUE_NAME,
  async (job: Job<MeetingJobData>) => {
    console.log(`[BullMQ Worker]: Processing job ${job.id} for meeting ${job.data.meetingId}...`);
    const result = await queueManager.processFullMeetingPipeline(
      job.data.meetingId,
      job.data.audioUri,
      job.data.clinicianName,
      job.data.clientRef,
      job.data.templateType,
      job.data.sessionFormat,
      job.data.recognition
    );
    console.log(`[BullMQ Worker]: Successfully completed job ${job.id} for meeting ${job.data.meetingId}`);
    return result;
  },
  {
    connection,
    concurrency: 2
  }
);

worker.on('completed', (job: Job) => {
  console.log(`[BullMQ Worker]: Job ${job.id} completed successfully.`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[BullMQ Worker]: Job ${job?.id} failed with error:`, err);
});

process.on('SIGTERM', async () => {
  console.log('[BullMQ Worker]: SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});
