# Plan-retention routing CLI Implementation Plan (#4594)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/tidy` Step 4's plan-retention arithmetic (first-add date, 7-day cutoff, the 30 threshold, the uncited recount, the fail-closed decline lookup) out of prose into `plugin/bin/plan-retention.js`, so the prose keeps only the policy meaning and cites the CLI.

**Architecture:** A pure `routePlans` in `plugin/bin/lib/plan-retention/route.js` decides every route from (retention value, per-plan first-add date or `uncommitted`, today, cited set, an injected decline lookup), so the boundary, the threshold and `ask`'s no-cutoff routing unit-test without a repo. `plugin/bin/lib/plan-retention/probe.js` holds the git first-add probe and the decline fingerprint. The CLI wires real git and the real `declined-learning` store through a `run(argv, deps)` seam and prints one JSON line. The citation check stays prose-owned (`plan-citation-check.md` has three other readers), so the CLI takes a two-pass shape: a first call reports `citationCheck`/`citationCandidates`, and a re-run with one `--cited {plan}` per cited candidate recounts.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `git` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T141846-record-4594/work/4594-spec.md`

**Scope keywords:** diff-filter=A, declined-learning.js lookup, superpowers-plans-retention, Prune plan (archive)

## Global Constraints

- Route vocabulary, exactly: `delete` / `keep` / `prune-ask` / `prune-archive`; first-add value: a `YYYY-MM-DD` date or the literal `uncommitted` — spec Deliverable 1.
- Constants: `CUTOFF_DAYS = 7`, `ARCHIVE_THRESHOLD = 30`. **Boundary decision (spec Gotcha 4):** a plan is past the cutoff when its first-add date is 7 or more calendar days before today (`ageInDays >= 7`); 6 days is within. A first-add date after today (clock or timezone skew) is within.
- Date arithmetic compares calendar dates, never timestamps: `ageInDays = (Date.UTC(today) - Date.UTC(firstAdded)) / 86400000` over the parsed `YYYY-MM-DD` parts (spec Gotcha 5). The CLI's `today` is the local calendar date; tests inject it.
- Route semantics (spec Technical Approach, verbatim): "`prune-after-wrapup` → `delete` unchanged, `ask` → `prune-ask` regardless of age (an uncommitted plan stays `keep`), `keep-forever` → `keep` unless 30 or more uncited past-cutoff plans and no live decline, then `prune-archive` for all of them."
- Decline fail-closed direction (spec Gotcha 3): a non-null decline entry, or a lookup that throws, routes every plan `keep`. The CLI performs the lookup itself, in-process, through `plugin/bin/lib/declined-learning/store.js`'s `lookupDecline`, with the fingerprint `createFingerprint('tidy', ['description']).fingerprint({ description: 'tidy Prune plan (archive): docs/superpowers/plans/' })` — byte-for-byte the computation `plugin/bin/declined-learning.js lookup --source tidy` makes. The store path is cwd-relative, so the CLI runs from `{REPO_ROOT}`.
- Governing skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`), quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract" · "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." · "Exit codes are a documented contract … pick the one the CLI's sibling and its consuming prose already use, then spell it out in the file's header comment and `USAGE`" · "**A value-taking flag given as the last argv element reads `undefined`** … Validate the value inside `parseArgs` … and pin both the trailing bare flag and the empty-string value with their own test cases." Exit vocabulary is `plugin/bin/residue.js`'s (the spec's model): 0 for any successful render including a degraded one, 2 only for a malformed invocation.
- Governing skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`), quoted: "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt." Read that file before Task 3.
- Source-scan lints over `plugin/bin/`: every `execFileSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`); no `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`); no `process.exit(` inside the `require.main === module` guard (`tests/bin-lib/exit-code-conformance.test.js`). `git log` is not a `git status`, so `tests/git-status-optional-locks.test.js` does not apply.
- Size: `plugin/skills/tidy/scan-procedures.md` is 51,207 B against `RAIL_BYTES` 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Task 3's edit must leave it at or below 52,000 B; measure with `wc -c` and record it in the task report. `plugin/skills/tidy/SKILL.md` is 43,092 B (ample headroom).
- AC5.1's "`npm test` passes" clause is satisfied by `/build` Common Step 5's central full-suite run through `verify.js` (the runner-written pass stamp), never by a per-task full run — tasks run only their targeted suites.
- Scratch checks stay scratch; commit only the tests named below. Commit messages: `{Verb} {what} — {detail} (refs #4594)`, never `closes`/`fixes`.

