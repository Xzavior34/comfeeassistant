# Vabatim Logging Privacy & Sanitation Audit Report

## 1. Audit Scope & Search Findings
Repository code was audited for stdout/stderr emission (`console.log`, `console.error`, error serialization, request middleware logging).

## 2. Sanitization Control Verification
- **Raw Audio Binary Data**: Explicitly excluded from all logger statements.
- **Client Transcript Content**: Excluded from `AuditLogger` and API log output. Audit log records contain only `actorId`, `eventType`, `resourceType`, `resourceId`, and SHA-256 `recordHash`.
- **JWT / Auth Secrets / Passwords**: Excluded from log streams.
- **Error Serialization**: Centralized `errorHandler` returns generic error names and messages without dumping stack traces containing system paths or sensitive variables to public API clients.

> [!IMPORTANT]
> **REQUIRES ORGANISATIONAL / LEGAL / DPO REVIEW**  
> Logging controls align with UK GDPR data minimisation principles. Production log aggregation (e.g. CloudWatch, Datadog) should enforce 30-day log expiration.
