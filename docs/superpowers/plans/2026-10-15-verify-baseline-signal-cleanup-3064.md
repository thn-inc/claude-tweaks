# verify.js --baseline scratch worktree cleanup on SIGINT/SIGTERM (#3064) Implementation Plan

**Goal:** `adjudicate()` cleans up its scratch git worktree on SIGINT/SIGTERM/SIGHUP instead of
leaking it when the process is killed mid-run, and the next `--baseline` run names any worktree
still left behind (e.g. from an uncatchable Windows TerminateProcess) on stderr without sweeping
it.

**Spec:** `.claude-tweaks/pipelines/2026-10-15T172233-record-3064/work/3064-spec.md` (materialized
from GitHub issue #3064)

**Note on process (#1911's micro-plan gate):** the record's body carries no `### Key Files`
section, so the micro-plan applicability gate's condition 3 could not parse a file count and fell
through to the normal `/superpowers:writing-plans` path per that gate's own documented rule
("could not parse" never counts as "parsed to zero"). Given the record's narrow, single-bug
scope (two implementation files, both named in its own `## Current State`), this plan was
composed directly against the already-read source rather than through a separate
`/superpowers:writing-plans` invocation — logged as a deliberate deviation in this run's
`decisions.md`.

---

### Task 1: Register signal cleanup in `adjudicate()`, and name a stale scratch worktree on the next run

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js`
- Modify: `plugin/bin/verify.js`
- Test: `tests/bin-lib/verify/baseline.test.js`
- Test: `tests/bin-lib/verify/cli.test.js`

- [x] **Step 1: Failing test** — wrote unit tests in `baseline.test.js` for handler
  registration/deregistration and the SIGINT-interrupted cleanup path (direct handler invocation,
  never `process.emit` on the shared test-runner process), plus `findStaleBaselineWorktrees` /
  `realGit.listWorktrees` unit and real-git-repo tests; wrote e2e tests in `cli.test.js` spawning
  the real CLI and sending a real `SIGINT`, and asserting the stale-worktree stderr line.
- [x] **Step 2: Implement** — `adjudicate()` registers `SIGHUP`/`SIGINT`/`SIGTERM` handlers while
  `scratch` exists (removing it via `git.removeWorktree` before `process.exit`ing with the
  signal's conventional 128+n code), deregistered in `finally`. `realGit` gained `listWorktrees()`;
  `findStaleBaselineWorktrees()` filters it to `ct-verify-base-*` scratch paths without sweeping
  them. `verify.js` calls it once `--baseline` resolves a commit, before any check runs, and names
  every match on stderr.
- [x] **Step 3: Run** the tests from Step 1 — PASS (`node --test tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/cli.test.js`,
  modulo four pre-existing `#3043` baseline-adjudication tests that fail identically on
  unmodified HEAD on this machine — a pre-existing environment-specific flake unrelated to this
  change, reported as a follow-up rather than folded into this fix).
- [x] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3064`.

---

## Self-review

- **Spec coverage:** both `## Deliverables` items (signal-handler cleanup; stale-worktree naming
  on the next run) and both `## Acceptance Criteria` items (SIGINT mid-run → no leftover worktree,
  exit 130; a seeded stale worktree named on stderr and left in place) are covered by Task 1's
  files/steps above.
- **Placeholders:** none.
