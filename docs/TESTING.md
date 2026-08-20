# Vabatim Testing & Verification Architecture

## Test Suite Execution
```bash
# 1. Typecheck
npm run typecheck

# 2. Unit & Integration Tests (Jest)
npm run test

# 3. AI Evaluation Benchmark Harness
npm run eval
```

## Coverage Summary
- **Unit Tests**: Meeting state machine transitions, Deterministic Grounding Validator edge cases.
- **Integration Tests**: Health endpoints, Authentication, RBAC, Meeting creation, Tenant isolation.
- **AI Evaluation Suite**: Multi-speaker synthetic fixtures measuring evidence grounding precision and unsupported claim rates.
