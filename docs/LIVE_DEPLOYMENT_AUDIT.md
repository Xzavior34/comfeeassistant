# Vabatim Live Cloud Deployment Environment Variable Audit

This document audits all environment variables consumed across Vabatim remote deployment platforms (Vercel, Render API, Render Worker, Supabase, Upstash Redis, Google Gemini).

---

## 1. Exact Environment Variable Audit Table

| Variable Name | Consuming Platform / Service | Required / Optional | Sensitivity Level | Hosting Configuration Location |
| :--- | :--- | :---: | :---: | :--- |
| `NODE_ENV` | Render (API & Worker) | **REQUIRED** | Public | Render Dashboard (`production`) |
| `PORT` | Render (API) | **REQUIRED** | Public | Render Dashboard (`10000`) |
| `APP_BASE_URL` | Vercel / Render API | **REQUIRED** | Public | Vercel & Render (`https://vabatim-api.onrender.com`) |
| `DATABASE_URL` | Render (API & Worker) | **REQUIRED** | **SECRET** | Render Secret Environment Variables (Supabase PostgreSQL) |
| `JWT_SECRET` | Render (API) | **REQUIRED** | **SECRET** | Render Secret Environment Variables |
| `JWT_EXPIRES_IN` | Render (API) | Optional | Public | Render Dashboard (`24h`) |
| `SPEECH_PROVIDER` | Render API & Worker | **REQUIRED** | Public | Render Dashboard (`device`) |
| `SPEECH_LANGUAGE` | Render / Vercel | **REQUIRED** | Public | Render & Vercel Dashboards (`en-GB`) |
| `LLM_PROVIDER` | Render API & Worker | **REQUIRED** | Public | Render Dashboard (`gemini`) |
| `GEMINI_API_KEY` / `LLM_API_KEY` | Render API & Worker | **REQUIRED** | **SECRET** | Render Secret Environment Variables |
| `GEMINI_MODEL` | Render API & Worker | Optional | Public | Render Dashboard (`gemini-1.5-pro`) |
| `STORAGE_PROVIDER` | Render API & Worker | **REQUIRED** | Public | Render Dashboard (`supabase`) |
| `SUPABASE_URL` | Render / Vercel | **REQUIRED** | Public | Render & Vercel (`https://[REF].supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | Render API & Worker | **REQUIRED** | **SECRET** | Render Secret Environment Variables |
| `SUPABASE_ANON_KEY` | Vercel (Frontend) | Optional | Public | Vercel Dashboard |
| `SUPABASE_BUCKET_NAME` | Render API & Worker | **REQUIRED** | Public | Render Dashboard (`vabatim-clinical-storage`) |
| `REDIS_URL` | Render API & Worker | **REQUIRED** | **SECRET** | Render Secret Environment Variables (`rediss://...:6379`) |
| `UPSTASH_REDIS_REST_URL` | Render API & Worker | Optional | Public | Render Dashboard (`https://[HOST].upstash.io`) |
| `UPSTASH_REDIS_REST_TOKEN` | Render API & Worker | Optional | **SECRET** | Render Secret Environment Variables |

---

## 2. Server-Side Secret Isolation Verification

The following credentials **must remain strictly server-side** on Render and must **never** be exposed in client-side bundles or `NEXT_PUBLIC_*` variables on Vercel:
- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
- `REDIS_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `GEMINI_API_KEY` / `LLM_API_KEY`
- `JWT_SECRET`
