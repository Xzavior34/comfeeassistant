# Vabatim Production Deployment Guide

## Prerequisites
- Node.js v20+
- PostgreSQL 15+
- Redis 7+
- Environment variables configured per `.env.example`

## Deployment Steps
```bash
# 1. Build TypeScript backend
npm run build

# 2. Run Prisma database migrations
npm run db:push

# 3. Seed initial admin/clinician user if required
npm run db:seed

# 4. Start production server
npm start
```
