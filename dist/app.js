"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const errorHandler_1 = require("./middleware/errorHandler");
const env_1 = require("./config/env");
const db_1 = require("./db");
const email_1 = require("./providers/email");
const cors_2 = require("./config/cors");
const speech_1 = require("./providers/speech");
const storage_1 = require("./providers/storage");
const llm_1 = require("./providers/llm");
const auth_1 = __importDefault(require("./routes/auth"));
const meetings_1 = __importDefault(require("./routes/meetings"));
const consent_1 = __importDefault(require("./routes/consent"));
const recordings_1 = __importDefault(require("./routes/recordings"));
const transcripts_1 = __importDefault(require("./routes/transcripts"));
const reviews_1 = __importDefault(require("./routes/reviews"));
const documents_1 = __importDefault(require("./routes/documents"));
const audit_1 = __importDefault(require("./routes/audit"));
const metrics_1 = __importDefault(require("./routes/metrics"));
const app = (0, express_1.default)();
// Security & CORS Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)((0, cors_2.buildCorsOptions)()));
app.use((0, cors_2.rejectDisallowedOrigin)());
console.log(`[cors] Allowed origins: ${(0, cors_2.buildAllowedOrigins)().join(', ')}`);
// Ordinary API traffic is small; a tight limit here is a cheap denial-of-service control.
// The recording upload is the one exception and raises its own limit below, rather than
// every endpoint accepting multi-megabyte bodies.
app.use(express_1.default.json({ limit: '256kb' }));
// Rate Limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});
app.use(limiter);
// Optional audio upload is raw binary, not base64 inside JSON. Binary avoids the ~33%
// inflation base64 costs, keeps the whole consultation out of a single JavaScript string,
// and means the rest of the API keeps its tight 256 KB JSON limit.
app.use('/api/recordings', express_1.default.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }));
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
            speech: env_1.env.SPEECH_PROVIDER,
            diarization: env_1.env.DIARIZATION_PROVIDER,
            processing: env_1.env.PROCESSING_MODE,
            llm: env_1.env.LLM_PROVIDER,
            storage: env_1.env.STORAGE_PROVIDER,
            emailDelivery: (0, email_1.isEmailDeliveryConfigured)() ? 'configured' : 'not configured'
        },
        timestamp: new Date().toISOString()
    });
});
app.get('/health/database', async (req, res) => {
    try {
        // An actual round trip. Anything less is a guess.
        await db_1.prisma.$queryRaw `SELECT 1`;
        res.json({ status: 'VERIFIED', component: 'database' });
    }
    catch (err) {
        res.status(503).json({
            status: 'UNREACHABLE',
            component: 'database',
            // Message only; never the connection string.
            detail: String(err?.message ?? err).slice(0, 200)
        });
    }
});
app.get('/health/storage', async (req, res) => {
    const storage = (0, storage_1.getStorageProvider)();
    const configured = env_1.env.STORAGE_PROVIDER !== 'supabase' ||
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
        mode: env_1.env.PROCESSING_MODE,
        note: env_1.env.PROCESSING_MODE === 'inline'
            ? 'Documentation is generated in the web service; job state is persisted in the database.'
            : 'Documentation is handed to a queue for a dedicated worker.'
    });
});
app.get('/health/speech-provider', async (req, res) => {
    if (env_1.env.SPEECH_PROVIDER === 'device') {
        return res.json({
            status: 'CONFIGURED',
            providerName: 'DeviceSpeechProvider',
            details: 'Transcription runs in the clinician browser. The server receives text only and ' +
                'performs no speaker separation.'
        });
    }
    const health = await (0, speech_1.getSpeechProvider)().checkHealth();
    res.json(health);
});
app.get('/health/llm-provider', async (req, res) => {
    try {
        const health = await (0, llm_1.getLLMProvider)().checkHealth();
        res.json(health);
    }
    catch (err) {
        res.status(503).json({ status: 'CONNECTION FAILED', detail: String(err?.message ?? err).slice(0, 200) });
    }
});
app.get('/ready', async (req, res) => {
    try {
        await db_1.prisma.$queryRaw `SELECT 1`;
        res.json({ status: 'READY' });
    }
    catch {
        res.status(503).json({ status: 'NOT READY', reason: 'database unreachable' });
    }
});
// API Routes
app.use('/api/auth', auth_1.default);
app.use('/api/meetings', meetings_1.default);
app.use('/api/consent', consent_1.default);
app.use('/api/recordings', recordings_1.default);
app.use('/api/transcripts', transcripts_1.default);
app.use('/api/reviews', reviews_1.default);
app.use('/api/documents', documents_1.default);
app.use('/api/audit', audit_1.default);
app.use('/api/metrics', metrics_1.default);
// Centralized Error Handling
app.use(errorHandler_1.errorHandler);
exports.default = app;
