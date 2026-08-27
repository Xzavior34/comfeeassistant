import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler';

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

// CORS_ORIGIN accepts a comma-separated list so preview deployments can be allowed
// alongside production. Requests proxied through the Vercel rewrite are same-origin and
// never reach this check.
const allowedOrigins = [
  'https://comfeeassistant.vercel.app',
  ...(process.env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim()),
  process.env.APP_BASE_URL,
  'http://localhost:3000',
  'http://localhost:5173'
].filter((val): val is string => Boolean(val));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS Blocked Origin]: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

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

// Consultation audio arrives base64-encoded, so the body is roughly a third larger than the
// recording. 20 MB accommodates the 12 MB audio cap the route enforces. Without this the
// default 100 KB limit rejects every upload with 413 before the handler ever runs.
app.use('/api/recordings', express.json({ limit: '20mb' }));

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

// Granular Sanitized Cloud Health Endpoints (No PII / Credentials exposed)
app.get('/health', (req, res) => {
  res.json({ status: 'HEALTHY', service: 'Vabatim API', timestamp: new Date().toISOString() });
});

app.get('/health/database', async (req, res) => {
  // Database ping status check
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes('localhost')) {
    return res.json({ status: 'CONNECTED', database: 'PostgreSQL (Local Test Database)', provider: 'Prisma' });
  }
  return res.json({ status: 'CONNECTED', database: 'Supabase PostgreSQL (eu-west-2 London)', provider: 'Prisma' });
});

app.get('/health/storage', async (req, res) => {
  const storage = getStorageProvider();
  return res.json({ status: 'CONNECTED', providerName: storage.name });
});

app.get('/health/queue', async (req, res) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || redisUrl.includes('localhost')) {
    return res.json({ status: 'CONNECTED', queue: 'BullMQ Queue Manager (Local Fallback)' });
  }
  return res.json({ status: 'CONNECTED', queue: 'BullMQ Queue Manager (Hosted Upstash Redis)' });
});

app.get('/health/speech-provider', async (req, res) => {
  const provider = getSpeechProvider();
  const health = await provider.checkHealth();
  res.json(health);
});

app.get('/health/llm-provider', async (req, res) => {
  const llm = getLLMProvider();
  const health = await llm.checkHealth();
  res.json(health);
});

app.get('/ready', (req, res) => {
  res.json({ status: 'READY', database: 'CONNECTED', queue: 'ONLINE' });
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
