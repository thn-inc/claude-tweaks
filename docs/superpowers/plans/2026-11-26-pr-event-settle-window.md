# PR-Event Settle Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the window in which a PR reads green at the merge gate before GitHub has created its `pull_request` workflow run, without parking path-filtered PRs (record #3468).

**Architecture:** One pure rule in `plugin/bin/lib/pr-checks/classify.js` (`prEventSettle`, wired into `classifyRollup` as an opt-in `now` input): with PR CI and no `pull_request`/`pull_request_target` head run, the PR reads `pending` until 60 seconds after the later of the PR's own `createdAt` and the earliest head run's `createdAt` (no head run at all: the head commit's committer date, still capped from below by the PR's `createdAt`). Every production `classifyRollup` caller passes a clock, the PR's `createdAt` (added to each PR view read), and, when the head-runs list is empty, the committer date. `_shared/pr-first-merge.md` Step 2.5 (the prose authority) gains the rule, with its detail in the appendix because the composed merge bundle has 54 bytes of headroom.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T194810-record-3468/work/3468-spec.md` (the record body's second **Decision**, plan-review round 1, chose Reading B: the PR's `createdAt` bounds the window start from below)

Scope keywords: prEventSettle, classifyRollup, HEAD_RUN_FIELDS, GATE_FIELDS

## Global Constraints

- Window: **60 seconds** (`PR_EVENT_SETTLE_MS = 60000`), ending 60 s after the **latest** known of: the PR's own `createdAt`, and the earliest workflow run GitHub created for the head sha under **any** event (when no run exists at all, the head commit's committer date stands in for the run time). Anchor = `max(prCreatedAt, runAnchor)`. Family rule (record body): any further edge here (a reader that builds its own PR view, a REST- or GraphQL-shaped run row, a clock or timestamp source) follows the same rule.
- PR events are exactly `PR_EVENTS` (`pull_request`, `pull_request_target`) — reuse the existing constant, never a second list.
- The rule applies only when the repo has PR CI (`hasPrCi`). After the window, absence of a PR-event run means none applies (the path-filtered case) and the existing rollup and head-run rules decide.
- Rejected design (do not implement): matching workflow path filters against the PR's changed files.
- Fail closed: an unreadable input keeps the PR `pending` (`until: null`): a missing or unparseable PR `createdAt`, or no parseable `createdAt`/`created_at` on any head run together with no parseable committer date. It never reads green, and the existing pending bound parks it. A failed committer-date read is not a stop and not `read-failed` — it only yields the null anchor.
- Red still wins: a failing check is `red` regardless of the settle window (the rule sits in the pending stage of `classifyRollup`, after the red check).
- `classifyRollup` stays pure: the clock is an input (`now`, epoch ms). The rule is inactive when `now` is not a finite number or `headRuns` is not an array, so existing direct callers in tests keep today's behavior; every production caller passes `now`.
- Composed merge bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`) must stay at or under `RAIL_BYTES` = 52,500 in every condition combination; today's max is 52,446 (54 B headroom). Measure: `node -e "const m=require('./plugin/bin/lib/skill-audit/context-cost.js');console.log(Math.max(...m.composedBytesReport(require('path').resolve('plugin')).filter((r)=>r.step==='merge').map((r)=>r.max)))"`. Make room by moving an existing lazy passage to `pr-first-merge-appendix.md` behind a one-line pointer, never by cutting content; keep every existing conformance pin green.
- Shell snippets in skill prose follow `_shared/scratch-worktree.md` §7: no `--jq` program inside the bounded-watch loop, literal placeholders, `node -e` with argv paths.
- `.claude/skills/prose-code-twin-pin/SKILL.md` governs the prose/code pair: "If a twin exists, does a conformance test pin the two equal? … a test only asserting that individual literal strings are *present* somewhere is not" a pin — so the prose's `60 seconds` is pinned against `PR_EVENT_SETTLE_MS / 1000`, and the watch's `prEventSettle` call is pinned by a test that runs the real classifier.
- `.claude/skills/gh-api-module-pattern/SKILL.md` governs the new `gh api` reads: use each module's existing injectable `deps.gh` runner and its existing timeout/options; never a new `execFileSync`.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires. Don't reformat or "improve" adjacent code.
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #3468`.

