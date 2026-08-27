import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler';
import { env } from './config/env';
import { prisma } from './db';
import { isEmailDeliveryConfigured } from './providers/email';
import { buildCorsOptions, rejectDisallowedOrigin, buildAllowedOrigins } from './config/cors';

import { getSpeechProvider } from './providers/speech';
import { getStorageProvider } from './providers/storage';
import { getLLMProvider } from './providers/llm';

import authRoutes from './routes/auth';
import meetingRoutes from './routes/meetings';
import consentRoutes from './routes/consent';
import recordingRoutes from './routes/recordings';
import transcriptRoutes from './routes/transcripts';
import reviewRoutes from './routes/reviews';
import documentRoutes from './routes/documents';
import auditRoutes from './routes/audit';
import metricsRoutes from './routes/metrics';

const app = express();

// Security & CORS Middleware
app.use(helmet());

app.use(cors(buildCorsOptions()));
app.use(rejectDisallowedOrigin());

console.log(`[cors] Allowed origins: ${buildAllowedOrigins().join(', ')}`);

// Ordinary API traffic is small; a tight limit here is a cheap denial-of-service control.
// The recording upload is the one exception and raises its own limit below, rather than
// every endpoint accepting multi-megabyte bodies.
app.use(express.json({ limit: '256kb' }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Optional audio upload is raw binary, not base64 inside JSON. Binary avoids the ~33%
// inflation base64 costs, keeps the whole consultation out of a single JavaScript string,
// and means the rest of the API keeps its tight 256 KB JSON limit.
app.use(
  '/api/recordings',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' })
);

// Root Operational Route
app.get('/', (req, res) => {
  res.json({
    name: 'Vabatim API Service',
    description: 'AI-Powered Accessibility & Wheelchair Documentation Assistant API for UK Clinicians',
    status: 'ONLINE',
    frontend: 'https://comfeeassistant.vercel.app',
    health: '/health'
  });
});

/**
 * Health endpoints.
 *
 * These report what is CONFIGURED and, where it is cheap and safe to check, what is
 * VERIFIED. The previous versions returned "CONNECTED" for the database and the queue
 * without contacting either — a health check that cannot fail tells you nothing, and during
 * the recent outage it reported a healthy system while every request was failing.
 *
 * No secret, connection string or patient information appears in any response.
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'Vabatim API',
    mode: {
      // The operating shape of this deployment, at a glance.
      speech: env.SPEECH_PROVIDER,
      diarization: env.DIARIZATION_PROVIDER,
      processing: env.PROCESSING_MODE,
      llm: env.LLM_PROVIDER,
      storage: env.STORAGE_PROVIDER,
      emailDelivery: isEmailDeliveryConfigured() ? 'configured' : 'not configured'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/health/database', async (req, res) => {
  try {
    // An actual round trip. Anything less is a guess.
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'VERIFIED', component: 'database' });
  } catch (err: any) {
    res.status(503).json({
      status: 'UNREACHABLE',
      component: 'database',
      // Message only; never the connection string.
      detail: String(err?.message ?? err).slice(0, 200)
    });
  }
});

app.get('/health/storage', async (req, res) => {
  const storage = getStorageProvider();
  const configured =
    env.STORAGE_PROVIDER !== 'supabase' ||
    Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  res.json({
    status: configured ? 'CONFIGURED' : 'NOT CONFIGURED',
    providerName: storage.name,
    note: 'Configuration only; no object was read or written to verify access.'
  });
});

app.get('/health/processing', async (req, res) => {
  res.json({
    status: 'CONFIGURED',
    mode: env.PROCESSING_MODE,
    note:
      env.PROCESSING_MODE === 'inline'
        ? 'Documentation is generated in the web service; job state is persisted in the database.'
        : 'Documentation is handed to a queue for a dedicated worker.'
  });
});

app.get('/health/speech-provider', async (req, res) => {
  if (env.SPEECH_PROVIDER === 'device') {
    return res.json({
      status: 'CONFIGURED',
      providerName: 'DeviceSpeechProvider',
      details:
        'Transcription runs in the clinician browser. The server receives text only and ' +
        'performs no speaker separation.'
    });
  }
  const health = await getSpeechProvider().checkHealth();
  res.json(health);
});

app.get('/health/llm-provider', async (req, res) => {
  try {
    const health = await getLLMProvider().checkHealth();
    res.json(health);
  } catch (err: any) {
    res.status(503).json({ status: 'CONNECTION FAILED', detail: String(err?.message ?? err).slice(0, 200) });
  }
});

app.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'READY' });
  } catch {
    res.status(503).json({ status: 'NOT READY', reason: 'database unreachable' });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/transcripts', transcriptRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/metrics', metricsRoutes);

// Centralized Error Handling
app.use(errorHandler);

export default app;
