# Vabatim UK Cloud Deployment Architecture Guide

This guide details the deployment of Vabatim to remote cloud infrastructure targeting UK healthcare regulations and NHS data sovereignty principles.

---

## 1. Cloud Architecture Overview

```
                         VABATIM CLOUD ARCHITECTURE
                                    │
             ┌──────────────────────┴──────────────────────┐
             │                                             │
        Vercel (Frontend)                             Render (Backend)
     Clinician Web Portal                          Node.js API + BullMQ Worker
    `vabatim.vercel.app`                       `vabatim-api.onrender.com`
             │                                             │
             └──────────────────────┬──────────────────────┘
                                    │
                         Supabase PostgreSQL (Database)
                       Region: eu-west-2 (London, UK)
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
       Supabase Storage                             Upstash Redis
   Encrypted Audio/Documents                     Queue State & Caching
              │
              │
       Google Cloud Speech v2 (`en-GB`)
       Multi-Speaker Diarization
              │
              ▼
       LLM Extraction Engine (Zod Validated)
              │
              ▼
       Grounding Validator (Evidence Verifier)
              │
              ▼
       Clinician Review & Cryptographic Sign-Off
              │
              ▼
       PDF & DOCX Report Generation
```

---

## 2. Step-by-Step Cloud Deployment

### Step 1: Provision Supabase Database & Storage (Region: London `eu-west-2`)
1. Create a Supabase Project in `eu-west-2` (London, UK).
2. Create Storage Bucket `vabatim-clinical-storage` with private, authenticated access controls.
3. Obtain `DATABASE_URL` (Direct Connection / Transaction Pooler), `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

### Step 2: Deploy Backend & Background Worker to Render
1. Connect GitHub repository to Render.
2. Render automatically detects `render.yaml` and provisions:
   - `vabatim-api` (Express Backend Web Service)
   - `vabatim-worker` (BullMQ Background Worker)
3. Set environment variables on Render dashboard:
   - `DATABASE_URL`
   - `STORAGE_PROVIDER=supabase`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SPEECH_PROVIDER=google`
   - `GOOGLE_APPLICATION_CREDENTIALS`
   - `JWT_SECRET`
   - `APP_BASE_URL=https://vabatim-api.onrender.com`

### Step 3: Run Database Migrations on Remote PostgreSQL
```bash
# Push Prisma schema to remote Supabase database
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" npx prisma db push
```

### Step 4: Deploy Clinician Web Portal to Vercel
1. Import GitHub repository into Vercel.
2. Select Next.js / Web framework.
3. Configure `vercel.json` rewrite routing `/api/:path*` → `https://vabatim-api.onrender.com/api/:path*`.

### Step 5: Mobile App Configuration
Update mobile API client `APP_BASE_URL` in `mobile/src/services/apiClient.ts`:
```typescript
export const API_BASE_URL = 'https://vabatim-api.onrender.com';
```

---

## 3. Governance & Regulatory Disclaimer

> [!IMPORTANT]
> **REQUIRES ORGANISATIONAL / LEGAL / DPO REVIEW**  
> Hosting database and storage resources in `eu-west-2` (London) supports UK GDPR data sovereignty requirements. However, deploying organisations must still execute formal Data Protection Impact Assessments (DPIA), execute data processing agreements, and verify NHS DCB0129 / DCB0160 clinical risk management compliance.
