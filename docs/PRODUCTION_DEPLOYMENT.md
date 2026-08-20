# Vabatim Production Cloud Deployment Manual

This guide details the deployment of Vabatim across production cloud providers (Vercel, Render, Supabase, Upstash Redis, Google Gemini).

---

## 1. Cloud Service Account & Database Setup

### A. Supabase Setup (PostgreSQL Database & Storage)
1. Log into your Supabase Console.
2. Select your project located in region **`eu-west-2` (London, UK)**.
3. Retrieve:
   - `DATABASE_URL` (Connection string)
   - `SUPABASE_URL` (`https://[REF].supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
   - `SUPABASE_ANON_KEY`
4. Under **Storage**, create bucket **`vabatim-clinical-storage`**. Mark it **Private** with authenticated access rules.

### B. Upstash Redis Setup (BullMQ Queue & Cache)
1. Log into your Upstash Redis Console.
2. Retrieve:
   - `REDIS_URL` (`rediss://default:[PASSWORD]@[HOST].upstash.io:6379`)
   - `UPSTASH_REDIS_REST_URL` (`https://[HOST].upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN`

### C. Google Gemini API Setup (LLM Extraction Engine)
1. Log into Google AI Studio / GCP Console.
2. Generate an API Key with access to `gemini-1.5-pro` / `gemini-1.5-flash`.
3. Set `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-1.5-pro`.

---

## 2. Database Migrations Execution

Run Prisma database schema push against the remote Supabase database:
```bash
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" npx prisma db push
```

---

## 3. Render Backend & Worker Deployment

1. Connect your GitHub repository to Render.
2. Render detects `render.yaml` and provisions:
   - `vabatim-api` (Express Web Service)
   - `vabatim-worker` (BullMQ Background Worker)
3. Set secret environment variables on the Render dashboard:
   - `NODE_ENV=production`
   - `PORT=10000`
   - `APP_BASE_URL=https://vabatim-api.onrender.com`
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `SPEECH_PROVIDER=device`
   - `SPEECH_LANGUAGE=en-GB`
   - `LLM_PROVIDER=gemini`
   - `LLM_API_KEY`
   - `GEMINI_MODEL=gemini-1.5-pro`
   - `STORAGE_PROVIDER=supabase`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET_NAME=vabatim-clinical-storage`
   - `REDIS_URL`

---

## 4. Vercel Frontend Deployment

1. Import your GitHub repository into Vercel.
2. Set build framework to Next.js / React.
3. Set environment variables on Vercel dashboard:
   - `APP_BASE_URL=https://vabatim-api.onrender.com`
   - `SPEECH_PROVIDER=device`
   - `SPEECH_LANGUAGE=en-GB`
   - `SUPABASE_URL=https://[REF].supabase.co`
   - `SUPABASE_ANON_KEY`
4. Deploy frontend to `vabatim.vercel.app`.

---

## 5. Post-Deployment Verification & Health Checks

Verify backend health endpoints remotely:
```bash
curl https://vabatim-api.onrender.com/health
curl https://vabatim-api.onrender.com/health/database
curl https://vabatim-api.onrender.com/health/storage
curl https://vabatim-api.onrender.com/health/queue
curl https://vabatim-api.onrender.com/health/speech-provider
curl https://vabatim-api.onrender.com/health/llm-provider
```

All health endpoints must return status **`CONNECTED`** or **`HEALTHY`**.

---

## 6. Rollback & Troubleshooting Procedures
- **Database Rollback**: Use `npx prisma migrate resolve` or restore from Supabase point-in-time backup.
- **Backend Service Rollback**: Select previous successful deploy commit on Render dashboard and click **Rollback**.
- **Frontend Rollback**: Select previous successful deployment on Vercel dashboard and click **Promote to Production**.
