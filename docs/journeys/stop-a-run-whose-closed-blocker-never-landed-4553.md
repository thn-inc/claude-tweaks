---
files:
  - plugin/bin/lib/preflight-records/blocker-landing.js
  - plugin/bin/preflight-records.js
  - plugin/bin/materialize.js
  - plugin/skills/flow/validation.md
  - plugin/skills/flow/multispec-dependency-ordering.md
  - plugin/skills/flow/multispec-preflight-failure.md
  - plugin/skills/flow/multi-spec.md
---

# Stop a Run Whose Closed Blocker Never Landed

**Persona:** a maintainer or operator running `/claude-tweaks:flow #N` (or a multi-record batch, directly or through `/claude-tweaks:dispatch`) on a record that carries `blocked-by` prerequisites outside the run.
**Goal:** never build on an integration-branch base that is missing a prerequisite's code just because the prerequisite's issue is closed. A blocker closed by a PR merged into the wrong branch must stop the run before anything is claimed.
**Entry point:** `/flow` Step 2's new substep 2.7b for a run invoked with one record target; multi-spec Validation step 3 for a batch. Both run before Step 2.8 claims.
**Success state:**
- A still-`open` out-of-run blocker stops the run before Step 2.8 claims anything. So does an `unlanded` one, whose closing commit is not reachable from `origin/{integration-branch}`.
- An `unlanded` stop prints a card naming the record, the blocker, the closing commit and the integration branch, with two paste-ready escapes.
- A blocker whose landing cannot be judged lets the run proceed and leaves one `SKIP` line per blocker in `decisions.md`.

## Steps

### 1. The pre-flight decides whether a landing call is needed — 2.7b's skips
- **URL:** `plugin/skills/flow/validation.md` `## 2.7b`, steps 1–3
- **Action:** 2.7b skips itself, with no call and no log line, in these cases:
  - under `work-backend: local-files`;
  - for a step list with neither `build` nor `test`, such as dispatch's `review,polish,wrap-up` second call;
  - for an unresolved topic name.

  Otherwise it reads `work-links`. Under `body-text`, Step 1's `materialize.js --check` envelope reporting `bodyBlockedBy: []` means there is nothing to check, so no `preflight-records.js` call is made. Under `native` the call always runs, because it is how the record's blockers are read.
- **Should feel:** Free for a record with no prerequisites, so that path costs nothing.
- **Should understand:** Only out-of-run blockers are checked. A blocker that is itself one of the run's records is built inside the same run.
- **Red flags:** A `preflight-records.js` call for a body-text record with `bodyBlockedBy: []`. Also: 2.7b re-running on a resumed `review,polish,wrap-up` call.

### 2. One call judges every out-of-run blocker against the integration branch
- **URL:** `plugin/bin/preflight-records.js` `--blocker-landing`; `plugin/bin/lib/preflight-records/blocker-landing.js`
- **Action:** `/flow` runs `node "${CLAUDE_PLUGIN_ROOT}/bin/preflight-records.js" {n} --blocker-landing --integration-branch "$INTEGRATION_BRANCH"`. It reads `records["{n}"].blockerLanding: [{blocker, verdict, commit, via}]`. The candidate commits are the closer PR's merge commit or closing commit, plus every merged closing-PR reference. Each is compared against `origin/{integration-branch}` through the REST compare API, with no local fetch. `behind` or `identical` means reachable.
- **Should feel:** Trustworthy. A blocker whose fix reached the integration branch through any merged PR reads `landed`, even if the PR that closed the issue went to `production`.
- **Should understand:** The five verdicts are `open`, `landed`, `unlanded`, `not-applicable` (closed `NOT_PLANNED`/`DUPLICATE`, so no code) and `undetermined`. An unresolvable blocker number reads `undetermined`/`not-found`. A blocker query that fails as a whole exits 1 and is never `undetermined`. A malformed response, meaning an alias missing with no NOT_FOUND naming it, counts as a whole-query failure too. A `Blocked by #0` line is no valid issue number and exits 2 before any blocker call, so it stops the run rather than retrying. A closing-PR list GitHub cut off at ten, with no candidate reachable, reads `undetermined`/`references-truncated`, never `unlanded`. A compare call that fails (a wrong integration branch, a 403, a rate limit) leaves that blocker `undetermined` and prints one stderr line naming the commit and the cause.
- **Red flags:** A failed query read as "no blockers". A blocker reported `landed` when no candidate commit compared `behind` or `identical`.

