# Criteria: Privacy / PII Handling

Shared, criteria-only fragment — what to flag in code that touches personally identifiable information. No workflow, no Next Actions. Consumed by `/claude-tweaks:code-health`'s privacy-pii judgment lens (frontend, backend, and data areas touching user data). Confidence floor: `high` — privacy findings have regulatory and reputational consequences; do not file speculative findings.

## What to flag

- **PII logged:** fields that are structurally PII (email, phone, full name, IP address, SSN, date of birth, precise location, device identifiers) passed to a logger, analytics call, or error tracking SDK without redaction or masking.
- **PII in URLs:** user identifiers or PII embedded in URL paths or query parameters that will appear in access logs and browser history.
- **Retention without purpose:** PII stored in a database column, cache, or queue message with no TTL, no expiry, and no evident business need for indefinite retention.
- **Missing consent gate:** a feature that collects behavioral data, location, or health information with no consent check visible in the code path.
- **PII transmitted over HTTP (not HTTPS):** only flag when the code explicitly constructs an HTTP URL for a call that carries PII in the body.
- **Oversharing in API responses:** a response serializer that includes PII fields (e.g., password hash, full SSN) that the caller does not need, based on what the endpoint's stated purpose is.
- **Backup retention without per-user erasure:** an account-deletion code path that removes a user's live rows but has no mechanism to make that user's data unreadable in existing backups/snapshots/replicas — no per-user encryption key to destroy, no field-level crypto-shredding hook, nothing invoked against the backup/retention layer at all. Flag the concrete gap in the deletion path, never the regulatory question (right-to-erasure compliance is a business/legal judgment, not something this check verifies — see "What NOT to flag" below). The vendor-neutral recommended fix is **cryptographic erasure**: encrypt each user's sensitive data with a unique per-user key at write time, and on deletion destroy only that key (never rewrite, decrypt, or touch the backup copy itself) — the backup becomes permanently unreadable for that user without any backup-side operation. This pattern applies uniformly regardless of storage backend or backup product (a managed database's automated snapshots, a self-hosted rolling dump, an object-store replica, a message queue's retained log) — flag the absence of a per-user destroyable key, not the specific vendor mechanism used to store the ciphertext.

## What NOT to flag

- Internal service-to-service calls where both ends are controlled and trusted (not user-facing).
- PII in test fixtures that use clearly fake data (e.g., `test@example.com`, `555-1234`).
- Speculative privacy concerns without a concrete code path where real PII flows.
- Compliance concerns (GDPR, CCPA) that require business-level judgment — flag only the concrete code pattern, not the regulatory question. This applies to backup retention too: flag the missing per-user erasure mechanism, never assert a GDPR compliance verdict.
- An account-deletion path where a per-user encryption key (or equivalent crypto-shredding hook) is destroyed on deletion, even if the ciphertext itself persists in backups indefinitely — that is the recommended fix pattern working as intended, not a gap.

## Severity calibration

- **high** — PII logged at a level that reaches a third-party log aggregator or is included in error reports sent externally; PII persisted without any retention limit; PII transmitted in a URL that will be logged server-side; or an account-deletion path with no per-user backup-erasure mechanism at all (deleted users' plaintext PII remains fully readable in every retained backup indefinitely).
- **medium** — an API response including unneeded sensitive fields; a backup-erasure mechanism that exists but only for a subset of the PII-bearing tables/fields a deletion should cover.
- **low** — a minor over-inclusion (e.g., user ID in a URL parameter when it is already in the auth context).

## Copy-paste prompts (one per check, runnable standalone)

**(a) Backup retention vs. right-to-erasure:**
> Scan this codebase's account-deletion path (the handler, service method, or job that runs when a user requests deletion) for what happens to that user's PII in backups, snapshots, or replicas — not just the live database. Check whether each PII-bearing table/field is protected by a per-user encryption key (or equivalent crypto-shredding mechanism) that gets destroyed on deletion, making the backup copy unreadable without ever touching the backup itself. For each gap, name the file, the line, and the fix: encrypt that field with a unique per-user key at write time, and destroy only that key on deletion. Do not assert a GDPR/CCPA compliance verdict — flag only the concrete code/config pattern.
