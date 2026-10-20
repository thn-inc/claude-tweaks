# Criteria: Scale Readiness (servers and data access)

Shared, criteria-only fragment — what to flag when judging `focus=scale-readiness` candidates from `bin/lib/code-health/candidates-scale-readiness.js` (#2622). No workflow, no Next Actions. Consumed by `/claude-tweaks:code-health`'s scale-readiness judgment lens (`skills/code-health/focus-mode.md`'s Criterion pinning table). One source of truth so every sweep applies identical calibration. Confidence floor: `medium`.

## What the generator hands you

Each candidate is `{ file, kind, evidence }` — `kind` is one of `query-in-loop`, `unbounded-list-query`, `unindexed-where-field`, `inline-slow-work`, `no-cache-layer`, `per-request-db-client`, `unbounded-pool`, `no-monitoring`. Call-site kinds carry the offending file. Repo-level kinds (`no-cache-layer`, `no-monitoring`) are about something absent, so they carry the repo's shallowest `package.json` (else its first route file, else its first Prisma schema) — anchor such a finding as `{file}#{kind}`, e.g. `package.json#no-monitoring`. A candidate is a starting pointer, not a finding — judge it holistically.

The scan also carries a `checklist` array — one `{ id, label, group, phase, status, evidence }` row per item below, on every firing. For automated items the generator's `status` means `pass` = no candidate raised under its stated coverage, `fail` = candidates raised; neither is a verdict until you judge (see Reporting). The manual item is always `manual`. Every row is `n/a` when the repo shows no server or data-access signal (`notApplicable: true`) or discovery failed.

## The checklist — every item, every firing

| Item | Phase | Group | How it is checked |
|---|---|---|---|
| `queries` — Query patterns | `pre-launch` | automated | `query-in-loop`: a query call inside a loop body. `unbounded-list-query`: a `findMany`-style list read with no `take`/`limit`. `unindexed-where-field`: a Prisma `where` field with no `@id`, `@unique` or `@@index` |
| `background-jobs` — Slow work off the request path | `pre-launch` | automated | `inline-slow-work`: an AI call, email send, SMS send or third-party fetch inside a route file with no queue or background-job signal in that file |
| `load-test` — Load test | `pre-launch` | manual | See "Manual item — load test" |
| `caching` — Cache layer | `pre-scale` | automated | `no-cache-layer`: routes run queries and neither a cache dependency nor a framework cache directive exists anywhere |
| `pooling` — Connection pooling | `pre-scale` | automated | `per-request-db-client`: a client constructed inside a route handler. `unbounded-pool`: a pool constructed with no connection cap |
| `monitoring` — Error tracking / APM | `pre-scale` | automated | `no-monitoring`: no error-tracking or APM dependency at all |

The `pre-launch` subset (`queries`, `background-jobs`, `load-test`) and the `pre-scale` subset (`caching`, `pooling`, `monitoring`) are reported separately: the first blocks a launch, the second can wait for traffic.

A "route file" is a Next.js `route.*`, a `pages/api/` file, a SvelteKit `+server.*`, a module whose first statement is `"use server"` (Next.js server actions), or a file under a `routes`/`api`/`handlers`/`controllers`/`endpoints` directory whose nearest `package.json` declares a server or data-access dependency. Prisma calls are recognized on any receiver whose model segment is in the parsed schema (`ctx.db.post.findMany(`), or, with no schema, on a `prisma` or `db` receiver. Seed scripts (`seed.*`, or files under `seed/`, `seeds/` or `seeders/`) are never scanned by the query checks.

## What to flag

- **`query-in-loop`** — an N+1: the loop's iteration count grows with data or request input, and each pass issues its own query. Fix by batching (`where: { id: { in: ids } }`, a join, an `include`).
- **`unbounded-list-query`** — a list read on a table that grows with users or activity, returned or iterated with no `take`/`limit`/pagination.
- **`unindexed-where-field`** — a filter field on a growing table with no index in the Prisma schema.
- **`inline-slow-work`** — a request handler that waits on an AI call, an email send, an SMS send or a third-party fetch before responding.
- **`no-cache-layer`** — DB-backed routes serving read-heavy data with no cache of any kind.
- **`per-request-db-client`** — a database client built per request, which opens a fresh connection each time.
- **`unbounded-pool`** — a pool with no explicit cap, falling back to the driver default (which the candidate's evidence names).
- **`no-monitoring`** — a server in production with no error tracking, so failures are found by users.

## What NOT to flag

Judge each candidate against the generator's known limits before filing — read the surrounding code, not just the matched line:

- `query-in-loop` or `unbounded-list-query` on a capitalized receiver (`COUNTRIES.find(code)`, `Roles.find(id)`) that is an in-memory constant array, not a model. A callback-argument search (`PLANS.find((p) => …)`) is already skipped.
- `query-in-loop` or `unbounded-list-query` on a `db.<table>.<op>(` call in a repo with no Prisma schema when `db` is not a Prisma client (Dexie or another browser-side store) — the schema-less rule accepts any `db` receiver.
- `query-in-loop` over a small fixed-size input (a three-item list literal, an enum's values, a `.map` over a constant).
- `query-in-loop` or `unbounded-list-query` on a bounded admin or seed path the seed exclusion does not name (a one-off script, a migration, a seed script not called `seed.*` and not under a `seed/`, `seeds/` or `seeders/` directory), and `unbounded-list-query` on a `findMany(args)` whose `take` is set where `args` is built.
- `inline-slow-work`, `per-request-db-client` or `no-cache-layer` resting on a file that is not a request handler — in a single-package full-stack app, a browser-side `api/` client counts as a route file because the package declares a server or data dependency.
- `unindexed-where-field` when the field is the leading column of a composite `@@index` — and conversely, a field that is only a non-leading column of one is still unindexed, since a composite index covers only its leading column. Also skip a table that stays small by construction.
- `inline-slow-work` on a `streamText`/`streamObject` response (request-bound by design), and on a call already handed to a queue the generator's signal list does not name.
- `no-cache-layer` when a CDN or edge cache configured outside the repo (a platform setting, a Cloudflare rule) fronts the routes.
- `per-request-db-client` on a module-scope object literal that holds a client in a route file (`const deps = { db: new PrismaClient() }`) — it reads as per-request to the brace-depth count but runs once.
- `unbounded-pool` on a `Pool` class that is not a database pool (`generic-pool`, `undici`, `workerpool`), and on a serverless platform's own pooling (Prisma Accelerate, a Neon or Supabase pooler URL) that bounds connections outside the constructor.
- `no-monitoring` when a platform-level agent or a hosted log drain with no dependency covers errors.
- Any candidate on a repo that does not run a server — a library or static site has no scale to prepare for.

## Severity calibration

- **high** — `query-in-loop` or `per-request-db-client` in a route; `inline-slow-work` for an AI call on a user-facing route.
- **medium** — `unbounded-list-query`, `unindexed-where-field`, `inline-slow-work` for an email send, an SMS send or a third-party fetch, `no-monitoring`, and `unbounded-pool` on serverless.
- **low** — `no-cache-layer`; `query-in-loop` in a script with bounded input.

## Scope boundary

This vertical owns exactly the 6-item checklist above. Before filing a `query-in-loop`, `unbounded-list-query` or `unindexed-where-field` finding, check for an open `scalability` issue at the same anchor: if one exists, treat the finding as covered and reject it with `covered by open scalability issue #N`. Treat an open `observability` issue the same way for `no-monitoring`. The guard is needed because fingerprints differ by criterion (`bin/lib/code-health/fingerprint.js`) and `bin/lib/code-health/dedup.js` matches fingerprints only, so dedup alone would file a second issue for the same defect.

On a generalist (non-focus) slice, a finding that fits `scalability` or `observability` files under that criterion, never this one. AI-endpoint auth and rate-limiting belong to `security-hardening`; site launch items belong to `prelaunch`; App Store requirements belong to `app-store-readiness`.

## Manual item — load test

The `load-test` row is never machine-judged. It asks a human to run a k6 load test against signup, login and the main dashboard, recording p95 latency and error rate before and after any fix from this checklist. Render it as `manual` — a human should run it — on every firing, including a zero-candidate one.

## Reporting

The summary always renders every checklist row, never only the failures, as `| Item | Phase | Group | Status | Evidence |`, with the `pre-launch` rows grouped before the `pre-scale` rows. A run that lists only failures reads as "everything else passed", which overstates what a presence check did.

Reconcile each automated row with your verdicts before rendering it, so the status says what was filed rather than what the generator guessed:

- `pass` stays `pass` — "no gap found under the generator's stated coverage", never a guarantee.
- `fail` whose candidates you all rejected → `pass (N rejected: {reason})`.
- `fail` with at least one candidate filed → `fail`, with evidence naming the filed count and any rejected count.

## What this vertical never does

Findings from this criterion always propose a record for the supervised/granted build pipeline (`/claude-tweaks:specify` → `/claude-tweaks:build`) — never a direct edit to source, schema or infrastructure files, never a load test run against a live app, and never a judgment of the manual item on the generator's behalf.