### 3. An open or unlanded blocker stops the run before claiming
- **URL:** `plugin/skills/flow/multispec-dependency-ordering.md` out-of-run verdict table and unlanded card
- **Action:** `open` and `unlanded` are hard fails before Step 2.8 claims. The unlanded card names `#{n}`, `#{blocker}`, `{commit}` and `origin/{integration-branch}`. It gives two escapes, one command per line:
  1. Land it: `git fetch origin {integration-branch} {commit}`, `git switch`, `git merge --ff-only`, `git merge {commit}`, `git push`.
  2. Remove the `blocked-by` edge, natively or by deleting the body's `Blocked by #{blocker}` line.
- **Should feel:** Decisive and actionable. The stop names exactly what is missing and how to fix it from a stale checkout.
- **Should understand:** A cherry-picked landing has a different sha and reads `unlanded`. Confirm the cherry-pick by hand, then take escape 2. Escape 1 merges the commit's whole history; to land only the fix, cherry-pick it and take escape 2.
- **Red flags:** A claim, `bot:in-progress` label or draft PR created for a record whose blocker is `open` or `unlanded`. A card with no paste-ready command.

### 4. An undetermined blocker proceeds, with one SKIP line per blocker
- **URL:** `plugin/skills/flow/multispec-dependency-ordering.md` (`undetermined` row and its `--text-file` SKIP line); `validation.md` 2.7b step 7
- **Action:** The run proceeds. After Step 3's Manifesto write or adoption, or after express-entry's Bind on the express route, `/flow` writes one `SKIP … — Step 2 blocker landing (undetermined)` line per blocker via `log-decision.js --text-file`. It writes them exactly once. Under `interactive` mode it states each verdict in the conversation instead.
- **Should feel:** Like an honest footnote. The run is not blocked on what it cannot check, and the trace is there.
- **Should understand:** `undetermined` is per-blocker only. A manually closed issue with no closing-PR link typically reads `undetermined`.
- **Red flags:** An `undetermined` verdict that stops the run, or one that leaves no `SKIP` line in an `auto` run.

### 5. Without `gh`, an open blocker still stops
- **URL:** `plugin/skills/flow/multispec-preflight-failure.md` `**Blocker landing.**`
- **Action:**
  1. Under `--records-json`, the first call lists each out-of-run blocker as `undetermined`/`records-json`.
  2. `/flow` fetches each listed blocker over MCP `issue_read` and writes `{ "{blocker}": {"state", "stateReason"} }` with the Write tool.
  3. It re-runs the call with `--blocker-states-json {file}`.

  On that second envelope an open blocker reads `open` (a hard fail), a `NOT_PLANNED`/`DUPLICATE` one `not-applicable`, and every other closed one `undetermined`.
- **Should feel:** Equivalent to the `gh` path for the case that matters most: an open prerequisite.
- **Should understand:** A blocker `issue_read` cannot fetch is a STOP naming it (fail-closed), because the states file cannot express not-found. On the `gh` path the same blocker reads `undetermined`/`not-found`. A states-file problem exits 2 and stops at once.
- **Red flags:** A gh-absent run that proceeds past an open out-of-run blocker.

## Origin
- Created during #4553's build (run 2026-10-31T234545-record-4553): `blocker-landing.js`, `preflight-records.js --blocker-landing` / `--blocker-states-json`, `materialize.js --check`'s `bodyBlockedBy`, multi-spec Validation step 3, and single-record substep 2.7b.
- Related: `run-a-batch-whose-record-needs-a-merged-prerequisite-2733.md` (the in-run merge-state gate, riding the same pre-flight call), `handle-a-failed-multispec-preflight-3351.md` (exit 1/2 handling).
