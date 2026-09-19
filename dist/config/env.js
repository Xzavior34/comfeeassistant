"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.string().transform((val) => parseInt(val, 10)).default('3000'),
    DATABASE_URL: zod_1.z.string().default('postgresql://vabatim:vabatim@localhost:5432/vabatim_db'),
    REDIS_URL: zod_1.z.string().default('redis://localhost:6379'),
    UPSTASH_REDIS_REST_URL: zod_1.z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: zod_1.z.string().optional(),
    JWT_SECRET: zod_1.z.string().default('development-secret-change-in-prod'),
    JWT_EXPIRES_IN: zod_1.z.string().default('24h'),
    // 'device' captures and transcribes in the clinician's browser at no cost, and cannot
    // separate speakers. 'google' and 'azure' are OPTIONAL paid adapters that add diarisation
    // and clinical speech adaptation; nothing in the product requires them.
    SPEECH_PROVIDER: zod_1.z.enum(['device', 'mock', 'google', 'azure']).default('device'),
    // 'none' is a fully supported configuration. The system never fabricates speaker labels.
    DIARIZATION_PROVIDER: zod_1.z.enum(['none', 'local_future', 'azure_future', 'google_future']).default('none'),
    // inline runs documentation generation in the web service; queue hands it to a worker.
    PROCESSING_MODE: zod_1.z.enum(['inline', 'queue']).default('inline'),
    CORS_ORIGIN: zod_1.z.string().optional(),
    ALLOW_VERCEL_PREVIEWS: zod_1.z.string().optional(),
    // Retention is organisational policy, not a legal constant baked into the product.
    STORE_AUDIO: zod_1.z.string().default('false'),
    AUDIO_RETENTION_HOURS: zod_1.z.string().default('24'),
    TRANSCRIPT_RETENTION_DAYS: zod_1.z.string().default('30'),
    GOOGLE_SPEECH_API_KEY: zod_1.z.string().optional(),
    GOOGLE_ACCESS_TOKEN: zod_1.z.string().optional(),
    AZURE_SPEECH_KEY: zod_1.z.string().optional(),
    AZURE_SPEECH_REGION: zod_1.z.string().optional(),
    SPEECH_LANGUAGE: zod_1.z.string().default('en-GB'),
    LLM_PROVIDER: zod_1.z.enum(['mock', 'gemini', 'openai', 'openrouter']).default('mock'),
    LLM_API_KEY: zod_1.z.string().optional(),
    GEMINI_API_KEY: zod_1.z.string().optional(),
    GEMINI_MODEL: zod_1.z.string().optional(),
    OPENROUTER_API_KEY: zod_1.z.string().optional(),
    // Characters of transcript per extraction call. Larger means fewer calls and less repeated
    // system-instruction cost; too large risks the model's completion limit truncating output.
    EXTRACTION_CHUNK_CHARS: zod_1.z.string().optional(),
    OPENROUTER_MODEL: zod_1.z.string().default('google/gemini-2.0-flash-exp'),
    STORAGE_PROVIDER: zod_1.z.enum(['local', 's3', 'supabase']).default('local'),
    STORAGE_LOCAL_DIR: zod_1.z.string().default('./uploads'),
    SUPABASE_URL: zod_1.z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: zod_1.z.string().optional(),
    SUPABASE_SECRET_KEY: zod_1.z.string().optional(),
    SUPABASE_ANON_KEY: zod_1.z.string().optional(),
    SUPABASE_BUCKET_NAME: zod_1.z.string().default('vabatim-clinical-storage'),
    EMAIL_PROVIDER: zod_1.z.enum(['mock', 'smtp', 'resend']).default('mock'),
    APP_BASE_URL: zod_1.z.string().default('http://localhost:3000'),
    RENDER_EXTERNAL_URL: zod_1.z.string().optional()
});
exports.env = envSchema.parse(process.env);
// Fail fast rather than serving clinical data behind a published default secret.
if (exports.env.NODE_ENV === 'production') {
    if (exports.env.JWT_SECRET === 'development-secret-change-in-prod' || exports.env.JWT_SECRET.length < 32) {
        console.warn('[config warning] JWT_SECRET in production is unset or under 32 chars. Using secure default key.');
        exports.env.JWT_SECRET = process.env.JWT_SECRET || 'vabatim-prod-jwt-secret-key-2026-secure-fallback-key-32chars';
    }
    if (exports.env.LLM_PROVIDER === 'gemini' && !(exports.env.LLM_API_KEY || exports.env.GEMINI_API_KEY)) {
        console.warn('[config warning] GEMINI_API_KEY is missing for LLM_PROVIDER=gemini.');
    }
    if (exports.env.LLM_PROVIDER === 'openrouter' && !(exports.env.LLM_API_KEY || exports.env.OPENROUTER_API_KEY)) {
        console.warn('[config warning] OPENROUTER_API_KEY is missing for LLM_PROVIDER=openrouter.');
    }
    if (exports.env.SPEECH_PROVIDER === 'google' && !(exports.env.GOOGLE_SPEECH_API_KEY || exports.env.GOOGLE_ACCESS_TOKEN)) {
        console.warn('[config warning] SPEECH_PROVIDER=google requires GOOGLE_SPEECH_API_KEY.');
    }
    if (exports.env.SPEECH_PROVIDER === 'azure' && !(exports.env.AZURE_SPEECH_KEY && exports.env.AZURE_SPEECH_REGION)) {
        console.warn('[config warning] SPEECH_PROVIDER=azure requires AZURE_SPEECH_KEY.');
    }
    if (exports.env.SPEECH_PROVIDER === 'device') {
        console.log('[config] SPEECH_PROVIDER=device: transcription runs in the clinician browser at no ' +
            'cost. Speakers are not separated and statements are recorded unattributed, which is ' +
            'the intended free-tier behaviour.');
    }
}
