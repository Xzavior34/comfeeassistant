# Vabatim Final Production Environment Variable Inventory

This document provides a complete inventory of every environment variable used across Vabatim production hosting platforms (Render, Vercel, Supabase, Upstash).

---

## 1. Complete Environment Variable Inventory

| Variable Name | Target Service | Required / Optional | Sensitivity | Where Configured | Description & Default Value |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `NODE_ENV` | Render (Backend & Worker) | **REQUIRED** | Public | Render Dashboard | Set to `production` |
| `PORT` | Render (Backend) | **REQUIRED** | Public | Render Dashboard | Port binding (default: `10000`) |
| `APP_BASE_URL` | Render / Vercel | **REQUIRED** | Public | Render & Vercel Dashboards | Production API URL (`https://vabatim-api.onrender.com`) |
| `DATABASE_URL` | Render (Backend & Worker) | **REQUIRED** | **SECRET** | Render Environment Secrets | Connection string to Supabase PostgreSQL (`eu-west-2` London) |
| `JWT_SECRET` | Render (Backend) | **REQUIRED** | **SECRET** | Render Environment Secrets | High-entropy cryptographic key for signing user auth tokens |
| `JWT_EXPIRES_IN` | Render (Backend) | Optional | Public | Render Dashboard | Token expiration duration (default: `24h`) |
| `SPEECH_PROVIDER` | Render (Backend & Worker) | **REQUIRED** | Public | Render Dashboard | Set to `device` for Option A Device/Browser Speech |
| `SPEECH_LANGUAGE` | Render / Frontend | **REQUIRED** | Public | Render & Vercel Dashboards | Set to `en-GB` for UK English recognition |
| `LLM_PROVIDER` | Render (Backend & Worker) | **REQUIRED** | Public | Render Dashboard | Set to `gemini` for Google Gemini 1.5 API extractions |
| `LLM_API_KEY` / `GEMINI_API_KEY` | Render (Backend & Worker) | **REQUIRED** | **SECRET** | Render Environment Secrets | Google Gemini 1.5 API Key (`AIzaSy...`) |
| `GEMINI_MODEL` | Render (Backend & Worker) | Optional | Public | Render Dashboard | Target Gemini Model (default: `gemini-1.5-pro`) |
| `STORAGE_PROVIDER` | Render (Backend & Worker) | **REQUIRED** | Public | Render Dashboard | Set to `supabase` for Supabase Storage |
| `SUPABASE_URL` | Render / Vercel | **REQUIRED** | Public | Render & Vercel Dashboards | Supabase Project URL (`https://[REF].supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | Render (Backend & Worker) | **REQUIRED** | **SECRET** | Render Environment Secrets | Service Role / Secret Key (`sb_secret_...`) for backend storage operations |
| `SUPABASE_ANON_KEY` | Vercel (Frontend) | Optional | Public | Vercel Dashboard | Public Anon Key (`eyJhbGci...`) for client-side Auth |
| `SUPABASE_BUCKET_NAME` | Render (Backend & Worker) | **REQUIRED** | Public | Render Dashboard | Private Storage Bucket Name (`vabatim-clinical-storage`) |
| `REDIS_URL` | Render (Backend & Worker) | **REQUIRED** | **SECRET** | Render Environment Secrets | Upstash Redis `rediss://` endpoint URL for BullMQ queue manager |
| `UPSTASH_REDIS_REST_URL` | Render (Backend & Worker) | Optional | Public | Render Dashboard | Upstash REST URL (`https://famous-vervet-170320.upstash.io`) |
| `UPSTASH_REDIS_REST_TOKEN` | Render (Backend & Worker) | Optional | **SECRET** | Render Environment Secrets | Upstash REST Token (`gQAAAA...`) |
| `EMAIL_PROVIDER` | Render (Backend & Worker) | Optional | Public | Render Dashboard | Email provider (`mock` or `resend`) |

---

## 2. Removed Obsolete Variables

The following legacy speech and cloud storage variables have been **removed** from runtime requirement schemas:
- `GOOGLE_APPLICATION_CREDENTIALS` (Speech engine runs in `device` mode via W3C browser API)
- `GOOGLE_CLOUD_PROJECT_ID`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`

---

## 3. Platform Distribution Summary

### Vercel (Web Frontend):
- `APP_BASE_URL` (`https://vabatim-api.onrender.com`)
- `SPEECH_PROVIDER` (`device`)
- `SPEECH_LANGUAGE` (`en-GB`)
- `SUPABASE_URL` (`https://ngtbwxkfudsmaiwfbaiy.supabase.co`)
- `SUPABASE_ANON_KEY`

### Render (Backend API & Worker):
- `NODE_ENV` (`production`)
- `PORT` (`10000`)
- `APP_BASE_URL` (`https://vabatim-api.onrender.com`)
- `DATABASE_URL`
- `JWT_SECRET`
- `SPEECH_PROVIDER` (`device`)
- `SPEECH_LANGUAGE` (`en-GB`)
- `LLM_PROVIDER` (`gemini`)
- `LLM_API_KEY` / `GEMINI_API_KEY`
- `GEMINI_MODEL` (`gemini-1.5-pro`)
- `STORAGE_PROVIDER` (`supabase`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
- `SUPABASE_BUCKET_NAME` (`vabatim-clinical-storage`)
- `REDIS_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