## Review Focus

- The same plan passed twice would double-count toward 30 → exit 2, never a silent dedupe. Test in Task 2.
- A `--cited` path absent from the plan list (a typo) would leave the uncited count unchanged → exit 2. Test in Task 2.
- A plan argument containing a glob character (`*`) is matched literally, not as a pathspec (`--literal-pathspecs`) — otherwise `git log` reports some other plan's add date. Test in Task 2.
- A git probe that fails, is not run in a repo, or prints a non-date reads as `uncommitted` → `keep`, exit 0, never a crash. Test in Task 2.
- A first-add date after today is within the cutoff (negative age). Test in Task 1.

---

### Task 1: Pure routing function

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/plan-retention/route.js`
- Test: `tests/bin-lib/plan-retention/route.test.js` (create)

**Interfaces:**
- Produces (all exported from `route.js`):
  - `CUTOFF_DAYS = 7`, `ARCHIVE_THRESHOLD = 30`, `UNCOMMITTED = 'uncommitted'`, `RETENTION_VALUES = ['keep-forever', 'prune-after-wrapup', 'ask']` (frozen).
  - `ageInDays(firstAdded: 'YYYY-MM-DD', today: 'YYYY-MM-DD') => number` — calendar-day difference per Global Constraints (negative when `firstAdded` is after `today`).
  - `isPastCutoff(firstAdded: string, today: string) => boolean` — `false` for `UNCOMMITTED`; else `ageInDays(firstAdded, today) >= CUTOFF_DAYS`.
  - `routePlans({ retention, plans, today, cited, lookupDecline }) => { citationCheck, citationCandidates, decline, plans }` where `plans: Array<{ plan: string, firstAdded: string }>`, `cited: Set<string> | null` (null = first pass), `lookupDecline: () => object | null` (may throw). Returns `plans` in input order as `{ plan, firstAdded, pastCutoff, cited, route }` (`cited` = `cited !== null && cited.has(plan)`), `citationCandidates: string[]`, `decline: null | { live: boolean, error: string | null }`. Throws `Error('unknown retention value: {v}')` for a value outside `RETENTION_VALUES`.
  - Rules: `prune-after-wrapup` → every plan `delete`, `citationCandidates` = every plan, `citationCheck` = list non-empty, `decline: null`. `ask` → committed `prune-ask`, `uncommitted` `keep`; candidates = the `prune-ask` plans; `citationCheck` = candidates non-empty; `decline: null`. `keep-forever` → `uncited` = past-cutoff plans not in `cited`; if `uncited.length < ARCHIVE_THRESHOLD`: every plan `keep`, `citationCheck: false`, candidates `[]`, `decline: null`, and `lookupDecline` is **not called**. Else `citationCheck = cited === null` and `citationCandidates = cited === null ? uncited : []` — **whatever the decline state** (the citation check runs once the pre-check count reaches 30, before the decline lookup, as today's prose orders it: plan review ruling, Reading A) — then call `lookupDecline` once inside try/catch → `decline = { live: entry != null, error: null }` or `{ live: false, error: err.message }`; on `live` or `error` every plan `keep`; otherwise `uncited` plans `prune-archive`, the rest `keep`.

- [ ] **Step 1: Write the failing tests** (`tests/bin-lib/plan-retention/route.test.js`; `TODAY = '2026-10-31'`; helper `plansAged(n, days, prefix)` builds `n` entries `{ plan: 'docs/superpowers/plans/{prefix}-{i}.md', firstAdded: <TODAY minus days> }`; `noLookup = () => { throw new Error('lookupDecline must not be called'); }`)

- `the 7-day boundary: 6 days within, 7 days past, across a month and a leap day` — `ageInDays('2026-10-24', TODAY) === 7`; `isPastCutoff('2026-10-24', TODAY) === true`; `isPastCutoff('2026-10-25', TODAY) === false`; `ageInDays('2026-09-28', '2026-10-05') === 7`; `ageInDays('2028-02-28', '2028-03-06') === 7`.
- `a first-add date after today is within the cutoff` — `ageInDays('2026-11-02', TODAY) === -2`; `isPastCutoff('2026-11-02', TODAY) === false`.
- `AC2.1 (unit): 29 past-cutoff plans all keep, citationCheck false, no decline lookup` — `routePlans({ retention: 'keep-forever', plans: plansAged(29, 30, 'old'), today: TODAY, cited: null, lookupDecline: noLookup })` → every route `keep`, `citationCheck === false`, `citationCandidates` `[]`, `decline === null`.
- `AC1.1 (unit): 30 past-cutoff plans route prune-archive and a 1-day-old plan keeps` — 30 aged 30 + 1 aged 1, `lookupDecline: () => null` → the 30 `prune-archive`, the 1 `keep`; `citationCheck === true`; `citationCandidates` deepEqual the 30 paths in input order; `decline` deepEqual `{ live: false, error: null }`.
- `the second pass recounts uncited plans` — 31 aged 30 with `cited = new Set([p0, p1])` → all 31 `keep`, `citationCheck === false`, `decline === null` (lookup not called — pass `noLookup`); 32 aged 30 with the same 2 cited and `lookupDecline: () => null` → the 30 uncited `prune-archive`, `p0`/`p1` `keep` with `cited: true`, `citationCheck === false`, candidates `[]`.
- `a live decline or a failed lookup keeps every plan, and the first pass still asks for the citation check` — 30 aged 30, `cited: null`, `lookupDecline: () => ({ declinedAt: 'x', reason: 'r', source: 'tidy' })` → all `keep`, `citationCheck === true`, `citationCandidates.length === 30`, `decline` deepEqual `{ live: true, error: null }`; with `lookupDecline: () => { throw new Error('boom'); }` → all `keep`, `citationCheck === true`, `decline` deepEqual `{ live: false, error: 'boom' }`; the same live decline on a second pass (`cited: new Set()`) → all `keep`, `citationCheck === false`.
- `AC3.1 (unit): an uncommitted plan keeps under keep-forever and ask; ask has no cutoff` — `[{ plan: U, firstAdded: 'uncommitted' }, { plan: R, firstAdded: <TODAY minus 1> }]`: under `keep-forever` both `keep` and `U`'s `pastCutoff === false`; under `ask` `U` `keep`, `R` `prune-ask`, `citationCandidates` deepEqual `[R]`, `citationCheck === true`.
- `prune-after-wrapup routes every plan delete and lists all for the citation check` — the same two plans → both `delete`, candidates `[U, R]`, `citationCheck === true`; an empty list → `citationCheck === false`.
- `an unknown retention value throws` — `assert.throws(() => routePlans({ retention: 'sometimes', plans: [], today: TODAY, cited: null, lookupDecline: noLookup }), /unknown retention value: sometimes/)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-retention/route.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/plan-retention/route'`.

