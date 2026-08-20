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
  SPEECH_PROVIDER: z.enum(['device', 'mock', 'google', 'azure']).default('device'),
  SPEECH_LANGUAGE: z.string().default('en-GB'),
  LLM_PROVIDER: z.enum(['mock', 'gemini', 'openai']).default('mock'),
  LLM_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-1.5-pro'),
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
