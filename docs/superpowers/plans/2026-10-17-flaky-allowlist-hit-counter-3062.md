# Feed verify.js --baseline's flaky verdicts into the flaky-allowlist hit counter (#3062) Implementation Plan

**Goal:** `verify.js --baseline` classifies a failing test file as `baseline-flaky` but never counts
that verdict into the count stamp's `flakyHits`, and never stages a proposal to add a repeatedly
baseline-flaky file to `.claude-tweaks/verify-scope.json`'s `flaky.files`. A file that keeps
passing only in isolation is invisible beyond each run's own CAVEAT line.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T080306-record-3062/work/3062-spec.md` (materialized
from GitHub issue #3062)

---

### Task 1: Count baseline-flaky files into `flakyHits` and stage an escalation proposal

**Files:**
- Modify: `plugin/bin/lib/verify/count-stamp.js` (`nextFlakyHits`, `flakyEscalations`, `escalationCaveatLine`)
- Modify: `plugin/bin/verify.js` (feed `baselineAdjudicated.flakyPassed` into the hit counter; stage
  a `flaky-allowlist-{slug}` proposal via `writeStagedItem` + log a `STAGED` decision when a
  non-allowlisted file reaches the escalation threshold)
- Modify: `plugin/skills/wrap-up/leftover-routing.md` (route an `onAllowlist: false` escalation as
  "already staged by the runner, nothing to route" rather than filing a contradictory leftover)
- Test: `tests/bin-lib/verify/count-stamp.test.js`
- Test: `tests/bin-lib/verify/cli.test.js`

- [x] **Step 1: Failing test.** Add unit tests to `tests/bin-lib/verify/count-stamp.test.js`
  (`nextFlakyHits` accumulates a non-allowlisted flagged file across runs instead of resetting to
  1; drops a flagged file the moment a later run stops flagging it; `flakyEscalations` marks
  `onAllowlist` true/false correctly including glob patterns and a `null` allowlist; a new
  `escalationCaveatLine` wording for `onAllowlist: false`) and one CLI integration test to
  `tests/bin-lib/verify/cli.test.js` (a file baseline-flaky across 5 runs accumulates `flakyHits`
  to 5 with no prior `flaky.files` declaration, escalates on the 5th with the new CAVEAT wording,
  stages `staged/flaky-allowlist-{slug}.md`, logs a `STAGED` decisions.md entry, and never writes
  `.claude-tweaks/verify-scope.json`). Confirmed red against HEAD (`e6e77ed9c`) — 4 assertions fail
  with the pre-fix shape (`flakyHits` stuck at 1 instead of accumulating to 2; `flakyEscalations`
  returns no `onAllowlist` field; `escalationCaveatLine` renders the old "retried…fix or remove"
  wording for a non-allowlisted file).
- [x] **Step 2: Implement.**
  - `nextFlakyHits(previous, flaggedFiles, allowlist)` (renamed from `retriedFiles`): the keep-set
    carried into the next run is `allowlist` UNION this run's flagged files, not `allowlist` alone
    — otherwise a non-allowlisted flagged file is pruned back to zero every run and can never
    reach the escalation threshold.
  - `flakyEscalations(hits, allowlist)` now takes the allowlist and adds `onAllowlist` (glob-matched
    via `blast-radius.js`'s `globToRegExp`) to each escalation entry.
  - `escalationCaveatLine` renders the existing "retried N times — file a fix or remove it" wording
    when `onAllowlist` is true, and a new "baseline-flaky N times — not on flaky.files; a staged
    proposal to add it is pending review" wording when false.
  - `verify.js`: union `retriedFiles` with `baselineAdjudicated.flakyPassed` (when adjudication was
    eligible) into `flaggedFiles` before calling `nextFlakyHits`/`flakyEscalations`. For each
    escalation with `onAllowlist: false`, write a staged proposal (`writeStagedItem`, id
    `flaky-allowlist-{slug}`) naming the file, hit count, and the suite/retry-template context, and
    log a `STAGED` decision to `decisions.md` — best-effort, a staging failure never fails the run.
  - `leftover-routing.md`: document that an `onAllowlist: false` entry was already staged by the
    runner itself and should be skipped, never routed as a leftover asking to remove a `flaky.files`
    entry that was never added.
- [x] **Step 3: Run.** `node --test tests/bin-lib/verify/count-stamp.test.js tests/bin-lib/verify/cli.test.js`
  — 19/19 and 101/101 pass. Re-verified by reverting `count-stamp.js`/`verify.js` to HEAD and
  confirming the 4 new unit assertions fail as expected, then restoring the fix and re-confirming
  green.
- [x] **Step 4: Commit.** One commit, the five files above staged by explicit path. Message:
  `Feed verify.js --baseline's flaky verdicts into the flaky-allowlist hit counter`, blank line,
  `refs #3062`, blank line, `Claude-Session:` trailer. Never a closing keyword.

---

## Self-review

- **Spec coverage:** Deliverable 1 (count baseline-flaky files into `flakyHits`) is `nextFlakyHits`'s
  union-keep-set change plus `verify.js`'s `flaggedFiles` union. Deliverable 2 (stage, never apply
  silently) is `verify.js`'s `writeStagedItem` call gated on `onAllowlist: false`. AC1 (two
  adjudicated runs hold the count at 2) and AC2 (a staged proposal at threshold, `verify-scope.json`
  untouched) are both pinned by the new CLI integration test.
- **Placeholders:** none.