- [ ] **Step 3: Implement `route.js`** per the Interfaces block. Header comment: #4594, that this is the one implementation of `tidy/scan-procedures.md` Step 4's Plan retention arithmetic, and the boundary decision (7 or more days is past).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-retention/route.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-retention/route.js tests/bin-lib/plan-retention/route.test.js
git commit -m "Add plan-retention routePlans — cutoff, 30 threshold and fail-closed decline as one pure function (refs #4594)"
```

### Task 2: First-add probe, decline fingerprint, and the `plan-retention.js` CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/plan-retention/probe.js`
- Create: `plugin/bin/plan-retention.js`
- Test: `tests/bin-lib/plan-retention/cli.test.js` (create; in-process `run(argv, deps)` tests plus spawned fixture-repo tests)
- Modify: `docs/plugin-structure.md` — one CLI line beside `stale-claim-pr.js`'s (line 213), and one `plugin/bin/lib/plan-retention/` row beside `plugin/bin/lib/residue/`'s (line 25)

Waived plugin/bin/residue.js: read only — Step 3 copies its 0/2 exit vocabulary and `runner` shape (`stdio`, `windowsHide`, null on throw); not modified.

**Interfaces:**
- Consumes: Task 1's `routePlans`, `RETENTION_VALUES`, `CUTOFF_DAYS`, `ARCHIVE_THRESHOLD`, `UNCOMMITTED`.
- Produces (`probe.js`): `DECLINE_SOURCE = 'tidy'`, `DECLINE_DESCRIPTION = 'tidy Prune plan (archive): docs/superpowers/plans/'`, `archiveDeclineFingerprint() => string` (Global Constraints' computation, via `plugin/bin/lib/health-core/fingerprint.js`'s `createFingerprint`), `firstAddedDate(plan: string, git: (args: string[]) => string | null) => string` — calls `git(['--literal-pathspecs', 'log', '--diff-filter=A', '--format=%cs', '-1', '--', plan])` inside try/catch; returns the trimmed output when it matches `/^\d{4}-\d{2}-\d{2}$/`, else `'uncommitted'` (null, throw, empty, or garbage).
- Produces (`plan-retention.js`): `node plan-retention.js --retention <keep-forever|prune-after-wrapup|ask> [--cited <plan>]... [<plan>...] [--help]`; exports `{ run, parseArgs, realDeps, USAGE }`. `deps`: `{ git(args) => string | null, lookupDecline(fingerprint) => object | null, today() => 'YYYY-MM-DD', stdout: { write }, stderr: { write } }`.
  - `--help` → `USAGE` on stdout, exit 0, before any other parsing or deps call.
  - Exit 2, `USAGE` (prefixed by a one-line reason) on stderr, nothing on stdout: no `--retention`; a value outside `RETENTION_VALUES`; `--retention`/`--cited` as the last argument, or followed by a `--`-prefixed token, or by an empty string; an unknown `--` flag; a plan not starting with `docs/superpowers/plans/`; a plan given twice; a `--cited` plan not among the plans; `--cited` with a retention other than `keep-forever`.
  - Exit 0, one JSON line on stdout, keys in this order: `retention`, `today`, `cutoffDays`, `threshold`, `citationCheck`, `citationCandidates`, `decline`, `plans` (Task 1's per-plan objects).
  - Order: parse → `firstAddedDate` per plan → `routePlans` with `cited` (a `Set`, or `null` when no `--cited` was given) and `lookupDecline: () => deps.lookupDecline(archiveDeclineFingerprint())`.
  - `realDeps.git`: `execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()`, `null` on any throw. `realDeps.lookupDecline`: `store.lookupDecline`. `realDeps.today`: the local calendar date as `YYYY-MM-DD`.
  - Header comment: usage, the 0/2 vocabulary (residue.js's), that it runs from `{REPO_ROOT}` (git cwd and the cwd-relative decline store), the two-pass `--cited` shape, and that it is the one implementation `tidy/scan-procedures.md` Step 4 cites (#4594).

- [ ] **Step 1: Write the failing tests** (`tests/bin-lib/plan-retention/cli.test.js`; `P = 'docs/superpowers/plans/a.md'`, `Q = 'docs/superpowers/plans/b.md'`; `fakeDeps(overrides)` returns `{ git: () => '2026-09-01', lookupDecline: () => null, today: () => '2026-10-31', stdout, stderr }` with captured writes)

In-process:
- `malformed invocations exit 2 with usage on stderr and no stdout` — table over: `[]`; `['--retention', 'sometimes']`; `['--retention']`; `['--retention', '']`; `['--retention', '--cited']`; `['--bogus', '--retention', 'ask']`; `['--retention', 'ask', 'notes/x.md']`; `['--retention', 'keep-forever', P, P]`; `['--retention', 'keep-forever', '--cited', Q, P]`; `['--retention', 'keep-forever', P, '--cited']`; `['--retention', 'ask', '--cited', P, P]` → each exit 2, stderr matches `/usage: plan-retention\.js/`, stdout empty.
- `--help prints usage and calls no deps` — every deps function throws if called → exit 0, stdout matches `/usage: plan-retention\.js/`.
- `a git probe that fails or prints a non-date reads as uncommitted and keeps` — `git` returning `null`, throwing, and returning `'not a date'` → each exit 0, the plan's `firstAdded === 'uncommitted'`, `route === 'keep'` under `keep-forever`.
- `firstAddedDate passes the plan literally after --literal-pathspecs` — a recording `git` fake given `docs/superpowers/plans/*.md` → its args deepEqual `['--literal-pathspecs', 'log', '--diff-filter=A', '--format=%cs', '-1', '--', 'docs/superpowers/plans/*.md']`.
- `the output line carries the documented keys in order` — `Object.keys(JSON.parse(stdout))` deepEqual `['retention', 'today', 'cutoffDays', 'threshold', 'citationCheck', 'citationCandidates', 'decline', 'plans']`; `cutoffDays === 7`, `threshold === 30`.
- `--cited reaches routePlans as the cited set` — 32 plans with `git: () => '2026-09-01'`, two `--cited` → those two `cited: true` and `keep`, the other 30 `prune-archive`, `citationCheck === false`.
- `the decline fingerprint is the one declined-learning.js lookup computes` — spawn `plugin/bin/declined-learning.js lookup --source tidy` in a fresh `fs.mkdtempSync` dir with stdin `JSON.stringify({ description: DECLINE_DESCRIPTION })` → its `fingerprint === archiveDeclineFingerprint()`.

Spawned (`execFileSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8' })`; fixture `planRepo({ old, recent, untracked })` from `tests/helpers/git-fixtures.js`'s `gitRepo()` + `fixtureGit`: writes `old` files under `docs/superpowers/plans/` and commits them in one commit with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` = now minus 30 days (ISO), then `recent` files in a second, undated commit, then `untracked` files left uncommitted; returns `{ repo, oldPlans, recentPlans, untrackedPlans }`; clean up with `fs.rmSync` in `finally`):
- `AC1.1: 30 past-cutoff plans and 1 within-cutoff plan under keep-forever` — `planRepo({ old: 30, recent: 1 })` → exactly the 30 `prune-archive`, the 1 `keep`, `citationCheck === true`, `citationCandidates.length === 30`, exit 0.
- `AC2.1: 29 past-cutoff plans all keep and report citationCheck false` — `planRepo({ old: 29 })` → all 29 `keep`, `citationCheck === false`.
- `AC3.1: an uncommitted plan keeps under keep-forever and ask` — `planRepo({ recent: 1, untracked: 1 })` → the untracked plan `firstAdded === 'uncommitted'`, `route === 'keep'` under both `--retention keep-forever` and `--retention ask` (and the committed one `prune-ask` under `ask`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-retention/cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/plan-retention'`.

- [ ] **Step 3: Implement `probe.js` and `plan-retention.js`** per the Interfaces block, then add the two `docs/plugin-structure.md` lines (the CLI line states its usage, the 0/2 codes, the `--cited` second pass and that it runs from `{REPO_ROOT}`).

- [ ] **Step 4: Run the tests, the bin-wide source scans, and one real-input probe**

Run: `node --test tests/bin-lib/plan-retention/cli.test.js tests/bin-lib/plan-retention/route.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS.

Real-input probe (scratch, not committed): from the worktree root run `node plugin/bin/plan-retention.js --retention keep-forever` followed by every `docs/superpowers/plans/*.md` path listed by `git ls-files docs/superpowers/plans` (paste the paths; no glob). Record in the task report the count of plans with `pastCutoff: true` and the `citationCheck` value. Independent count: the number of those files whose filename date prefix (`YYYY-MM-DD`) is 7 or more days before today — filenames are dated at plan creation, so the two counts should agree (reconcile any difference by running `git log --diff-filter=A --format=%cs -1 -- {plan}` on the disagreeing file).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-retention/probe.js plugin/bin/plan-retention.js tests/bin-lib/plan-retention/cli.test.js docs/plugin-structure.md
git commit -m "Add plan-retention.js — tidy Step 4 routes over real git and the decline store (refs #4594)"
```

### Task 3: Point tidy Step 4 at the CLI and re-pin its conformance suite

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/tidy/scan-procedures.md` (Step 4's `**Plan retention (#4465).**` list, lines 52-62)
- Modify: `plugin/skills/tidy/SKILL.md` (line 130, the `**Prune plan**` Action Vocabulary row)
- Modify: `tests/tidy-plan-retention-conformance.test.js` (tests at lines 67-76, 87-112, 114-119, 240-249; plus the new pins below)
- Modify: `docs/skill-graph.md` (tidy section: the `bin/lib/declined-learning/store.js` row, line 644; add a `bin/plan-retention.js` row after it)
- Modify: `docs/journeys/keep-recent-plans-and-approve-a-bulk-prune-4465.md` (frontmatter `files:` gains `plugin/bin/plan-retention.js`; step 2's Action line 45 and its "Empty output…" bullet line 48; step 3's decline bullet line 62)
- No-change (classified): `docs/journeys/tidy-standalone-auto-report.md:36` (states the policy, names no command); `docs/superpowers/plans/2026-10-30-tidy-plan-retention-4465.md` (a shipped plan, historical); `plugin/skills/_shared/policy-schema.md`'s `superpowers-plans-retention` row (states the policy, still accurate)

**Interfaces:**
- Consumes: Task 2's CLI usage, output keys and `DECLINE_DESCRIPTION`; Task 1's `CUTOFF_DAYS`, `ARCHIVE_THRESHOLD`.

Prose content for `scan-procedures.md` (meaning fixed, wording the implementer's within the pins below; keep every sentence the suite's other tests pin):
- New bullet after **Resolve**: `**Compute**` — run from `{REPO_ROOT}` `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-retention.js" --retention {value} {plan} …` with every would-be-Delete plan under `docs/superpowers/plans/` as a repo-relative path; it prints one JSON line with each plan's `route` (`delete`, `keep`, `prune-ask` = `Prune plan (ask)`, `prune-archive` = `Prune plan (archive)`), `firstAdded` (a date or `uncommitted`), and `citationCheck`/`citationCandidates`; exit 2 is a malformed call — fix and re-run, never route by hand; the bullets below are the rules it applies.
- **Route** `ask` bullet: the parenthetical "(the cutoff command below prints nothing or exits non-zero)" becomes "(`firstAdded: "uncommitted"`)".
- **Cutoff**: drop the `git … --diff-filter=A …` command; state the boundary — a plan first added 7 or more days before today is past the cutoff — and that an `uncommitted` plan counts as within the cutoff — Keep.
- **Citation check**: keep its three pinned sentences; add that `citationCheck: true` names the `citationCandidates`, and that after the check you re-run the CLI with one `--cited {plan}` per cited (or cited-unverified) candidate, whose routes replace the first call's; with no cited candidate, the first call's routes stand — no re-run.
- **Decline memory** first sub-bullet: replace the `printf … lookup` command with: the CLI looks up a decline itself before routing to `Prune plan (archive)`, with the description the record payload below uses; a live decline, or a lookup that fails, routes them to Keep. Keep "Run both commands from `{REPO_ROOT}` — the store path is relative to the working directory" (the two commands are now `plan-retention.js` and `record-decline`).

`SKILL.md` line 130: after "`Prune plan (ask)` that it is still committed", add "(re-run `bin/plan-retention.js` on the listed plans: its `pastCutoff` and `firstAdded`)" — the sentence `tests/tidy-plan-retention-conformance.test.js:203` pins stays intact.

- [ ] **Step 1: Write the failing test changes** in `tests/tidy-plan-retention-conformance.test.js`

Add a frozen control at the top: `const PRE_CHANGE_CUTOFF = '- **Cutoff** (\`keep-forever\` only). The cutoff is 7 days (ADR-0007\'s "last ~week"), counted from the plan\'s first-add commit date — \`git -C "{REPO_ROOT}" log --diff-filter=A --format=%cs -1 -- {plan}\`; empty output or a non-zero exit counts as within the cutoff — Keep.';` (today's line 57 verbatim) and `const PRE_CHANGE_LOOKUP` = today's line 60 verbatim. Helper `pinned(pattern, control)` asserts `match(step4Section(), pattern)` and `doesNotMatch(control, pattern)`.

- Replace the test at line 114 with `AC4.1/AC4.2/AC5.1: tidy Step 4 cites plan-retention.js and no longer spells out the date command (#4594)`: `pinned(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-retention\.js" --retention \{value\}/, PRE_CHANGE_CUTOFF)`; `assert.doesNotMatch(step4Section(), /--diff-filter=A/)` with the control `assert.match(PRE_CHANGE_CUTOFF, /--diff-filter=A/)`; keep `The cutoff is 7 days \(ADR-0007's "last ~week"\), counted from the plan's first-add commit date`; `pinned(/a plan first added 7 or more days before today is past/, PRE_CHANGE_CUTOFF)`; `pinned(/`uncommitted` plan counts as within the cutoff/, PRE_CHANGE_CUTOFF)`.
- `tidy Step 4's 7 and 30 match plan-retention's constants (#4594)` — `CUTOFF_DAYS === 7` and `ARCHIVE_THRESHOLD === 30` from `plugin/bin/lib/plan-retention/route.js`, and Step 4 matches `/The cutoff is 7 days/` and `/30 or more plans are past the cutoff/` (a prose/code twin pin).
- `tidy Step 4 states the --cited second pass (#4594)` — `pinned(/re-run[^.]*--cited \{plan\}/, PRE_CHANGE_CUTOFF)`; `pinned(/with no cited candidate, the first call's routes stand/, PRE_CHANGE_CUTOFF)`.
- In the test at line 67: replace the `declined-learning\.js" lookup --source tidy` assertion with `pinned(/the CLI looks up a decline itself before routing to `Prune plan \(archive\)`/, PRE_CHANGE_LOOKUP)`; replace `a non-null \`decline\`, or a lookup that exits non-zero, routes them to Keep` with `pinned(/a live decline, or a lookup that fails, routes them to Keep/, PRE_CHANGE_LOOKUP)`; drop the `Before staging a \`Prune plan \(archive\)\`, look up a decline` assertion; keep the rest.
- Rewrite the round-trip test at line 87 as `tidy Step 4's decline record payload round-trips through plan-retention's lookup (#4594)`: extract the `Write` payload and the `record-decline` command from Step 4 as today; assert the payload's `description` equals `probe.DECLINE_DESCRIPTION`; in a `mkdtempSync` sandbox, spawn the prose's `record-decline --source tidy` with the payload (`{why}` filled), then assert `store.lookupDecline(probe.archiveDeclineFingerprint(), { readFile: (p) => fs.readFileSync(path.join(sandbox, p), 'utf8') })` returns an entry whose `reason` equals the filled reason, and that before recording it returns `null`.
- In the test at line 240: replace the row's `via \`bin\/declined-learning\.js lookup --source tidy\`` pin with `via \`bin\/plan-retention\.js\``, and add a test that the tidy section carries a `| \`bin/plan-retention.js\`` row matching `/Step 4's Plan retention/`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/tidy-plan-retention-conformance.test.js`
Expected: FAIL — the new `plan-retention.js` citation, boundary, `--cited`, decline and skill-graph pins do not match yet.

- [ ] **Step 3: Edit the prose** — `scan-procedures.md`, `SKILL.md`, `docs/skill-graph.md` (rewrite the store row to say Step 4's Plan retention looks the decline up via `bin/plan-retention.js`, which reads the store in-process, and keep its `record-decline --source tidy` and 180-day sentences; the new `bin/plan-retention.js` row says Step 4's Plan retention routes every would-be-Delete plan through it — cutoff, the 30 threshold, the decline lookup — #4594), and the journey file (step 2's Action and "Empty output…" bullet describe the CLI's `firstAdded`/`uncommitted`; step 3's decline bullet says the CLI looks the decline up and a live decline or failed lookup routes the plans back to Keep).

- [ ] **Step 4: Run the suites and the sweep**

Run: `node --test tests/tidy-plan-retention-conformance.test.js tests/plan-citations-resolve.test.js tests/bin-lib/plan-retention/route.test.js tests/bin-lib/plan-retention/cli.test.js`
Expected: PASS.

Run: `git grep -n -i -e 'diff-filter=A --format=%cs' -e 'declined-learning.js" lookup --source tidy' -e 'declined-learning.js lookup --source tidy' -- plugin docs .claude/skills tests`
Expected: hits only in `docs/superpowers/plans/2026-10-30-tidy-plan-retention-4465.md` (historical), this plan file, and the frozen `PRE_CHANGE_*` constants in `tests/tidy-plan-retention-conformance.test.js`. reflect's own `lookup --source reflect` sites (`plugin/skills/reflect/full-mode.md`, `docs/journeys/route-a-declined-reflection-insight.md`) are out of scope and must not match. Control: the same command against `origin/main` (`git grep … origin/main -- plugin docs`) also lists `plugin/skills/tidy/scan-procedures.md` and the journey file — record both outputs.

Run: `wc -c plugin/skills/tidy/scan-procedures.md` — Expected: ≤ 52,000; record the number.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/tidy/scan-procedures.md plugin/skills/tidy/SKILL.md tests/tidy-plan-retention-conformance.test.js docs/skill-graph.md docs/journeys/keep-recent-plans-and-approve-a-bulk-prune-4465.md
git commit -m "Point tidy Step 4 Plan retention at plan-retention.js — prose keeps the policy, the CLI computes routes (refs #4594)"
```
