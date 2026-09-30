# Criteria: Privacy / PII Handling

Shared, criteria-only fragment — what to flag in code that touches personally identifiable information. No workflow, no Next Actions. Consumed by `/claude-tweaks:code-health`'s privacy-pii judgment lens (frontend, backend, and data areas touching user data). Confidence floor: `high` — privacy findings have regulatory and reputational consequences; do not file speculative findings.

## What to flag

- **PII logged:** fields that are structurally PII (email, phone, full name, IP address, SSN, date of birth, precise location, device identifiers) passed to a logger, analytics call, or error tracking SDK without redaction or masking.
- **PII in URLs:** user identifiers or PII embedded in URL paths or query parameters that will appear in access logs and browser history.
- **Retention without purpose:** PII stored in a database column, cache, or queue message with no TTL, no expiry, and no evident business need for indefinite retention.
- **Missing consent gate:** a feature that collects behavioral data, location, or health information with no consent check visible in the code path.
- **PII transmitted over HTTP (not HTTPS):** only flag when the code explicitly constructs an HTTP URL for a call that carries PII in the body.
- **Oversharing in API responses:** a response serializer that includes PII fields (e.g., password hash, full SSN) that the caller does not need, based on what the endpoint's stated purpose is.
- **Backup retention outlives erasure:** an account-deletion path that removes a user's rows from the live database but has no corresponding mechanism to make that user's data unreadable in existing backups/snapshots — no per-user encryption key to destroy, no backup-scrubbing job, and no documented retention window after which old backups age out. The deletion code path itself is the flaggable artifact: it deletes live rows and stops, leaving plaintext (or a single shared encryption key covering all users) sitting in rolling backups indefinitely.

## What NOT to flag

- Internal service-to-service calls where both ends are controlled and trusted (not user-facing).
- PII in test fixtures that use clearly fake data (e.g., `test@example.com`, `555-1234`).
- Speculative privacy concerns without a concrete code path where real PII flows.
- Compliance concerns (GDPR, CCPA) that require business-level judgment — flag only the concrete code pattern, not the regulatory question. For the backup-retention check specifically: flag the absence of a per-user erasure mechanism, never assert that the app "violates GDPR" — that is a legal conclusion this criterion does not make.
- A deletion path where per-user field-level encryption (or equivalent per-user key material) is already destroyed on deletion, even if the encrypted ciphertext itself remains in backups — the data is cryptographically unreadable, which is the pattern this check wants, not a gap.

## Severity calibration

- **high** — PII logged at a level that reaches a third-party log aggregator or is included in error reports sent externally; PII persisted without any retention limit; or PII transmitted in a URL that will be logged server-side.
- **medium** — an API response including unneeded sensitive fields; an account-deletion path with no per-user backup-erasure mechanism and no bounded backup retention window (data stays readable indefinitely).
- **low** — a minor over-inclusion (e.g., user ID in a URL parameter when it is already in the auth context); an account-deletion path with no per-user erasure mechanism, but backups are bounded by a short, documented retention window (e.g., 30 days) rather than kept indefinitely.

## Copy-paste prompts

**Backup retention vs. right-to-erasure (cryptographic erasure check):**
> Scan this codebase's account-deletion path (the handler, job, or script that runs when a user deletes their account or requests erasure) for what happens to that user's data in backups. Confirm: (1) does deletion remove only live-database rows, leaving rolling/scheduled backups holding the same data in plaintext or under a single shared key? (2) is there a per-user encryption key (or equivalent per-user key material) that gets destroyed on deletion, making that user's data in existing backups unreadable without touching the backup itself? For each finding, name the file, the line, and — if the per-user key mechanism is missing — recommend cryptographic erasure as the fix: encrypt each user's sensitive fields with a unique per-user key at write time, and destroy only that key (never the backup) on account deletion. This pattern applies to any storage backend that keeps rolling backups or snapshots — it is not tied to one specific database or cloud vendor's backup product. Flag only the code/config pattern (missing per-user key destruction), never a compliance verdict.

Relationship to the security-hardening checklist (`criteria-security-hardening.md`, #2624): that vertical's three checks (client secrets, missing ownership checks, unguarded AI endpoints) explicitly exclude this backup-retention/erasure concern — see its Scope boundary section. This check lives here, in the general-purpose `privacy-pii` criterion, rather than duplicating scope in both places.
