# Vabatim Security Architecture & Control Matrix

## Security Controls
1. **Authentication & Password Hashing**: JWT tokens with bcrypt salt-10 password hashing.
2. **Role-Based Access Control (RBAC)**: Enforced via `requireRole(UserRole.CLINICIAN, UserRole.ADMIN)`.
3. **Multi-Tenant Isolation (IDOR / BOLA Prevention)**: Every database query and route filter is strictly scoped by `organisationId`.
4. **Short-Lived Signed URLs**: Sensitive documents are delivered exclusively via signed, short-lived URLs (default 15 minutes expiration). No email attachments.
5. **Tamper-Evident Audit Logging**: Cryptographic SHA-256 hash chaining links all audit trail events.
6. **Logging Hygiene**: Raw audio binary data, access tokens, passwords, and sensitive client transcript snippets are explicitly excluded from application loggers.

> [!IMPORTANT]
> **REQUIRES ORGANISATIONAL / LEGAL / DPO REVIEW**  
> Technical controls must be reviewed against NHS Cyber Essentials Plus and trust-specific cybersecurity standards.
