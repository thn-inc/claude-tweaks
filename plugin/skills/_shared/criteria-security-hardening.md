# Criteria: Security Hardening (pre-launch, AI-built apps)

Shared, criteria-only fragment — what to flag when judging `focus=security-hardening` candidates from `bin/lib/code-health/candidates-security-hardening.js` (#2624, extended by #2657/#2663/#2666). No workflow, no Next Actions. Consumed by `/claude-tweaks:code-health`'s security-hardening judgment lens (`skills/code-health/focus-mode.md`'s Criterion pinning table) and by `/claude-tweaks:review`'s Code-Mode Procedure step that invokes this focus as a component skill. One source of truth so every sweep applies identical calibration. Confidence floor: `high`.

## What the generator hands you

Each candidate is `{ file, kind, evidence }` — `kind` is one of `client-secret`, `missing-ownership-check`, `unguarded-ai-endpoint` (original #2624 checks), `jwt-alg-not-pinned`, `jwt-long-lived-token` (#2657), `secrets-no-manager`, `no-rotation-procedure`, `no-rotation-schedule` (#2666), or `privacy-policy-mismatch` (#2663). This is a starting pointer, not a finding: judge it holistically, the same as any other criterion.

## What to flag

- **`client-secret`** — a secret-shaped literal (a provider key pattern, or a generic `api_key`/`secret_key`/`access_token`/`private_key`-named assignment carrying a long opaque value) sitting in a file under a client-side directory. Confirm it is actually a private/server-only credential before filing — a legitimate public key (Stripe `pk_live_*`, a public API endpoint identifier, a `NEXT_PUBLIC_*`/`VITE_*`/`REACT_APP_*`-prefixed value) is safe to ship client-side and is a false positive even though the generator's `SAFE_PREFIX_RE` already suppresses the common shapes.
- **`missing-ownership-check`** — a query/lookup site in a route or handler file with no ownership predicate (`user_id`/`owner_id`/`req.user`/an RLS reference) in the surrounding text. This is necessarily approximate: the generator can only detect the *absence* of a recognizable predicate near the query, not verify that an existing predicate is actually correct (scoped to the right user, not bypassable). Treat this as a "flag for human review" signal, not a formal proof — read the actual handler before filing to confirm the query really does return user-scoped data with no ownership gate, rather than, say, an intentionally public read or a gate expressed in a shape the pattern didn't recognize (a decorator, a query builder chain that continues past the generator's text window, a framework-level authorization middleware applied at the route-registration layer rather than inline in the handler body).
- **`unguarded-ai-endpoint`** — a route or handler calling a recognized AI-model SDK/API with no auth, rate-limiting, input-length cap, or spend-alert signal nearby. As with the ownership check, this can only detect absence of a recognized guard shape, not verify a present one is adequate — a handler that visibly checks `req.user` but has no separate rate-limit or spend-guard mention should still be flagged for the missing pieces, not dismissed because *some* guard is present.
- **`jwt-alg-not-pinned`** (#2657) — a JWT verify call (`jwt.verify(`/`jsonwebtoken.verify(`/`jwtVerify(`) with no explicit `algorithms:`/`algorithm:` option within the text window. Covers both the `alg: none` rejection and the algorithm-confusion deliverables together: a library that isn't told which algorithm(s) to accept will trust whatever the token's own header claims, which is exactly the shape both attacks exploit.
- **`jwt-long-lived-token`** (#2657) — a JWT sign call (`jwt.sign(`/`jsonwebtoken.sign(`) with no `expiresIn`/`exp` option within the text window — an unexpiring token functions as a permanent access key once stolen.
- **`secrets-no-manager`** (#2666) — a credential-shaped `process.env.*` access (`*_KEY`/`*_SECRET`/`*_TOKEN`/`*_PASSWORD`, excluding `*_PUBLIC_*`/`*_PUBLISHABLE_*` names) with no secrets-manager SDK import (Doppler, Infisical, AWS/GCP Secrets Manager, Vault, Azure Key Vault) anywhere in the same file.
- **`no-rotation-procedure`** (#2666) — a file that imports a secrets-manager SDK (so `secrets-no-manager` does not fire) but contains no "rotat*" mention anywhere in it — no documented rotation procedure to point to.
- **`no-rotation-schedule`** (#2666) — a file that mentions rotation but names no automation signal (cron, a scheduler, EventBridge/CloudWatch Events) nearby — the rotation procedure reads as manual-only, with no bounded exposure window.
- **`privacy-policy-mismatch`** (#2663) — a recognized third-party service (analytics, error-tracking, payments, etc. — see `THIRD_PARTY_SERVICES` in the generator) integrated in code but not named anywhere in the repo's privacy-policy document. Only fires when a privacy-policy file is actually found (see Scope boundary) — this check judges *accuracy*, not *existence*.

## What NOT to flag

- A `client-secret` candidate whose matched literal, on inspection, is a placeholder, an example/fixture value (a file under `test/`, `tests/`, `fixtures/`, `__mocks__/`, or named `*.example`/`*.sample`), or a genuinely public key/identifier.
- A `missing-ownership-check` candidate where the ownership gate is real but expressed further from the query site than the generator's fixed text window reaches, or applied at a layer the generator doesn't scan (route-registration middleware, a decorator, a database-level RLS policy not mentioned in the handler file itself) — read the actual code path before concluding the gate is truly absent.
- An `unguarded-ai-endpoint` candidate for an internal-only, non-user-facing script or admin tool with no realistic abuse surface (e.g. a one-off local dev script, a CI job) — the risk this check targets is a public-facing endpoint an unauthenticated caller can hit.
- A `jwt-alg-not-pinned` candidate where the call site passes a separately-defined options object the generator's text window doesn't reach (e.g. a `const VERIFY_OPTIONS = { algorithms: [...] }` declared elsewhere and spread in) — read the actual call before concluding the allowlist is truly absent.
- A `secrets-no-manager`/`no-rotation-procedure`/`no-rotation-schedule` candidate where the real secrets-manager usage or rotation documentation lives in a *different* file (a shared config module, a separate ops runbook) than the one flagged — this generator is a single-file heuristic (see the module header's Coverage block); confirm repo-wide before filing.
- A `privacy-policy-mismatch` candidate for a service that is genuinely internal/non-data-processing (e.g. a build-time-only bundler plugin whose name happens to match a pattern) rather than a real third-party data flow.

## Scope boundary (deliverable 5, #2624; extended by #2657/#2663/#2666)

This vertical owns exactly the checks above. It explicitly does **not** own:
- **#2622's pre-scale hardening** (query performance, background-job reliability, caching, connection pooling, monitoring/alerting for scale) — a different, performance-oriented concern even where it also touches "endpoint hardening" territory (e.g. rate limiting appears in both problem statements; here it is scoped narrowly to protecting an AI-calling endpoint from cost/abuse, not to general throughput).
- **The GDPR/backup-retention check** (cryptographic erasure for backup retention on account deletion) — a narrower, compliance-specific concern this vertical does not touch. It lives in `criteria-privacy-pii.md`'s "Backup retention without per-user erasure" flag (#2625).
- **#2625's data-handling scope more broadly** — `privacy-policy-mismatch` (#2663) judges only whether a third-party service visible in code is *named* in the policy document; it does not judge GDPR deletion/retention correctness, which stays `criteria-privacy-pii.md`'s job.
- **Terms-of-service accuracy and cyber-liability-insurance coverage** (#2663's other two deliverables) — neither is code-inspectable; see "Manual items" below. This vertical never attempts an automated check for either, and never will.

`secrets-no-manager`/`no-rotation-procedure`/`no-rotation-schedule` (#2666) are independent of, and never substitute for, `client-secret` (#2624): a secret can pass `client-secret`'s row (it never appears in client-visible code) while still failing every row #2666 adds (no dedicated manager, no rotation procedure, no rotation schedule) — a secret can be correctly server-side and still be a long-lived, unrotatable, single point of compromise. Keep the two checklist rows and their pass/fail logic independent.

## Severity calibration

- **high** — `client-secret` in a file that ships to production client bundles (not a dev-only/example file); `missing-ownership-check` on a route that is reachable by any authenticated user and returns another user's data; `unguarded-ai-endpoint` with no auth signal at all (fully public, unauthenticated AI-calling endpoint); `jwt-alg-not-pinned` on a token-verification path that gates access to user data or privileged actions.
- **medium** — `missing-ownership-check` behind partial protection (e.g. authenticated but the specific ownership predicate is absent) or in a low-traffic admin surface; `unguarded-ai-endpoint` with auth present but no rate limit, input-length cap, or spend alert; `jwt-long-lived-token`; `secrets-no-manager`; `privacy-policy-mismatch` for a service that only collects non-sensitive usage analytics.
- **low** — `client-secret` in a clearly non-production or seldom-shipped code path; `no-rotation-procedure`/`no-rotation-schedule` (real risk, but bounded by the fact a manager is already in use); any candidate where the human read-through finds the underlying risk substantially mitigated by a mechanism the generator's text window didn't see, but which still warrants a lighter-weight follow-up record for visibility.

## Manual items (not automated — #2663)

Two of #2663's three deliverables are deliberately **not** generator candidates — neither is something a code check can verify, and the record's own framing is explicit that an automated version of either would be false-positive-prone and undermine trust in the rest of this checklist. Render both as plain reminder lines in any report surfacing this criterion, never as a `kind` the generator could emit:

- **Terms of service** — before launch, read the hosting/distribution platform's terms of service. Not automatable; no attempt is made to parse or verify ToS compliance programmatically.
- **Cyber liability insurance** — before launch, confirm cyber liability insurance coverage is in place. A business/financial decision outside any code check's scope.

## Copy-paste prompts (one per check, runnable standalone)

**(a) No secrets in the client bundle:**
> Scan this codebase's client-side source (files under `client/`, `frontend/`, `web/`, `public/`, or `src/components|pages|app/`) for secret-shaped literals — provider API keys, access tokens, or private keys — that should instead live in a server-side environment variable. Exclude known-public key shapes (Stripe `pk_live_`/`pk_test_`, `NEXT_PUBLIC_*`/`VITE_*`/`REACT_APP_*`-prefixed values) and example/fixture files. For each real finding, name the file, the line, and the fix (move the secret to a server-side env var and proxy the call through a backend route).

**(b) Per-user ownership checks / RLS-equivalent enforcement:**
> Scan this codebase's route/handler files for queries or lookups that return user-scoped data with no visible per-user ownership predicate (a `WHERE user_id = ` -shaped filter, an RLS policy reference, or equivalent) in the same file or its immediately-composed query. For each finding, name the file, the line, and confirm by reading the actual handler whether the ownership gate is truly absent or merely expressed elsewhere (middleware, decorator, DB-level policy) before treating it as a real gap.

**(c) Auth + rate limiting + spend alerts on AI-calling endpoints:**
> Scan this codebase's route/handler files for endpoints that call an AI model (OpenAI, Anthropic, or an equivalent SDK) with no visible authentication, per-user rate limiting, input-length validation, or provider spend-alert/budget check nearby. For each finding, name the file, the line, and which of the four protections (auth / rate limit / input-length cap / spend alert) appear to be missing.

**(d) JWT algorithm confusion / `alg: none` (#2657):**
> Scan this codebase's JWT verification call sites (`jwt.verify`, `jsonwebtoken.verify`, `jwtVerify`, or an equivalent) for a missing explicit `algorithms` allowlist. For each finding, name the file, the line, and confirm whether the verification path would accept a token whose header claims `alg: none` or an unexpected algorithm (e.g. an HMAC-signed token presented against an RSA public key).

**(e) Short-lived tokens + refresh flow (#2657):**
> Scan this codebase's JWT issuance call sites (`jwt.sign`, `jsonwebtoken.sign`, or an equivalent) for a missing `expiresIn`/`exp` claim, or one set to an excessively long duration. For each finding, name the file, the line, and confirm whether a refresh-token flow exists to re-issue short-lived access tokens.

**(f) Secrets-manager usage + rotation (#2666):**
> Scan this codebase for credential-shaped environment-variable access (`process.env.*_KEY`/`*_SECRET`/`*_TOKEN`/`*_PASSWORD`) with no dedicated secrets-manager SDK import nearby (Doppler, Infisical, AWS/GCP Secrets Manager, Vault, Azure Key Vault). For each finding, name the file and line, then check the project's docs for a rotation procedure: is it documented, does it support dual-key validity during a transition window (new key verified before the old one is revoked), and is the rotation schedule automated rather than manual-only.

**(g) Privacy-policy accuracy (#2663):**
> Compare this codebase's third-party service integrations (analytics, error-tracking, payment, chat/support SDKs) against the repo's privacy-policy document. For each service found in code but not named in the policy, name the file, the service, and the policy document that should be updated to disclose it.

## What this vertical never does

Findings from this criterion always propose a record for the supervised/granted build pipeline (`/claude-tweaks:specify` → `/claude-tweaks:build`) — never a direct edit, and never an automated secret rotation, token-config change, or endpoint lockdown. The generator judges from static text alone; verifying a secret is live, that an endpoint is actually internet-reachable, or that a privacy policy's prose is legally sufficient, is a later widening, not this vertical's job. The terms-of-service and cyber-liability-insurance items are never automated, by design (see Manual items above).
