---
files:
  - plugin/bin/lib/ports/env-file.js
  - plugin/bin/lib/ports/registry.js
  - plugin/bin/lib/ports/ensure.js
  - plugin/bin/lib/ports/cli.js
  - plugin/bin/lib/hooks/session-start.js
  - plugin/skills/dispatch/sequential-execution.md
  - plugin/skills/_shared/policy-schema.md
  - plugin/skills/init/claude-md-template.md
  - plugin/skills/init/bootstrap/step-06-5-port-isolation.md
  - plugin/skills/_shared/dev-url-detection.md
  - tests/dispatch-sequential-execution-conformance.test.js
---

# Key a Test Database on the Port Lease Across Several Sessions

**Persona:** a maintainer running two or three Claude Code sessions against the same project at once — each in its own worktree — whose integration tests create a database or schema per run, and who has just watched two sessions clobber the same `test_db`.
**Goal:** give every checkout a stable, unique token it can fold into `DATABASE_URL` the same way it already gets unique ports, and know which controls the plugin provides for running more than one session so nothing else needs inventing.
**Entry point:** `port-services` is set in `.claude-tweaks/policy.yml`, so the SessionStart hook already leases a port block per checkout and writes a managed region into `.env.local`.
**Success state:** `.env.local`'s managed region starts with `CLAUDE_TWEAKS_LEASE={base}`, `ports.js env` prints that line first, the project's test config reads `test_${CLAUDE_TWEAKS_LEASE}`, and a checkout that predates the line gets it added in place on the next session start without its ports moving.

## Steps

### 1. Start a session in each worktree and read the managed region
- **URL:** `.env.local` in each checkout, between the plugin's `BEGIN`/`END` markers
- **Action:** Open the file after SessionStart has run.
- **Should feel:** The region reads `CLAUDE_TWEAKS_LEASE=`, then `PORT=`, then one `{NAME}_PORT=` per service — the lease line is first, and its value equals `PORT`.
- **Should understand:** The token is the lease base, which the registry already makes unique per checkout; the plugin creates no databases. It hands the project one stable number and the project keys whatever it wants on it.
- **Red flags:** The line is missing on a checkout that was leased before this shipped — that is the next step's case, not a failure.

### 2. Let an older region complete itself in place
- **URL:** the same `.env.local`, on the next SessionStart
- **Action:** Start a session in a checkout whose region has `PORT={base}` but no lease line.
- **Should feel:** The line appears as the region's first line; `PORT` and every `{NAME}_PORT` keep their values. The hook's one-line ports summary is unchanged — it never shows the lease token.
- **Should understand:** Currency is still judged on `PORT` matching the lease; a missing lease line is a separate completeness step that rewrites with the same base. Only a region whose ports are actually bound by someone else takes the reallocation path, and only then does the base change.
- **Red flags:** The base changed and no `REALLOCATED` prefix appeared on the ports line — the region had no matching registry lease (moved checkout, reset registry) and was freshly claimed; the lease line is present but this was not an in-place completion.

### 3. Key the test database on the token
- **URL:** the project's `.env` / `vitest.config.*` / test bootstrap
- **Action:** Replace the literal test-database name with `test_${CLAUDE_TWEAKS_LEASE}` (or the `DATABASE_URL` form the CLAUDE.md template shows), and read it via `ports.js env` or the managed region.
- **Should feel:** Two sessions running the suite at once no longer share a database.
- **Should understand:** `/claude-tweaks:init`'s port-isolation step only reports a literal test-database name — it never rewrites it, because the rename touches data the plugin does not own. A reallocated lease leaves a `test_{oldBase}` database behind; the project's own cleanup step handles that.
- **Red flags:** A test config that still hard-codes `test_db` while `.env.local` carries the lease — the report-only finding was surfaced and not acted on.

### 4. Read the one section that says how N sessions coexist
- **URL:** `plugin/skills/dispatch/sequential-execution.md` § Running more than one session
- **Action:** Read it before adding any coordination of your own.
- **Should feel:** Short — it names the existing controls (issue claims, the sibling-session check, worktree reap, port leases, the GitHub rate-limit note) and the one prohibition: never two sessions in the same worktree.
- **Should understand:** CLAUDE.md's Commands note about per-checkout ports is documentation, not a concurrency mechanism; the controls are the mechanism, and the lease token is the last hook-point they lacked.
- **Red flags:** Reaching for a lock file or a queue of your own — the section exists so that nothing new gets invented per project.
