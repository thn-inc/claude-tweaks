---
name: test
description: Use when you need to run verification checks (types, lint, tests) or validate QA stories — the mechanical "does it work?" gate.
argument-hint: "[types|lint|unit|integration|e2e|affected|qa|all|skip-qa|<path>] [tag=<tag>] [story=<name>] [retry=<path>] [journey=<name>] [dir=<path>] [priority=<level>] [max_parallel=N] [timeout=<ms>] [headless]"
---

# Test — Verification Gate

Mechanical pass/fail gate — types, lint, tests, QA story validation. Answers "does it work?" without analytical judgment. Part of the workflow lifecycle:

Lifecycle: `/claude-tweaks:stories` → **`/claude-tweaks:test`** → `/claude-tweaks:review`

## When to Use

- After making changes and before committing — quick sanity check
- During development to verify a specific module or feature
- When `/claude-tweaks:review` is overkill — you just want to know if things pass
- After resolving merge conflicts
- Before starting `/claude-tweaks:review` to catch obvious failures early
- When CI fails and you need to reproduce locally
- When QA stories exist and you want to validate them against a running app
- After `/claude-tweaks:stories` generates or updates YAML stories
- The user says "run tests", "does it pass?", "check types", "lint this", or "run QA"

## Input

`$ARGUMENTS` controls scope and mode:

| Argument | Behavior |
|----------|----------|
| *(none)* | Standard suite — run all checks documented in CLAUDE.md (types + lint + tests) |
| `types` | Type checking only |
| `lint` | Linting only |
| `unit` | Unit tests only |
| `integration` | Integration tests only |
| `e2e` | End-to-end tests only |
| `{file or directory path}` | Run tests scoped to that path |
| `{test name pattern}` | Run tests matching the pattern |
| `affected` | Run tests affected by this run's changed-file set — `verify.js --changed-files` (committed changes since the last full pass ∪ the working tree; see `verification.md`'s scoping table) |
| `qa` | QA story validation only — run YAML stories against a running app |
| `qa tag={tag}` | QA stories filtered by tag (e.g., `qa tag=smoke`) |
| `qa story={name}` | QA — single story by name (substring match) |
| `qa retry={path}` | QA — re-run only failed stories from a previous run |
| `qa affected` | QA — run only stories whose `source_files` overlap the same `--changed-files` set |
| `qa journey={name}` | QA — run only stories with `journey: {name}` (kebab-case, case-insensitive match against the story's `journey:` field; e.g., `qa journey=profile-settings`) |
| `qa dir={path}` | QA — override the stories directory (default `stories/`) |
| `qa priority={level}` | QA — only run stories at or above the priority threshold (`high` > `medium` > `low`; stories without `priority` are treated as `medium`) |
| `qa max_parallel={N}` | QA — max concurrent agents per dependency tier (default `4`) |
| `qa headless` | QA — run the browser invisibly (default is headed/visible) |
| `qa timeout={ms}` | QA — override the per-agent timeout in milliseconds (default `300000`, i.e. 5 minutes); e.g. `qa timeout=600000` for a slow staging environment, or `qa timeout=60000` for fast-fail local iteration |
| `all` | Full suite (types + lint + tests) AND QA story validation |
| `skip-qa` | Run types/lint/tests only. Skip QA story validation **even when stories exist**. (Step 1.5 Design CLI gate still runs — see that step for details.) |

Multiple arguments can be combined: `/claude-tweaks:test types lint` runs both type checking and linting.

## Pipeline Context Awareness

When running inside a `/claude-tweaks:flow` pipeline, `/test` reads context from previous steps:

| Variable | Source | Effect |
|----------|--------|--------|
| `VERIFICATION_PASSED` | Set by `/claude-tweaks:build` Common Step 5 | Skip types/lint/tests — they already passed in build. QA still runs if stories exist. |
| `VERIFICATION_SHA` | Set by `/claude-tweaks:build` Common Step 5, alongside `VERIFICATION_PASSED` | The commit build's verification ran against. Compared to current `HEAD` before honoring the skip (see `verification.md`'s "Skip-if-recent") — a mismatch means the tree changed since build passed, and verification re-runs instead of skipping. |
| `STORIES_DIR` | Set by `/claude-tweaks:stories` or auto-detected | Directory containing QA story YAML files |
| `DEV_URL` | Set by `/claude-tweaks:stories` or auto-detected | Dev server URL for QA execution |

