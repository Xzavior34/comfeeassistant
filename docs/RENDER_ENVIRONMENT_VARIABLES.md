# Vabatim Render Production Environment Variables

This document specifies every environment variable consumed by Vabatim Render Web Service and Worker background processes.

---

## 1. Environment Variable Reference Matrix

| Variable Name | Required? | Server Only? | Secret? | Purpose | Service Using It |
| :--- | :---: | :---: | :---: | :--- | :--- |
| `NODE_ENV` | **YES** | YES | NO | Deployment environment mode (`production`) | Render API & Worker |
| `PORT` | **YES** | YES | NO | Dynamic HTTP port binding (injected by Render, default `10000`) | Render API |
| `HOST` | Optional | YES | NO | Container IP host binding (`0.0.0.0`) | Render API |
| `APP_BASE_URL` | **YES** | NO | NO | Public base URL (`https://vabatim-api.onrender.com`) | Render API & Vercel |
| `DATABASE_URL` | **YES** | YES | **YES** | Connection string to Supabase PostgreSQL (`eu-west-2` London) | Render API & Worker |
| `JWT_SECRET` | **YES** | YES | **YES** | High-entropy cryptographic token signing secret | Render API |
| `JWT_EXPIRES_IN` | Optional | YES | NO | Auth token expiration duration (`24h`) | Render API |
| `SPEECH_PROVIDER` | **YES** | YES | NO | Active speech recognition mode (`device`) | Render API & Worker |
| `SPEECH_LANGUAGE` | **YES** | NO | NO | Recognition target language (`en-GB`) | Render API & Vercel |
| `LLM_PROVIDER` | **YES** | YES | NO | Active LLM provider (`gemini`) | Render API & Worker |
| `GEMINI_API_KEY` | **YES** | YES | **YES** | Google Gemini 1.5 API Key (`AIzaSy...`) | Render API & Worker |
| `GEMINI_MODEL` | Optional | YES | NO | Target Gemini model (`gemini-1.5-pro`) | Render API & Worker |
| `STORAGE_PROVIDER` | **YES** | YES | NO | Object storage adapter (`supabase`) | Render API & Worker |
| `SUPABASE_URL` | **YES** | NO | NO | Supabase project URL (`https://[REF].supabase.co`) | Render API & Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | **YES** | YES | **YES** | Private Supabase service role key for storage uploads | Render API & Worker |
| `SUPABASE_BUCKET_NAME` | **YES** | YES | NO | Private storage bucket name (`vabatim-clinical-storage`) | Render API & Worker |
| `REDIS_URL` | **YES** | YES | **YES** | Connection string for BullMQ queue manager (`rediss://...`) | Render API & Worker |
| `UPSTASH_REDIS_REST_URL` | Optional | YES | NO | Upstash REST API base URL | Render API & Worker |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | YES | **YES** | Upstash REST API token | Render API & Worker |

---

## 2. Server Secret Isolation Rules

- **Zero Secret Bundling**: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `UPSTASH_REDIS_REST_TOKEN`, `GEMINI_API_KEY`, and `JWT_SECRET` are strictly server-side variables.
- **Client Exclusions**: No server secret is prefixed with `NEXT_PUBLIC_` or exposed to client-side code.
