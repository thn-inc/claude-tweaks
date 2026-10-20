---
files:
  - plugin/bin/lib/code-health/candidates-scale-readiness.js
  - plugin/bin/lib/code-health/focus-generators.js
  - plugin/bin/lib/code-health/criteria.js
  - plugin/skills/_shared/criteria-scale-readiness.md
  - plugin/skills/code-health/focus-mode.md
---

# Run a Scale-readiness Check

**Persona:** A developer whose AI-coded app (Next.js, Express, Prisma) works for one tester and is about to meet real traffic: a launch, a press spike, or a paid campaign. They know it runs. They do not know which queries, request handlers and missing safety nets will fall over first.
**Goal:** Get one report that sorts the scale basics into "fix before launch" and "fix before you scale". It should say which basics the code shows, which it lacks, and what a person still has to measure. It must not pretend to have load-tested anything.
**Entry point:** Typing `/claude-tweaks:code-health focus=scale-readiness` in a session at the app's repo root.
**Success state:** A six-row checklist table, with the pre-launch rows (queries, background jobs, load test) grouped before the pre-scale rows (caching, pooling, monitoring). Five rows read pass or fail and the load-test row is marked for a human. There is also a filed record for each real gap the judge confirmed.

## Steps

### 1. Kick off the check
- **URL:** N/A (slash command)
- **Action:** The developer types `/claude-tweaks:code-health focus=scale-readiness`. `focus-mode.md` resolves `scale-readiness` from the generator registry and pins the `scale-readiness` criterion and `criteria-scale-readiness.md`.
- **Should feel:** Like asking a colleague who has been paged at 3 a.m. to look the code over before the traffic arrives.
- **Should understand:** This is a static read of the repo's JS/TS source, `package.json` and Prisma schema. Nothing is run against the live app.
- **Red flags:** `focus=scale-readiness` is rejected as an unknown focus, or the run falls back to the generalist directory sweep.

### 2. Read the checklist by phase
- **URL:** N/A
- **Action:** The generator (`candidates-scale-readiness.js`) runs its checks and the summary renders every row as `| Item | Phase | Group | Status | Evidence |`. The checks look for:
  - queries inside loops, `findMany` lists with no `take`, and `where` fields with no index in the Prisma schema
  - AI calls, email or SMS sends, and third-party fetches inside route handlers that show no queue signal
  - DB-backed routes with no cache layer
  - DB clients built per request, and pools with no cap
  - no error-tracking or APM dependency
- **Should feel:** Ordered by urgency. The pre-launch rows come first, because they are what breaks on day one.
- **Should understand:** A `pass` means "no gap seen under the generator's stated coverage", not "this app scales". The `load-test` row is never a pass. It asks the developer to run k6 against signup, login and the main dashboard and record p95 latency and error rate before and after.
- **Red flags:** The table shows only failures, so the remaining rows read as verified. Or the load-test row reads `pass`. Or rows appear without their phase.

### 3. See real gaps filed, and non-servers left alone
- **URL:** N/A
- **Action:** The judge confirms or rejects each candidate against `criteria-scale-readiness.md`'s severity calibration, and confirmed gaps are filed like any other code-health finding. A candidate already covered by an open `scalability` or `observability` issue at the same anchor is rejected, so it is not filed twice. A repo-level gap anchors to a real file, as in `package.json#no-monitoring`. If the repo shows no server or data-access signal (only a library, a CLI with no database, or a front-end-only single-page app), the run reports `focus=scale-readiness: not applicable — no server or data-access signal detected` and stops.
- **Should feel:** Proportionate. An N+1 query in a route is high severity. A missing cache layer is low.
- **Should understand:** Files under test, fixture, example and build-output directories, and seed scripts, are never treated as the running app. A browser `src/api/` client in a front-end package is not a server route.
- **Red flags:** A front-end-only or library repo is told to add monitoring and a connection pool. Or the same N+1 site is filed under both `scalability` and `scale-readiness`.

## Origin
- Created during build of #2622 (pre-scale hardening checklist for AI-coded apps), 2026-10-20
- Related: #2693 (sibling `focus=prelaunch` vertical whose checklist shape this one mirrors)
