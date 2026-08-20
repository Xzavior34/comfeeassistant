# Vabatim Operations & Observability Guide

## Monitoring & Health Checks
- **`/health`**: Returns HTTP 200 with service status and timestamp (scrubbed of PII/credentials).
- **`/ready`**: Returns database and queue readiness status.

## Audit Trail Inspection
Clinicians and Admins can query the tamper-evident SHA-256 audit log via `/api/audit` to trace all authentication, consent, recording access, transcript access, note edit, approval, and document access events.
