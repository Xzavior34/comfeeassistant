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
  // 'device' captures in the browser and cannot diarise. Use 'google' or 'azure' for
  // speaker-differentiated transcription with clinical speech adaptation.
  SPEECH_PROVIDER: z.enum(['device', 'mock', 'google', 'azure']).default('device'),
  GOOGLE_SPEECH_API_KEY: z.string().optional(),
  GOOGLE_ACCESS_TOKEN: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),
  SPEECH_LANGUAGE: z.string().default('en-GB'),
  LLM_PROVIDER: z.enum(['mock', 'gemini', 'openai']).default('mock'),
  LLM_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
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
    console.warn(
      '[config] SPEECH_PROVIDER=device: recognition runs in the clinician browser, which ' +
        'cannot separate speakers or bias toward clinical vocabulary. Statements will be ' +
        'recorded as unattributed. Set google or azure for diarised clinical transcription.'
    );
  }
}

