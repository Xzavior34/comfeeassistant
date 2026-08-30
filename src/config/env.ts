import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('3000'),
  DATABASE_URL: z.string().default('postgresql://vabatim:vabatim@localhost:5432/vabatim_db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  JWT_SECRET: z.string().default('development-secret-change-in-prod'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  // 'device' captures and transcribes in the clinician's browser at no cost, and cannot
  // separate speakers. 'google' and 'azure' are OPTIONAL paid adapters that add diarisation
  // and clinical speech adaptation; nothing in the product requires them.
  SPEECH_PROVIDER: z.enum(['device', 'mock', 'google', 'azure']).default('device'),
  // 'none' is a fully supported configuration. The system never fabricates speaker labels.
  DIARIZATION_PROVIDER: z.enum(['none', 'local_future', 'azure_future', 'google_future']).default('none'),
  // inline runs documentation generation in the web service; queue hands it to a worker.
  PROCESSING_MODE: z.enum(['inline', 'queue']).default('inline'),
  CORS_ORIGIN: z.string().optional(),
  ALLOW_VERCEL_PREVIEWS: z.string().optional(),
  // Retention is organisational policy, not a legal constant baked into the product.
  STORE_AUDIO: z.string().default('false'),
  AUDIO_RETENTION_HOURS: z.string().default('24'),
  TRANSCRIPT_RETENTION_DAYS: z.string().default('30'),
  GOOGLE_SPEECH_API_KEY: z.string().optional(),
  GOOGLE_ACCESS_TOKEN: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),
  SPEECH_LANGUAGE: z.string().default('en-GB'),
  LLM_PROVIDER: z.enum(['mock', 'gemini', 'openai', 'openrouter']).default('mock'),
  LLM_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('google/gemini-2.0-flash-exp'),
  STORAGE_PROVIDER: z.enum(['local', 's3', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_BUCKET_NAME: z.string().default('vabatim-clinical-storage'),
  EMAIL_PROVIDER: z.enum(['mock', 'smtp', 'resend']).default('mock'),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  RENDER_EXTERNAL_URL: z.string().optional()
});

export const env = envSchema.parse(process.env);

// Fail fast rather than serving clinical data behind a published default secret.
if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET === 'development-secret-change-in-prod' || env.JWT_SECRET.length < 32) {
    throw new Error(
      'CRITICAL CONFIGURATION ERROR: JWT_SECRET must be set to a unique value of at least ' +
        '32 characters in production.'
    );
  }
  if (env.LLM_PROVIDER === 'gemini' && !(env.LLM_API_KEY || env.GEMINI_API_KEY)) {
    throw new Error('CRITICAL CONFIGURATION ERROR: LLM_PROVIDER=gemini requires GEMINI_API_KEY.');
  }
  if (env.LLM_PROVIDER === 'openrouter' && !(env.LLM_API_KEY || env.OPENROUTER_API_KEY)) {
    throw new Error('CRITICAL CONFIGURATION ERROR: LLM_PROVIDER=openrouter requires OPENROUTER_API_KEY.');
  }
  if (env.SPEECH_PROVIDER === 'google' && !(env.GOOGLE_SPEECH_API_KEY || env.GOOGLE_ACCESS_TOKEN)) {
    throw new Error(
      'CRITICAL CONFIGURATION ERROR: SPEECH_PROVIDER=google requires GOOGLE_SPEECH_API_KEY or GOOGLE_ACCESS_TOKEN.'
    );
  }
  if (env.SPEECH_PROVIDER === 'azure' && !(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION)) {
    throw new Error(
      'CRITICAL CONFIGURATION ERROR: SPEECH_PROVIDER=azure requires AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.'
    );
  }
  if (env.SPEECH_PROVIDER === 'device') {
    console.log(
      '[config] SPEECH_PROVIDER=device: transcription runs in the clinician browser at no ' +
        'cost. Speakers are not separated and statements are recorded unattributed, which is ' +
        'the intended free-tier behaviour.'
    );
  }
}

