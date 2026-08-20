# ACCURACY & CORRECTION METRICS AUDIT

## Overview
This audit verifies the implementation of the Clinician Correction Metrics system. The system measures the degree of modification required by clinicians on AI-generated drafts before approval, rather than relying on self-reported AI "confidence" scores.

## Architecture & Versioning

| Requirement | Status | Evidence |
| :--- | :--- | :--- |
| **Draft Versioning** | **PASS** | `src/routes/reviews.ts` stores `noteVersions` tracking the initial `AI` draft and subsequent `CLINICIAN` edits. |
| **Prisma Schema** | **PASS** | `ClinicalNoteVersion` and `ClinicalNoteMetrics` models added to `schema.prisma`. |
| **Edit Classification**| **PASS** | `src/services/metricsService.ts` deterministic calculation comparing AI Draft vs Approved Draft (`UNCHANGED`, `MINOR_EDIT`, `SUBSTANTIAL_EDIT`). |
| **Dashboard** | **PASS** | `frontend/src/components/MetricsDashboard.tsx` exposes "Documentation Quality Metrics". |
| **No Auto-Approval** | **PASS** | Metrics calculation triggers *only* after explicit clinician `POST /approve`. |

## Metrics Calculated

The API successfully calculates:
- Total Generated / Reviewed / Approved Notes
- Correction Rate (percentage of approved notes requiring any edits)
- Minor vs Substantial Edit categorization
- Average Review Time (Time from Draft 1 to Final Approval)
- Speech Corrections (Accepted/Proposed)
- Grounding Violations

### Security & Privacy
- **Tenant Isolation:** The API endpoint (`/api/metrics/documentation-quality`) strictly filters metrics by `req.user.organisationId`.
- **No PII Leaks:** The aggregate dashboard calculates raw counts and percentages without exposing Patient Identifiers, Names, or raw transcript data.

### Files Changed
- `prisma/schema.prisma`
- `src/services/metricsService.ts`
- `src/routes/reviews.ts`
- `src/routes/metrics.ts`
- `src/app.ts`
- `frontend/src/components/MetricsDashboard.tsx`
- `frontend/src/App.tsx`
- `frontend/src/services/api.ts`

**PRODUCTION STATUS: PASS** (Metrics architecture deployed securely without violating clinical governance).
