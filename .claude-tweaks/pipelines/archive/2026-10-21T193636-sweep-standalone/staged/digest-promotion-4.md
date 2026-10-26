# Staged: Propose digest cluster — [code-health] (9 entries)

Finding: [digest] digest container #1426 holds 9 un-promoted entries sharing area `code-health`. That clears the 3-entry threshold for cluster promotion.
Proposed: file one spec-shaped backlog record absorbing them, then append `→ #{new}` to each promoted entry line in #1426 (comment ids: 6286177598, 6286977084).

## Proposed record

**Title:** code-health: resolve 9 accumulated below-floor digest findings

### Current State
The materiality-floor digest (#1426) has accumulated 9 below-floor findings in the `code-health` area. Each was too small to file on its own, but together they make a coherent unit of work.

### Deliverables
- normalizeBranch strips comments with literal-blind regexes, so a compared branch body holding a // inside a string loses the rest of that line; both sides are mangled alike, so impact is small. Trigger: an experiment-cleanup false positive/negative traced to a // in a string — then move the #3585 scanner into plugin/bin/lib/ and call it — plugin/bin/lib/code-health/candidates-experiment-cleanup.js:95-101 — Defer-reason: pre-existing-outside-diff — 2026-10-19T170937-spec-3541-3543-3585
- scale-readiness: a capitalized-receiver `X.find(` still matches some in-memory constant lookups with a non-function argument, and a filtered Model.find with no .limit reads as unbounded. Trigger: judge rejections of scale-readiness candidates dominated by this shape — plugin/bin/lib/code-health/candidates-scale-readiness.js — Defer-reason: genuinely-larger — 2026-10-20T070358-record-2622
- scale-readiness: `findMany(args)` with a non-literal argument, a spread-only `{ ...opts }` or a computed `['take']` key reads as unbounded (flagged side; the judge reads the call). Trigger: same as the capitalized-receiver entry — plugin/bin/lib/code-health/candidates-scale-readiness.js — Defer-reason: genuinely-larger — 2026-10-20T070358-record-2622
- scale-readiness: a module-scope object literal holding a client in a route file (`module.exports = { db: new PrismaClient() }`) reads as per-request-db-client. Named in the fragment's What NOT to flag. Trigger: same as the capitalized-receiver entry — plugin/bin/lib/code-health/candidates-scale-readiness.js — Defer-reason: genuinely-larger — 2026-10-20T070358-record-2622
- scale-readiness: `unbounded-pool` matches non-DB Pool classes (generic-pool, undici, workerpool) because it has no DB-dependency gate; gating on ctx.deps is the fix. Named in the fragment's What NOT to flag. Trigger: same as the capitalized-receiver entry — plugin/bin/lib/code-health/candidates-scale-readiness.js — Defer-reason: needs-human-decision — 2026-10-20T070358-record-2622
- scale-readiness: `window.fetch(`/`globalThis.fetch(` third-party calls on the request path are not matched (dotted-receiver lookbehind); server route files rarely use those receivers. Trigger: same as the capitalized-receiver entry — plugin/bin/lib/code-health/candidates-scale-readiness.js — Defer-reason: needs-human-decision — 2026-10-20T070358-record-2622
- scale-readiness fragment: severity calibration leaves unbounded-pool off-serverless and an AI inline-slow-work call on a non-user-facing route unplaced, and "bounded input" in What NOT to flag is in mild tension with a Severity "low" line. The judge falls back to holistic severity — plugin/skills/_shared/criteria-scale-readiness.md — Defer-reason: needs-human-decision — 2026-10-20T070358-record-2622
- scale-readiness: `isRouteFile` is the pure path predicate while route membership also needs a nearest-package server/data dependency or a "use server" directive (a naming trap for future callers; the definition carries a comment saying so). Trigger: a second caller of isRouteFile appears — plugin/bin/lib/code-health/candidates-scale-readiness.js — Defer-reason: needs-human-decision — 2026-10-20T070358-record-2622
- scale-readiness: Nuxt/h3/@trpc/server/Elysia apps with only a framework dependency and a server/api directory read as not applicable, because SERVER_DEPS/DATA_DEPS do not name them (disclosed as "a dependency this list does not name"). Trigger: a user reports a missed framework — plugin/bin/lib/code-health/candidates-scale-readiness.js — Defer-reason: needs-human-decision — 2026-10-20T070358-record-2622

### Acceptance Criteria
- Each Deliverable above is fixed, or explicitly ruled won't-fix with a one-line reason in the closing PR.
- Each promoted digest entry line in #1426 carries `→ #{this record}`.

## Commands
gh issue create --repo thn-inc/claude-tweaks --title "code-health: resolve 9 accumulated below-floor digest findings" --body-file <this proposal's Proposed record section>
