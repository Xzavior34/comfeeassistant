# Vabatim Infrastructure Cost & Tier Limit Analysis

This document provides a realistic itemized analysis of cloud infrastructure free tiers, usage quotas, rate limits, and paid service transitions for Vabatim.

---

## 1. Cloud Service Tier & Usage Quota Summary

| Service Component | Cloud Provider | Free Tier Allowance / Quota | Rate Limits & Auto-Sleep Behaviors | Cost After Free Allowance |
| :--- | :--- | :--- | :--- | :--- |
| **Web Frontend / Portal** | **Vercel** | Free Hobby Tier: 100 GB bandwidth/month, 6,000 build minutes/month | Max 100 requests/min; Serverless execution limit 10s | $20/month Pro tier |
| **Backend API & Worker** | **Render** | Free Tier: 512 MB RAM, 0.1 CPU, 750 free instance hours/month | Auto-sleeps after 15 mins of inactivity (15–30s cold start penalty) | $7/month Starter Web Service + $7/month Worker |
| **PostgreSQL Database** | **Supabase** | Free Tier: 500 MB database storage, 2 active projects | Max 60 direct connections; Project pauses after 1 week inactivity | $25/month Pro tier |
| **Object Storage (Audio/Docs)** | **Supabase Storage** | Free Tier: 1 GB file storage, 2 GB egress/month | Max file size 50 MB (suitable for compressed audio) | $0.021/GB extra storage |
| **Queue & Cache (BullMQ)** | **Upstash Redis** | Free Tier: 10,000 commands/day | Max 100 concurrent connections | $0.20 per 100,000 commands |
| **Speech-to-Text (`en-GB`)** | **Google Cloud Speech** | 60 minutes free audio processing per month | Max 1,000 requests/min | $0.016 to $0.024 per minute of audio |
| **LLM Extraction Layer** | **Google Gemini API** | Free Tier: 15 RPM, 1 million TPM, 1,500 RPD (Gemini 1.5 Flash) | Rate limited to 15 requests/minute | $0.075 per 1M input tokens |

---

## 2. Low-Cost Production Strategy & Optimization Rules
1. **Prevent Cold Starts**: Use external heartbeat ping or scheduled health check (`/health`) every 10 minutes to keep Render backend active during clinical working hours (8am–6pm UK time).
2. **Audio Compression**: Downmix client audio to 16 kHz Mono WAV/AAC before upload. A 15-minute assessment meeting compresses to ~14 MB, allowing ~70 meetings per month within the 1 GB Supabase free storage tier.
3. **Speech API Quota Management**: 60 free Google Cloud Speech minutes per month allows ~4 full 15-minute test pilot meetings for free each month. Subsequent test runs cost ~$0.30 per 15-minute meeting.
