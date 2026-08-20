# Vabatim Data Retention Policy

## Retention Tiers
1. **Raw Audio Recordings**: Retained for the minimum duration required to process and verify transcription, then automatically deleted per organisation policy.
2. **Draft Clinical Notes**: Retained for 30 days during review phase.
3. **Approved Clinical Documents**: Retained according to NHS Standard Record Retention schedules (default 8 years).
4. **Audit Logs**: Immutable tamper-evident logs retained per legal requirements.

## Automated Cleanup
The background queue includes `RetentionService` which executes auditable, idempotent deletion jobs and logs every deletion event.
