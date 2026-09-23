# Criteria: Security Hardening (pre-launch, AI-built apps)

Shared, criteria-only fragment — what to flag when judging `focus=security-hardening` candidates from `bin/lib/code-health/candidates-security-hardening.js` (#2624). No workflow, no Next Actions. Consumed by `/claude-tweaks:code-health`'s security-hardening judgment lens (`skills/code-health/focus-mode.md`'s Criterion pinning table) and by `/claude-tweaks:review`'s Code-Mode Procedure step that invokes this focus as a component skill. One source of truth so every sweep applies identical calibration. Confidence floor: `high`.

## What the generator hands you

Each candidate is `{ file, kind, evidence }` — `kind` is one of `client-secret`, `missing-ownership-check`, `unguarded-ai-endpoint`. This is a starting pointer, not a finding: judge it holistically, the same as any other criterion.

## What to flag

- **`client-secret`** — a secret-shaped literal (a provider key pattern, or a generic `api_key`/`secret_key`/`access_token`/`private_key`-named assignment carrying a long opaque value) sitting in a file under a client-side directory. Confirm it is actually a private/server-only credential before filing — a legitimate public key (Stripe `pk_live_*`, a public API endpoint identifier, a `NEXT_PUBLIC_*`/`VITE_*`/`REACT_APP_*`-prefixed value) is safe to ship client-side and is a false positive even though the generator's `SAFE_PREFIX_RE` already suppresses the common shapes.
- **`missing-ownership-check`** — a query/lookup site in a route or handler file with no ownership predicate (`user_id`/`owner_id`/`req.user`/an RLS reference) in the surrounding text. This is necessarily approximate: the generator can only detect the *absence* of a recognizable predicate near the query, not verify that an existing predicate is actually correct (scoped to the right user, not bypassable). Treat this as a "flag for human review" signal, not a formal proof — read the actual handler before filing to confirm the query really does return user-scoped data with no ownership gate, rather than, say, an intentionally public read or a gate expressed in a shape the pattern didn't recognize (a decorator, a query builder chain that continues past the generator's text window, a framework-level authorization middleware applied at the route-registration layer rather than inline in the handler body).
- **`unguarded-ai-endpoint`** — a route or handler calling a recognized AI-model SDK/API with no auth, rate-limiting, input-length cap, or spend-alert signal nearby. As with the ownership check, this can only detect absence of a recognized guard shape, not verify a present one is adequate — a handler that visibly checks `req.user` but has no separate rate-limit or spend-guard mention should still be flagged for the missing pieces, not dismissed because *some* guard is present.

## What NOT to flag

- A `client-secret` candidate whose matched literal, on inspection, is a placeholder, an example/fixture value (a file under `test/`, `tests/`, `fixtures/`, `__mocks__/`, or named `*.example`/`*.sample`), or a genuinely public key/identifier.
- A `missing-ownership-check` candidate where the ownership gate is real but expressed further from the query site than the generator's fixed text window reaches, or applied at a layer the generator doesn't scan (route-registration middleware, a decorator, a database-level RLS policy not mentioned in the handler file itself) — read the actual code path before concluding the gate is truly absent.
- An `unguarded-ai-endpoint` candidate for an internal-only, non-user-facing script or admin tool with no realistic abuse surface (e.g. a one-off local dev script, a CI job) — the risk this check targets is a public-facing endpoint an unauthenticated caller can hit.

## Scope boundary (deliverable 5, #2624)

This vertical owns exactly the three checks above. It explicitly does **not** own:
- **#2622's pre-scale hardening** (query performance, background-job reliability, caching, connection pooling, monitoring/alerting for scale) — a different, performance-oriented concern even where it also touches "endpoint hardening" territory (e.g. rate limiting appears in both problem statements; here it is scoped narrowly to protecting an AI-calling endpoint from cost/abuse, not to general throughput).
- **#2625's GDPR/backup-retention check** (cryptographic erasure for backup retention on account deletion) — a narrower, compliance-specific concern this vertical does not touch.

## Severity calibration

- **high** — `client-secret` in a file that ships to production client bundles (not a dev-only/example file); `missing-ownership-check` on a route that is reachable by any authenticated user and returns another user's data; `unguarded-ai-endpoint` with no auth signal at all (fully public, unauthenticated AI-calling endpoint).
- **medium** — `missing-ownership-check` behind partial protection (e.g. authenticated but the specific ownership predicate is absent) or in a low-traffic admin surface; `unguarded-ai-endpoint` with auth present but no rate limit, input-length cap, or spend alert.
- **low** — `client-secret` in a clearly non-production or seldom-shipped code path; any candidate where the human read-through finds the underlying risk substantially mitigated by a mechanism the generator's text window didn't see, but which still warrants a lighter-weight follow-up record for visibility.

## Copy-paste prompts (one per check, runnable standalone)

**(a) No secrets in the client bundle:**
> Scan this codebase's client-side source (files under `client/`, `frontend/`, `web/`, `public/`, or `src/components|pages|app/`) for secret-shaped literals — provider API keys, access tokens, or private keys — that should instead live in a server-side environment variable. Exclude known-public key shapes (Stripe `pk_live_`/`pk_test_`, `NEXT_PUBLIC_*`/`VITE_*`/`REACT_APP_*`-prefixed values) and example/fixture files. For each real finding, name the file, the line, and the fix (move the secret to a server-side env var and proxy the call through a backend route).

**(b) Per-user ownership checks / RLS-equivalent enforcement:**
> Scan this codebase's route/handler files for queries or lookups that return user-scoped data with no visible per-user ownership predicate (a `WHERE user_id = ` -shaped filter, an RLS policy reference, or equivalent) in the same file or its immediately-composed query. For each finding, name the file, the line, and confirm by reading the actual handler whether the ownership gate is truly absent or merely expressed elsewhere (middleware, decorator, DB-level policy) before treating it as a real gap.

**(c) Auth + rate limiting + spend alerts on AI-calling endpoints:**
> Scan this codebase's route/handler files for endpoints that call an AI model (OpenAI, Anthropic, or an equivalent SDK) with no visible authentication, per-user rate limiting, input-length validation, or provider spend-alert/budget check nearby. For each finding, name the file, the line, and which of the four protections (auth / rate limit / input-length cap / spend alert) appear to be missing.

## What this vertical never does

Findings from this criterion always propose a record for the supervised/granted build pipeline (`/claude-tweaks:specify` → `/claude-tweaks:build`) — never a direct edit, and never an automated secret rotation or endpoint lockdown. The generator judges from static text alone; verifying a secret is live, or that an endpoint is actually internet-reachable, is a later widening, not this vertical's job.