## Review Focus

- A head run list whose rows lack `createdAt` (an older caller or a fixture built before this change) — must read pending (fail closed), not green; Task 1 test `prEventSettle: rows with no parseable createdAt fall back to the committer date, else fail closed`.
- A `pull_request_target`-only PR workflow — counts as the PR-event run; Task 1 test `a pull_request_target head run ends the settle rule`.
- A REST `actions/runs` row (`created_at`, `event`) appended by the ready-run read — counts for both anchor and event; Task 1 test `snake_case created_at rows anchor the window`.
- Red during the window — still red; Task 1 test `red wins inside the settle window`.
- A PR opened after its head was pushed (Reading B): the window starts at the PR's `createdAt`; Task 1 test `AC1.1: a PR opened after its head was pushed: the window starts at the PR's createdAt`; a PR view without `createdAt` fails closed (Task 1 `a missing or unparseable prCreatedAt fails closed`, Tasks 2-3 view tests).
- Exactly at the boundary (`now === anchor + 60000`) — not settling (window is `now < until`); Task 1 test `the window closes at exactly 60 s`.

---

### Task 1: The settle rule in classify.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/pr-checks/classify.js` (constants block near `PR_EVENTS`/`HEAD_RUN_FIELDS`; `classifyRollup` pending stage; `module.exports`)
- Modify: `plugin/skills/_shared/pr-first-merge.md` (the two `gh run list … --json databaseId,name,workflowName,status,conclusion,url,startedAt` field lists: the Step 2.5 head-run read and the bounded watch's `0)` arm)
- Modify: `plugin/skills/release/execute.md` (its `gh run list … --limit 100 --json …` line)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/pr-checks/` row: name `prEventSettle`/`PR_EVENT_SETTLE_MS`, #3468; and the `pr-checks.js` command row: the `prEventSettle?` envelope field — Task 2 adds it)
- Test: `tests/bin-lib/pr-checks/classify.test.js`
- Test: `tests/pr-check-gate-conformance.test.js` (run only — its HEAD_RUN_FIELDS prose pin reads the lines this task updates)
- Test: `tests/bin-lib/console/backfill.test.js` (run only, no edit — Check B hit: it names classifyRollup only inside a decisions.md string fixture)

**Interfaces:**
- Produces: `PR_EVENT_SETTLE_MS` (number, 60000); `prEventSettle({ hasPrCi, headRuns, headCommittedAt, prCreatedAt, now }) -> { settling: boolean, until: string|null }` (`until` an ISO string, null when `prCreatedAt` or the run/commit anchor does not parse); `classifyRollup` accepts `now` (epoch ms), `headCommittedAt` (ISO string or null) and `prCreatedAt` (ISO string or null) and, when settling, returns `state: 'pending'` with `prEventSettle: { until }`; `HEAD_RUN_FIELDS === 'databaseId,name,workflowName,status,conclusion,url,startedAt,event,createdAt'`.
- Consumer classification (Consumer-enumeration check; `git grep -n classifyRollup -- plugin`): `pr-checks.js`, `lib/driver/merge.js`, `lib/learned-skills/drain.js` are pick-one verdict consumers (they read one state) — each gets the inputs (clock, PR `createdAt`, committer date) in Tasks 2-3. `HEAD_RUN_FIELDS` consumers (`git grep -n HEAD_RUN_FIELDS -- plugin tests`): the three callers' `gh run list` reads pick up the new fields automatically; the prose pins in `tests/pr-check-gate-conformance.test.js` and `tests/merge-verification-gate-conformance.test.js` read the prose lines this task updates.

- [ ] **Step 1: Write the failing tests** in `classify.test.js` (fixture: `const prRun = (createdAt) => ({ name: 'test', workflowName: 'test', status: 'completed', conclusion: 'success', event: 'pull_request', createdAt })`, `const pushRun = (createdAt) => ({ ...prRun(createdAt), name: 'track', workflowName: 'track', event: 'push' })`, `T0 = Date.parse('2026-11-26T10:00:00Z')`, green rollup `[run('track', 'COMPLETED', 'SUCCESS')]`):
  - `AC1.1: a completed push run with no pull_request run yet reads pending inside the 60 s window` — `classifyRollup({ rollup, headRefOid: HEAD, localHead: HEAD, hasPrCi: true, headRuns: [pushRun('2026-11-26T10:00:00Z')], prCreatedAt: '2026-11-26T09:59:00Z', now: T0 + 30000 })` (every test below passes this `prCreatedAt` unless it says otherwise) → `state 'pending'`, `prEventSettle.until === '2026-11-26T10:01:00.000Z'`.
  - `AC2.1: a path-filtered PR (push runs only) reads green once the window has passed` — same input, `now: T0 + 60001` → `state 'green'`, no `prEventSettle` key.
  - `the window closes at exactly 60 s` — `now: T0 + 60000` → `green`.
  - `a pull_request head run ends the settle rule` and `a pull_request_target head run ends the settle rule` — headRuns `[pushRun(..), { ...prRun(..), event: 'pull_request_target' }]`, `now: T0 + 1000` → `green`.
  - `the window anchors on the earliest run under any event` — runs created at 10:00:20 and 10:00:05 (both push): `now` 10:01:06 → `green` (window ended 10:01:05); `now` 10:01:04 → `pending`; and with only the 10:00:20 run, `now` 10:01:06 → `pending` (window ends 10:01:20).
  - `AC1.1: a PR opened after its head was pushed: the window starts at the PR's createdAt` — push run created 10:00:00, `prCreatedAt: '2026-11-26T10:05:00Z'`, `now` 10:05:30 → `pending` with `until === '2026-11-26T10:06:00.000Z'`; `now` 10:06:01 → `green`.
  - `with no head run, the PR's createdAt still caps the committer date from below` — `headRuns: []`, `headCommittedAt` 10:00:00, `prCreatedAt` 10:05:00, `now` 10:05:30 → `pending`.
  - `a missing or unparseable prCreatedAt fails closed` — the AC1.1 input with `prCreatedAt` omitted, `null`, and `'not-a-date'`, `now` far past every window → `pending`, `prEventSettle.until === null`; with a `pull_request` head run added → `green` (the rule does not apply, so the input is not needed).
  - `snake_case created_at rows anchor the window` — a REST-shaped row `{ name: 'x', event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-11-26T10:00:00Z' }`.
  - `no head run at all: the committer date stands in` — non-empty green StatusContext rollup `[{ context: 'ext', state: 'SUCCESS' }]`, `headRuns: []`, `headCommittedAt: '2026-11-26T10:00:00Z'`, `now: T0 + 59000` → `pending`; `now: T0 + 61000` → `green`.
  - `prEventSettle: rows with no parseable createdAt fall back to the committer date, else fail closed` — runs without `createdAt`, `headCommittedAt: null` → `prEventSettle(...)` is `{ settling: true, until: null }` and `classifyRollup` → `pending` with `prEventSettle.until === null`.
  - `red wins inside the settle window` — a failing push run, `now: T0 + 1000` → `red`.
  - `without PR CI the settle rule never applies` — `hasPrCi: false`, push runs only, `now: T0` → `green`.
  - `the rule is inactive without a clock` — the AC1.1 input with `now` omitted → `green` (pins the opt-in).
  - Update `HEAD_RUN_FIELDS carries start time and id for newest-per-check ordering` to the new field list, and assert `PR_EVENT_SETTLE_MS === 60000`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: FAIL after Step 1 (`prEventSettle is not a function` / AC1.1 reads `green`).

- [ ] **Step 3: Implement** `PR_EVENT_SETTLE_MS`, `prEventSettle`, the `classifyRollup` wiring and the `HEAD_RUN_FIELDS` extension in `classify.js`. Anchor = minimum parseable `createdAt ?? created_at` over object rows; when none parses (including an empty list), `Date.parse(headCommittedAt)`; NaN → `{ settling: true, until: null }`. `settling = now < anchor + PR_EVENT_SETTLE_MS`. In `classifyRollup`, compute it after the red return and before the `pending/awaiting/held` return; a settling verdict joins that pending branch (add `extra.prEventSettle = { until }`). Update the module's header comment with one bullet for #3468. Update the three prose field lists to `HEAD_RUN_FIELDS`' new value.

- [ ] **Step 4: Run to verify they pass, plus the prose pins**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js tests/pr-check-gate-conformance.test.js tests/merge-verification-gate-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — `Add a 60-second PR-event settle window to classifyRollup — refs #3468`

### Task 2: pr-checks.js passes the clock and the committer date

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/pr-checks.js` (`classifyPr`: the `gh pr view` field list gains `createdAt`, `input`; header comment and `USAGE`; `gateEntry`'s pending text)
- Test: `tests/bin-lib/pr-checks/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `classifyRollup({ …, now, headCommittedAt, prCreatedAt })` and the `prEventSettle: { until }` envelope field.
- Produces: the CLI envelope carries `prEventSettle: { until }` on a settling pending read (passed through from the verdict); `gateEntry`'s pending text, when `pending` is empty and `prEventSettle` is present, reads `no pull_request run yet (settle window until {until ?? 'unknown'})`.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`, using its existing fake-`gh` harness and an injected `now`:
  - `AC1.1: --pr with a green push-only rollup inside the window prints pending with prEventSettle`.
  - `AC2.1: --pr with a green push-only rollup after the window prints green`.
  - `the PR view read requests createdAt and passes it as prCreatedAt` — the fake `gh pr view` call's `--json` list includes `createdAt`; a view with no `createdAt` and push-only runs prints `pending` with `prEventSettle.until === null`.
  - `an empty head-run list reads the committer date via gh api commits/{sha}` — asserts the call `['api', 'repos/{owner}/{repo}/commits/<HEAD>', '--jq', '.commit.committer.date']` is made only when the runs list is empty, and that a throwing read yields `pending` with `prEventSettle.until === null` (never `read-failed`).
  - `--run: the settle pending line names the window` — `decisions.md` text contains `no pull_request run yet (settle window until`.
  - Existing tests whose fixtures model an ordinary green PR (push-shaped head runs, no PR-event run) and now read pending: add a `pull_request` run to the fixture (or a clock past the window) so each keeps testing what it tested. Never loosen the rule to keep a fixture green.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/cli.test.js`
Expected: FAIL after Step 1, on the new tests.

- [ ] **Step 3: Implement** — add `createdAt` to the `gh pr view` field list, `input.prCreatedAt = view.createdAt ?? null`; `input.now = deps.now()`; when `Array.isArray(headRuns) && headRuns.length === 0` and `hasPrCi`, read the committer date with `deps.gh(['api', \`repos/{owner}/{repo}/commits/${headRefOid}\`, '--jq', '.commit.committer.date'])` (trimmed; a throw or empty output → `null`) into `input.headCommittedAt`. Extend `gateEntry`'s pending text as in Interfaces. Document `prEventSettle?` in the header comment's envelope list and in `USAGE`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/cli.test.js tests/bin-lib/pr-checks/classify.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — `Pass the clock and committer date from pr-checks.js — refs #3468`

### Task 3: The driver merge gate and the learned-skills drain pass the same inputs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js` (`GATE_FIELDS` gains `createdAt`; `gateReads`: committer-date read when `runs` is empty; `classify`: `now`, `headCommittedAt`, `prCreatedAt: read.createdAt`)
- Modify: `plugin/bin/lib/learned-skills/drain.js` (the per-PR `gh pr view` field list gains `createdAt`; `read`: committer-date read when `headRuns` is empty; `classifyPr`: `now`, `headCommittedAt`, `prCreatedAt: view.createdAt`)
- Test: `tests/bin-lib/driver/merge.test.js`, `tests/bin-lib/learned-skills/drain.test.js`

**Interfaces:**
- Consumes: Task 1's `classifyRollup` inputs.
- Produces: `gateReads` returns `{ read, runs, ready, committedAt }` (`committedAt` string or null; only read when `runs.length === 0`); `classify(ctx, read, runs, ready, { now, committedAt })` — a settling verdict is `{ kind: 'pending' }`, so the existing watch/arm/park routing applies unchanged (a settle window that never closes ends as the existing `checks-pending-timeout` park). drain's `classifyPr(view, headRuns, ready, { now, committedAt })` → `'pending'` while settling.

- [ ] **Step 1: Write the failing tests**
  - merge.test.js: `AC1.1: a push-only green rollup inside the settle window does not merge — it watches` (with `deps.now` inside the window, `merge-when-green`, `mergeStateStatus: CLEAN` → no `pr merge` call on the first read; a later read past the window with the same runs merges); `AC2.1: a path-filtered PR merges once its push runs completed and the window passed`; `an empty head-run list reads the committer date; a failed read keeps the gate pending, never a stop`; `the gate's PR view requests createdAt; a view without it and push-only runs watches, never merges`.
  - drain.test.js: `AC1.1: a learned-skills PR with push-only runs inside the window is pending`; `AC2.1: … after the window is green`; `AC1.1: a learned-skills PR opened after its head was pushed is pending until 60 s after its createdAt`.
  - Update existing fixtures that model an ordinary green PR without a PR-event run, as in Task 2 (add the `pull_request` run; never weaken the rule). Fake `gh` call sequences that now see the committer-date read get it added only where `runs` is empty.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/learned-skills/drain.test.js`
Expected: FAIL after Step 1, on the new tests.

- [ ] **Step 3: Implement** — merge.js reads the clock through its existing `deps.now`; the committer-date read uses `deps.gh(['api', \`repos/${ctx.repo}/commits/${read.headRefOid}\`, '--jq', '.commit.committer.date'])`, failure → `null`. Both `classify` call sites (the gate and the watch) pass the inputs. drain.js uses its `deps.now` and `deps.gh` with `repo` the same way.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/learned-skills/drain.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — `Apply the PR-event settle window in the driver merge gate and the drain — refs #3468`

### Task 4: Step 2.5 prose, the bounded watch, and the appendix

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 2.5: the "Read state first" `gh pr view … --json state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup` field list gains `createdAt` (the `{pr-created-at}` placeholder); a classification bullet; the `{head-committed-at}` read after the head-run read; the bounded watch `0)` arm's `PENDING_RUNS` line; the `RC=0` bullet)
- Modify: `plugin/skills/_shared/pr-first-merge-appendix.md` (a `## PR-event settle window (#3468)` section: the rule, the evidence and cost lines from the spec's Decision, the rejected path-filter design; plus whatever lazy passage is moved out of `pr-first-merge.md` for bytes)
- Test: `tests/merge-verification-gate-conformance.test.js`
- Modify: `plugin/skills/dispatch/settle-parked.md` (only if Step 5 finds a sentence the settle window makes false; it cites classifyRollup)
- Modify: `plugin/skills/wrap-up/review-console-interactive.md` (same condition)

**Interfaces:**
- Consumes: Task 1's `prEventSettle` and `PR_EVENT_SETTLE_MS`.
- Produces: prose placeholder `{head-committed-at}` — the head commit's committer date from `gh api repos/{owner}/{repo}/commits/{headRefOid} --jq .commit.committer.date`, read once in "Read state first" only when the head-run list is empty (empty string otherwise); and `{pr-created-at}`, the PR view's `createdAt` from the same "Read state first" read.

- [ ] **Step 1: Write the failing tests** in `merge-verification-gate-conformance.test.js`:
  - `#3468: Step 2.5 states the settle window and its code twin` — the Step 2.5 section contains a bullet naming `pull_request_target`, `prEventSettle`, and `${PR_EVENT_SETTLE_MS / 1000} seconds` (computed from the imported constant, not a literal), placed after the held bullet and before the empty-rollup bullet.
  - `#3468: Step 2.5's state read requests createdAt` — the Read-state-first `gh pr view` line's `--json` list includes `createdAt`.
  - `#3468: the watch 0) arm counts an open settle window as pending` — the `PENDING_RUNS=$(` line includes `prEventSettle(`, `{head-committed-at}` and `{pr-created-at}`; and an executable pin: extract that line's `node -e` program, run it with `node` against a temp runs file holding one push-only run created now (plus the real `classify.js` path, an empty committer-date argument and a PR created-at of one second ago), and assert it prints a non-zero count; with an empty PR created-at argument it still prints non-zero (fail closed); with a `pull_request` run added it prints `0`. Go-red control: the same harness on the line with `+c.prEventSettle(...)…` removed prints `0` for the push-only file.
  - `#3468: the RC=0 bullet resumes the watch on an open settle window` — the `RC=0` slice names the settle window alongside held runs.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/merge-verification-gate-conformance.test.js`
Expected: FAIL after Step 1, on the three new tests.

- [ ] **Step 3: Write the prose.** Classification bullet (short; detail lives in the appendix): with PR CI and no head run whose `event` is `pull_request`/`pull_request_target` → **pending** until 60 seconds after the later of `{pr-created-at}` and the earliest head run's `createdAt` (no head run: `{head-committed-at}`; any needed time unreadable: pending) — after that the other rules decide; code twin `classify.js`'s `prEventSettle`; why: appendix "PR-event settle window". Add `+c.prEventSettle({hasPrCi:true,headRuns:r,headCommittedAt:process.argv[3],prCreatedAt:process.argv[4],now:Date.now()}).settling` to the `PENDING_RUNS` sum, with `"{head-committed-at}"` and `"{pr-created-at}"` as its third and fourth arguments; extend the `RC=0` bullet's "not yet `completed` **or held**" clause with the open settle window. Then measure the composed bundle (Global Constraints command); if it exceeds 52,500, move an existing lazy passage to the appendix behind a one-line pointer until it fits, keeping every existing conformance pin green.

- [ ] **Step 4: Run to verify they pass, plus every pin that reads these files**

Run: `node --test tests/merge-verification-gate-conformance.test.js tests/pr-check-gate-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/budgets.test.js`
Then: `git grep -ln "pr-first-merge" -- tests` and run each listed file with `node --test`.
Expected: PASS, and the bundle-size command prints a value ≤ 52500.

- [ ] **Step 5: Behavior-change prose sweep.** `git grep -n -i "push-triggered\|partial rollup\|hasPullRequestCi\|classifyRollup" -- plugin/skills docs` (plan-audit Check B surfaced `plugin/skills/dispatch/settle-parked.md` and `plugin/skills/wrap-up/review-console-interactive.md`, which cite `classifyRollup` — check each still reads true) — any sentence claiming a push-only green head reads green at the gate gets the settle window named, or is left with a stated reason in the commit message.

- [ ] **Step 6: Commit** — `State the PR-event settle window in Step 2.5 and the bounded watch — refs #3468`

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (choose a rule) | Decided in the spec (60-second window; Reading B start point); encoded in Global Constraints |
| Deliverable 2 (classify.js/pr-checks.js + Step 2.5 prose, path-filtered test) | Tasks 1, 2, 4 (path-filtered tests: AC2.1 in Tasks 1-3); driver merge gate and drain in Task 3 (the other `classifyRollup` merge consumers) |
| AC1.1 | Tasks 1, 2, 3 tests named `AC1.1: …`; watch pin in Task 4 |
| AC2.1 | Tasks 1, 2, 3 tests named `AC2.1: …` |