**Pipeline behavior:**

- `VERIFICATION_PASSED=true` + no stories → skip verification, report "passed in build, no QA stories", set `TEST_PASSED=true`
- `VERIFICATION_PASSED=true` + stories exist → skip verification, then **select stories by `source_files` ∩ the changed-file set** (`node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --changed-files --integration-branch {ref}` — exit 1 means no base resolved: never treat it as an empty set, fall back to the full story set; exact repo-relative path match; a story with no `source_files` field is always included): one or more matches → run only those; zero matches → the surface decides, and it is read once: a materialized `surface:` of `web`/`mobile`/`desktop` → run the full story set (a new UI story may not carry `source_files` yet — never skip QA there, #808); any other surface (or no header) → apply `design-wrapper/frontend-detection.md`'s Layer 3 sniff to the changed-file set — any UI trigger file → run the full story set; none → report `QA: skipped — no affected stories ({n} stories considered, {m} changed files)`, set `TEST_PASSED=true`, and log `AUTO {time} — QA scoped: 0/{n} stories affected by {m} changed file(s); skipped — non-frontend surface. Reversibility: high.`. Every selection logs `AUTO {time} — QA scoped: {k}/{n} stories affected by {m} changed file(s). Reversibility: high.` The Design CLI gate (Step 1.5) still runs on a skip.
- `VERIFICATION_PASSED=true` + `skip-qa` argument → skip verification AND skip QA, set `TEST_PASSED=true` (used by `/flow`'s polish-phase re-verify gate)
- No `VERIFICATION_PASSED` + `skip-qa` → run types/lint/tests but skip QA story validation
- No `VERIFICATION_PASSED` (and no `skip-qa`) + runner stamp verifying `HEAD` (`verify.js --stamp-status` → `verifiedHead: true`, per `verification.md`'s Skip-if-recent artifact branch) → skip verification, report "runner stamp {sha} ({scope}) verifies HEAD", run QA if stories exist (selected per bullet 2's rule), set `TEST_PASSED=true`
- No `VERIFICATION_PASSED` (default) → run full suite (and QA if stories exist when mode is `all`)

## Step 0: PR-Bookkeeping Precondition Check

Runs unconditionally, before any scope resolution, regardless of `$ARGUMENTS` — this is a
defense-in-depth safety net (#2472) layered on top of `pre-tool-use.js`'s
`checkBookkeepingStampsGate` (per-tool-call enforcement during build, keyed off an ambiguously
resolved run dir) and `build/SKILL.md` Common Step 7's own bookkeeping assertion (both of which
should already have caught this — this step exists for the case where either one didn't fire).

**Skip when `$PIPELINE_RUN_DIR` is unset** — a standalone `/claude-tweaks:test` invocation with no
pipeline run has nothing to check.

Otherwise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/check-pr-bookkeeping.js" --run "$PIPELINE_RUN_DIR"
```

- **Exit 0** — compliant (or nothing to check yet, e.g. no materialize commit landed). Continue to
  Step 1.
- **Exit 4** — a genuine bookkeeping-precondition violation: this pr-first run's materialize
  commit landed without a recorded worktree assignment, or (under `integration-model: pr-first`)
  without a recorded PR, a durable exemption, or a logged degrade line. **Stop the pipeline** and
  render the command's stderr verbatim as a HARD-GATE failure card — do not attempt to silently
  remediate on the test skill's own initiative; the remediation command is already named in the
  stderr message, aimed at whoever runs `/claude-tweaks:build` (or a human) to fix forward.
- **Exit 2 or 3** — a tooling/usage problem with the check itself (should not occur when
  `$PIPELINE_RUN_DIR` resolved correctly), not a bookkeeping finding. Fail open: log a `SKIP`
  entry per `_shared/auto-decision-log.md`'s degrade-trace rule (`condition: check-pr-bookkeeping.js
  exited {code} → fallback: precondition not verified this run`) and continue to Step 1 — this
  check is additive, never a reason to block on its own malfunction.

## Step 1: Resolve Scope and Execute

### Standard suite (no arguments)

Run the shared verification procedure from `verification.md` in this skill's directory. This resolves commands from CLAUDE.md and runs type checking, linting, and tests.

### Targeted scope (with arguments)

When `$ARGUMENTS` specifies a targeted scope, resolve commands from CLAUDE.md (see `verification.md` Step 1), then run only the requested checks, passing `--no-stamp` (a partial set must never stamp — `verification.md` Step 2):

- **By check type** (`types`, `lint`, `unit`, etc.) — run only the specified checks
- **By path** — scope test commands to the given file or directory
- **By pattern** — pass the pattern to the test runner's filter flag (e.g., `jest --testNamePattern`, `pytest -k`)
- **`affected`** — read the changed-file set with one plain command, `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --changed-files --integration-branch {ref}` (`{ref}` via `_shared/integration-branch.md`; the stamp's `fullSha` wins whenever it is still an ancestor of HEAD, pipeline or not; `--integration-branch` is the fallback (with no stamp and no divergence from it, effectively the working tree alone) — an unresolvable base is exit 1, never a silent empty set: stop and report the runner's message, and offer the standard suite instead of running a narrowed set on a guess), then scope tests to those files and their dependents. Never hand-roll `git diff --name-only` — it is empty for every committed pipeline diff.

> **Parallel execution:** When running multiple check types (e.g., `/claude-tweaks:test types lint`), run them as parallel Bash calls — they are independent.

### QA mode (`qa`)

Run QA story validation only — types, lint, and tests are skipped.

1. **Discover stories:** Glob `stories/*.yaml` (or `STORIES_DIR` from pipeline context, or `dir=` argument).
2. **No stories found** — report and stop, using the canonical message from `qa-procedures.md`'s Story Check section (that file owns the wording; do not restate it separately here).
3. **Stories found:**
   a. Auto-detect the dev server URL using the shared procedure from `dev-url-detection.md` in `skills/_shared/` (or use `DEV_URL` from pipeline context).
   b. If no dev server is reachable and none can be started — stop and report: "QA validation failed — no dev server available."
   c. Run the QA procedures from `qa-procedures.md` in this skill's directory (which references `qa-prompts.md` for Phase 3 dispatch and `qa-reporting.md` for Phases 4-5.5).
   d. Pass through any QA-specific arguments: `tag=`, `story=`, `retry=`, `affected`, `journey=`, etc.
   e. **Journey filter:** When `journey={name}` is present, pass it to the QA procedures. This filters stories to only those with `journey: {name}` in their YAML — enabling journey-scoped test execution.

#### Affected filtering (`qa affected`)

When the `affected` argument is present, filter stories to only those whose `source_files` overlap the changed-file set:

1. Read the changed-file set: `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --changed-files --integration-branch {ref}` — the same `{base, files}` the `affected` argument and the pipeline story filter read, so the three never disagree. Exit 1 means no base resolved — stop and report the runner's stderr message verbatim ("`qa affected` could not resolve a base: {message}") instead of continuing; never read it as an empty set or as "No QA stories affected".
2. Read each discovered story YAML file and collect the `source_files` array from every story. Stories without a `source_files` field or with an empty array are excluded from affected runs. (This is the explicit-argument rule only: the automatic pipeline selection above always includes a story with no `source_files`, so a brand-new UI story is never dropped — #808.)
3. Filter to stories where at least one entry in `source_files` appears in the changed files list.
4. If no stories match, report: "No QA stories affected by current changes." and stop.
5. Run only the matched stories through the QA procedures.

**Composable with other filters:** `affected` can be combined with other QA arguments. For example, `/claude-tweaks:test qa affected tag=smoke` runs only affected stories that also have the `smoke` tag. Apply `affected` filtering first, then apply any additional filters (`tag=`, `story=`, etc.) on the resulting subset.

### All mode (`all`)

Run the full standard suite (types + lint + tests) AND QA story validation. Equivalent to running `/claude-tweaks:test` followed by `/claude-tweaks:test qa`.

1. Run the shared verification procedure from `verification.md` (types, lint, tests).
2. If verification passes and stories exist, run QA mode (see above).
3. If verification fails, stop — do not run QA on broken code.

### Skip-QA mode (`skip-qa`)

Run types/lint/tests only — skip QA story validation entirely, even when stories exist. Used by `/claude-tweaks:flow`'s polish-phase re-verify gate to avoid re-running browser QA after stylistic-only changes.

1. Run the shared verification procedure from `verification.md` (types, lint, tests).
2. **Do not** run QA, regardless of whether stories exist or `STORIES_DIR` is set.
3. The Design CLI gate (Step 1.5) still runs — `skip-qa` skips QA stories, not the deterministic CLI check.

**Composability:** `skip-qa` can be combined with targeted scope arguments (e.g., `/claude-tweaks:test types skip-qa` runs only type checking; `skip-qa` is redundant in that case but harmless).

When invoked with `skip-qa` and verification passes, set `TEST_PASSED=true` and report (see Step 1.5 below for the `Design CLI:` line, which the Design CLI Gate still runs and reports on even in `skip-qa` mode):

```
Verification: passed (types + lint + tests). QA: skipped (skip-qa).
Design CLI: {pass/fail/skipped} ({N findings: Y warning, Z advisory} or {skip reason})
Set TEST_PASSED=true.
```

## Step 1.5: Design CLI Gate (Impeccable)

After types/lint/tests pass (or if they were skipped via `VERIFICATION_PASSED`), invoke the design wrapper to run the deterministic Impeccable CLI check on changed frontend files. This catches design anti-patterns (default-AI gradients, hard-coded pixel values, etc.) without LLM cost.

**Skip this step entirely when:**
- The mode is `qa` (QA-only run; design gate has no opinion on QA stories)
- The user-supplied scope was a single check type (`types`, `lint`, `unit`, `integration`, `e2e`) — these targeted runs do not include the design gate

Otherwise, read `design-gate.md` in this skill's directory for the full invocation, result-handling table, per-mode reporting variants, and the Design Findings template.

## Step 2: Report

Present results using the format from `verification.md` Step 3 for standard checks. For QA and pipeline results, render the appropriate template from `report-templates.md` in this skill's directory.

| Mode | Template in `report-templates.md` |
|------|----------------------------------|
| Standard suite (no args) | `## Standard mode result` |
| QA-only (`qa`) | `## QA mode result` (includes Actions Performed sub-table) |
| Full suite + QA (`all`) | `## All mode result` |
| Pipeline (`VERIFICATION_PASSED=true`, no stories) | `## Pipeline result (VERIFICATION_PASSED + no stories)` |
| Pipeline (`VERIFICATION_PASSED=true`, stories exist) | `## Pipeline result (VERIFICATION_PASSED + stories)` |

Read `report-templates.md` for the full templates, the `PASS_WITH_CAVEATS` propagation rule, the Actions Performed format, and the canonical `TEST_PASSED` semantics.

## Step 3: Fix Mode (Optional)

If tests fail and the failures look straightforward (type errors, lint violations, simple test failures), read `fix-mode.md` in this skill's directory for the full procedure. Auto mode routes per `_shared/auto-mode-contract.md` — auto-fix and re-verify, or stage the fix to `staged/test-fix-{n}.patch` per `_shared/staged-patch.md`, validated with `git apply --check` before logging. Interactive mode asks via `AskUserQuestion`, with reproduce-first debugging for behavioral and QA failures.

**Phase exit (`worktree` mode, `integration-model: pr-first` — `_shared/integration-model.md`):** push the branch and flip this phase's PR checklist row — `_shared/git-discipline.md`'s Phase-exit push section and `_shared/pr-checklist-refresh.md`'s Phase-checklist update section. A no-op under `local-merge` or `current-branch` mode.

## Next Actions

Pick the row matching the mode just completed:

| Mode + outcome | Next |
|---|---|
| Standard / All / QA passed (or PASS_WITH_CAVEATS) | Genuine choice — see below |
| Verification failed (types/lint/tests) | Fix the failures, then re-run `/claude-tweaks:test` |
| QA failed | Investigate failures (Fix Mode option 1), then `/claude-tweaks:test qa retry={RUN_DIR}` |

**On any pass outcome** (the first row), the "plain code review" and "code + visual review" rows are not two separate situations — they're two alternative commands for the same outcome. Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention), bolding whichever matches the current run's actual signal and suffixing it `(recommended)` — UI files changed AND browser available → the full-review line; otherwise → the plain-review line:

`/claude-tweaks:review {spec}` — code review quality gate (when no UI change or no browser)
`/claude-tweaks:review {spec} full` — code + visual review (when UI changed and a browser is available)

**The other two rows are not a user choice** — "Verification failed" and "QA failed" are single deterministic next steps. Leave them as plain prose instructions in the table above; they do not render as markdown command lines.

## Component-Skill Contract

`/claude-tweaks:test` is invoked by `/claude-tweaks:flow` between build and review, and by `/claude-tweaks:review` Step 1.5 as the test gate. Parent invocation is signaled by the `$PIPELINE_RUN_DIR` env var — the primary signal. `/claude-tweaks:review`'s standalone auto-trigger (Step 1.5, "No recent pass" branch — no pipeline run dir exists yet) may pass `--source review` as an explicit fallback. When `$PIPELINE_RUN_DIR` is set, omit the `## Next Actions` block — the parent owns the handoff. When invoked directly by a user, render Next Actions as documented. The skip-qa flag and qa-mode args are user-facing; parents pass `skip-qa` during the `/flow` polish re-verify gate and never invoke qa mode themselves (qa runs at its own pipeline stage).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Running the full suite when only types were requested | The user asked for a targeted check |
| Auto-fixing test failures without asking | They can mask deeper issues — lint/type auto-fix with re-verification is safe, tests need investigation |
| Skipping CLAUDE.md command lookup | Projects have specific test commands — don't guess |
| Running tests before type checking | Type errors cause test failures — fail fast with the cheapest check |
| Ignoring lint warnings | Warnings accumulate into noise — surface them |
| Running QA on broken code | Verification must pass first — types/lint/tests gate QA in `all` mode |
| Auto-fixing QA failures | They mean broken user-facing behavior — investigate, don't patch |
| Patching a behavioral test/QA failure without reproducing the cause | Per `_shared/reproduce-first-discipline.md`: confirm the repro, root-cause via `/superpowers:systematic-debugging`, then fix, then walk the causal-depth chain. Never loosen an assertion or selector to make red go green. |
| Skipping QA when stories exist in pipeline | If `VERIFICATION_PASSED` is set and stories exist, QA must run |
| Treating Design CLI skip as a test failure | It skips legitimately (backend project, Impeccable not installed, kill-switch disabled) — only `result: fail` is a gate failure. |
| Auto-fixing Design CLI findings | They require human judgment — surface, never auto-modify code. The Phase 1 wrapper's `test` mode is read-only; Phase 2 `polish` is its code-modifying counterpart, invoked by `/flow`. |
| Using `skip-qa` outside the re-verify context | For `/flow`'s re-verify gate, skipping browser QA after stylistic polish. Standalone use is rarely useful — prefer the default suite, which runs QA when stories exist. |
| Skipping the Design CLI gate when `skip-qa` is set | Orthogonal to QA — it must still run. See Step 1.5. |
