# Learned-skills drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `drain` verb to `plugin/bin/learned-skills-pr.js` that merges green learned-skills PRs at the end of wrap-up when `learned-skills-auto-merge` resolves `true`, and show this run's PR outcome in the engine-rendered Skills row and the short-circuit FYI.

**Architecture:** A new library `plugin/bin/lib/learned-skills/drain.js` lists open learned-skills PRs, checks scope, classifies each with `bin/lib/pr-checks/classify.js`'s `classifyRollup` (Step 2.5's code twin) plus the spec's stricter green, and makes the one merge call with a subject from `compose-subject.js`'s record-less form (extended for the `<!-- wrap-up-skills-pr -->` marker). The CLI resolves the two levers, the library writes `{run}/learned-skills/drain.json` for this run's PR, and `wrap-up-engine.js render` reads that file so `engine-render.js` appends the outcome after the PR URL.

**Tech Stack:** Node 18+, `node --test`, `gh` CLI through an injectable runner.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T043303-record-6112/work/6112-spec.md` (re-materialized with the record's `## Decisions` section; where a Deliverable conflicts with a Decision, the Decision wins)

Scope keywords: wrap-up-skills-pr, never armed, waits for a human, learned-skills-auto-merge

## Global Constraints

- Lever: `learned-skills-auto-merge`; unset or unreadable resolves `false`. With it `false`, nothing changes and `drain` merges nothing.
- Bounded watch: `MERGE_GATE_WATCH_SECONDS` (900 s) from `plugin/bin/lib/ci-health/constants.js`; poll every 30 s.
- Green: `statusCheckRollup` non-empty, every entry completed with conclusion `SUCCESS`, `NEUTRAL` or `SKIPPED`, every head run completed, PR open and not a draft. An empty rollup is pending, never green.
- Scope: only PRs whose body carries `<!-- wrap-up-skills-pr -->` are listed. Act only on one whose head is a same-repository (`isCrossRepository` false) branch named `learned-skills/*` and whose every changed file (`gh pr view --json files`) is under `.claude/skills/`. No author check.
- Per PR, oldest first; `mergeStateStatus` re-read right before the merge; merge pinned with `--match-head-commit {classified headRefOid}`; `--squash --delete-branch`.
- A red PR gets no label writes. A merged/closed PR is a no-op.
- Subject `chore: Add learned skill updates from wrap-up of #N (#P)`; body carries `Refs #N` lines, never `Fixes`; no subject contains `undefined`. Every value comes from a field the `--json` call requested.
- Every PR the drain classifies to an outcome (this run's own PR and every other run's PR alike) writes exactly one line to this run's `decisions.md`, with `[lever: learned-skills-auto-merge={value}]` — `AUTO` for `merged`/`armed`, `SKIP` for a `leftOpen` or `conflicting` outcome (spec Decision 2). Only this run's PR (`--own-pr`) writes `drain.json` and gets the ci-gate write; another run's PR has no run dir of its own. An already merged/closed PR is a no-op: in no list, no line.
- `_shared/github-pr-scan.md` item 9, tidy's arm row, and `docs/skill-graph.md`'s `_shared/github-pr-scan.md` edge row (line 809) belong to the PR-scan sub-issue: do not edit them.
- `plugin/skills/_shared/policy-schema.md` is 51,604 B against the 52,500 B rail: its row edit must not grow it.
- Commit messages: `{Verb} {what} — {detail}`, write `refs #6112`, never `closes`/`fixes`; end with `Claude-Session: https://claude.ai/code/session_01CcCLFrK3c63ksFHBbThzsM`.

Spec Decisions (record body, 2026-11-24) this plan implements:

- **Reasons (Decision 1):** the closed `leftOpen` reason set is `pending, timeout, red, head-changed, cross-repository, not-learned-skills-branch, files-outside-skills, merge-failed, no-gh` (nine values), exported as `LEFT_OPEN_REASONS`. Scope conditions are checked in that fixed order and a PR failing several reports only the first. `merge-failed` is a non-zero `gh pr merge` other than a head mismatch; the first line of its stderr goes in the entry as `detail`. A PR without the `<!-- wrap-up-skills-pr -->` marker is never listed and appears nowhere in the output. `conflicting` and `armed` are separate lists, not reasons.
- **Logging (Decision 2):** see Global Constraints.
- **Armed (Decision 3):** the JSON line is `{merged:[…], armed:[…], leftOpen:[{pr, reason, detail?}], conflicting:[…]}`; the Skills row and FYI show `merged`, `armed`, `conflicting`, or `left open: {reason}` for this run's PR.

`wrap-up/residue-sweep.md` (named in the spec's Gotchas) is read-only here: the drain must not copy its bare `--auto` arm at creation; no edit to it.

## Review Focus

1. A rollup entry completed with `CANCELLED`/`ACTION_REQUIRED`/`STALE` — `classifyRollup` would call it green; the drain must leave it open as `red`. Test in Task 2.
2. A sibling PR turned `DIRTY` by an earlier merge in the same drain — must report `conflicting` (re-read before merge). Test in Task 2.
3. The own PR turns conflicting during the bounded watch — `conflicting`, not `timeout` (#5179). Test in Task 2.
4. `gh pr list` returns a PR already merged by a concurrent drain — state read says `MERGED`: no-op, in no list. Test in Task 2.
5. A PR title holding a closing phrase (`fixes #12`) — the composed subject must not carry it (compose-subject already neutralizes; Task 1 pins it for the new marker).

---

### Task 1: compose-subject record-less form accepts the learned-skills marker and carries Refs lines

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js` (marker regex near line 92, the record-less block ~356-384, the `composeHousekeepingSubject` call ~478, header comment ~23-28)
- Modify: `plugin/bin/lib/release/subject.js` (`composeHousekeepingSubject`, line 137)
- Test: `tests/bin-lib/compose-subject.test.js`, `tests/bin-lib/release/subject.test.js`

**Interfaces:**
- Produces: `composeHousekeepingSubject({ title, number, scope, tag, refs })` — `refs: number[]` (optional); each becomes a `Refs #n` line, its own last paragraph block (one line per number, in order). `compose-subject.js --housekeeping --pr P` accepts a body carrying `<!-- wrap-up-skills-pr -->`; for that marker it extracts every `refs #n` token from the PR body (case-insensitive `/\brefs #(\d+)\b/gi`, de-duplicated, first-seen order) and passes them as `refs`. Tidy/residue markers pass no refs (unchanged output).

- [ ] **Step 1: Write failing tests**
  - `subject.test.js`: `composeHousekeepingSubject({ title: 'Add learned skill updates from wrap-up of #6112', number: 6200, refs: [6112] })` → `title === 'chore: Add learned skill updates from wrap-up of #6112 (#6200)'`, body ends with `Refs #6112`, body has no `Fixes`; with no `refs` the body is unchanged from today.
  - `compose-subject.test.js` (reuse its `fakeDeps({ prView })` helper): `test('AC1.1 AC2.1: --housekeeping accepts the wrap-up-skills-pr marker; body carries Refs, never Fixes, and no undefined')` with PR `{ number: 6200, title: 'Add learned skill updates from wrap-up of #6112, #6113', body: '<!-- wrap-up-skills-pr -->\nLearned skill updates from wrap-up (refs #6112, refs #6113).', closingIssuesReferences: [] }` → exit 0, title starts `chore: Add learned skill updates from wrap-up of #6112, #6113` and ends `(#6200)`, body contains `Refs #6112\nRefs #6113`, `!/Fixes/.test(body)`, `!/undefined/.test(title + body)`. Keep the existing no-marker refusal test green; update its stderr expectation only if the message text changes.
- [ ] **Step 2: Run** `node --test tests/bin-lib/release/subject.test.js tests/bin-lib/compose-subject.test.js` — Expected: the new tests FAIL (marker refused / no Refs line).
- [ ] **Step 3: Implement.** Add a separate `LEARNED_SKILLS_MARKER = /<!-- wrap-up-skills-pr -->/` beside `HOUSEKEEPING_MARKER` (do not widen `HOUSEKEEPING_MARKER` — its comment ties it to github-pr-scan's housekeeping pair). Accept either; name all three markers in the refusal message and the header comment.
- [ ] **Step 4: Run** the same command — Expected: PASS. Also `node --test tests/merge-subject-composer-conformance.test.js` — PASS.
- [ ] **Step 5: Commit** `Extend compose-subject's record-less form to learned-skills PRs — Refs lines from the body, refs #6112`.

### Task 2: drain library

**Files:**
- Create: `plugin/bin/lib/learned-skills/drain.js`
- Modify: `plugin/bin/lib/learned-skills/layout.js` (add `drainPath(runDir)` → `{patchDir}/drain.json`, export it)
- Test: `tests/bin-lib/learned-skills/drain.test.js`

**Interfaces:**
- Consumes: Task 1's compose-subject form (through `require('../compose-subject').run(argv, deps)`), `classifyRollup` and `FAILING_CONCLUSIONS` from `../pr-checks/classify`, `MERGE_GATE_WATCH_SECONDS` from `../ci-health/constants`, `formatEntry` from `../log-decision/append`, `realDeps.appendEntries`/`gh` conventions from `./learned-skills`.
- Produces:
  - `LEFT_OPEN_REASONS` (frozen array, the Decision above).
  - `LEVER_ACTIONS` — frozen `{ 'merge-when-green': { green: 'merge', pending: 'arm-if-blocked-else-watch', red: 'leave-open' }, wait: { green: 'merge', pending: 'watch', red: 'leave-open' }, off: { green: 'merge', pending: 'watch', red: 'leave-open' } }`; an unknown/empty `merge-verification` value maps to `wait` (Step 2.5's unresolved rule). The drain never takes Step 2.5's explicit-`off` "merge anyway" route: its green is stricter (Global Constraints).
  - `scopeProblem({ isCrossRepository, headRefName }, files)` → `null | 'cross-repository' | 'not-learned-skills-branch' | 'files-outside-skills'` (checked in that order, first failure wins; `files` is the `files[].path` array, read only when the first two pass; an empty or missing list is `files-outside-skills`).
  - `classifyPr(view, headRuns)` → `'green' | 'pending' | 'red' | 'conflicting' | 'closed'` — `state !== 'OPEN'` → `closed`; `classifyRollup({ rollup, headRefOid, localHead: headRefOid, hasPrCi: true, headRuns })` red, or any completed rollup entry/head run whose conclusion is not in `SUCCESS|NEUTRAL|SKIPPED` → `red`; then `mergeStateStatus === 'DIRTY' || mergeable === 'CONFLICTING'` → `conflicting`; `isDraft`, `pending`, or `read-failed` → `pending`; else `green`.
  - `drain({ runDir, integrationBranch, ownPr, repo, autoMerge, mergeVerification }, overrides)` → `{ merged: number[], armed: number[], leftOpen: {pr, reason, detail?}[], conflicting: number[] }` (plus `disabled: true` when `autoMerge` is not `true`). Deps: `gh(args) → string` (throws on non-zero), `ghAvailable() → boolean`, `now() → ms`, `sleep(ms)`, `compose(prNumber, repo) → { title, body }` (default: compose-subject `run(['--housekeeping', '--pr', P, '--repo', repo], { ...composeRealDeps, runner: (a) => deps.gh(a), stdout: capture, stderr: capture })`, throwing on non-zero), `ciGateRecord({ pr, headSha, gateStartEpoch, runDir, repo }) → exit code` (default in-process `require('../../ci-gate-record').run([...])`), `appendEntries`, `writeFile`.
- Calls (exact argv, `--repo` always passed):
  - list: `['pr','list','--repo',repo,'--state','open','--limit','200','--json','number,headRefName,isCrossRepository,body']`; candidates = body carries the marker (nothing else is listed or reported); sorted by `number` ascending.
  - files: `['pr','view',String(n),'--repo',repo,'--json','files']` (only for PRs passing the two non-file checks).
  - state: `['pr','view',String(n),'--repo',repo,'--json','number,state,isDraft,mergeStateStatus,mergeable,headRefOid,statusCheckRollup,title,body']`.
  - runs: `['run','list','--repo',repo,'--commit',headRefOid,'--limit','100','--json','name,workflowName,status,conclusion,url']`.
  - merge: `['pr','merge',String(n),'--repo',repo,'--squash','--delete-branch','--match-head-commit',headRefOid,'--subject',title,'--body',body]`; arm adds `'--auto'` after `'merge', n`.
- Behavior: `ghAvailable()` false → no gh call; `leftOpen: ownPr ? [{pr: ownPr, reason: 'no-gh'}] : []`. A failed `pr list` throws (CLI exit 1). A failed files/state/runs read for one PR → `leftOpen` reason `pending` for others, and for the own PR too (never merge on an unread state). Green → re-read state; changed `headRefOid` → `head-changed`; now conflicting → `conflicting`; not OPEN → no-op; else compose + merge (a throw → `conflicting` when stderr names `conflict`, `head-changed` when stderr names the head/`match-head-commit` mismatch, otherwise `merge-failed` with `detail` = stderr's first line). Pending non-own → `pending`, untouched. Pending own: `merge-when-green` + `mergeStateStatus === 'BLOCKED'` → arm → `armed`; else bounded watch (re-read state+runs every 30 s until `now() >= start + MERGE_GATE_WATCH_SECONDS*1000`): green → merge path, red → `red`, conflicting → `conflicting`, head changed → `head-changed`, closed → no-op, deadline → `timeout`. Own-PR green merge with `runDir` calls `ciGateRecord` first (non-zero → one `SKIP` line, merge continues); another run's PR never gets a ci-gate write. Every PR with an outcome (own or not), with `runDir`: append exactly one decision line (`AUTO … — Learned-skills drain: PR #{n} {merged|armed} …` or `SKIP … — Learned-skills drain (degraded): condition: PR #{n} {left open ({reason}) | conflicting} → fallback: left for a human or a later drain. …`, both ending `[lever: learned-skills-auto-merge=true]`). Own PR only: write `drainPath(runDir)` as `{ pr, outcome: 'merged'|'armed'|'conflicting'|'left-open', reason? }`. No `issue edit`/label call ever.

- [ ] **Step 1: Write the failing tests** in `drain.test.js` with a scripted fake `gh` (records calls; answers by argv) and a fake clock (`now` advances on `sleep`). Name tests by AC id:
  - `AC1.1 AC2.1: a green marker PR is merged with the composed chore subject, Refs body, no Fixes, no undefined` — assert the `pr merge` argv carries `--subject 'chore: Add learned skill updates from wrap-up of #6112 (#6200)'`, `--body` matching `/Refs #6112/` and not `/Fixes|undefined/`, `--match-head-commit <sha>`, `--squash`, `--delete-branch`; result `merged: [6200]`. Use the real compose path (default `compose` dep with the fake `gh`).
  - `AC1.2: a pending sibling is left untouched` — not own, rollup IN_PROGRESS → `leftOpen [{pr, reason:'pending'}]`, no `pr merge`, no `sleep`.
  - `AC1.3: a pending --own-pr is watched and merged when it turns green` — first two state reads pending (mergeStateStatus CLEAN), third green → `merged`, `sleep` called with 30000.
  - `AC1.4: a red PR is left open with no label writes` — any `FAILURE` → `red`; no call with `args[0]==='issue'` or containing `--add-label`.
  - `AC1.5: a DIRTY PR is reported conflicting`; plus `a sibling turned DIRTY by an earlier merge in the same drain is conflicting` (green at classification, DIRTY at the pre-merge re-read).
  - `AC1.6: a PR without the marker is never touched` — a `learned-skills/*` PR without the marker appears in no output list, gets no files/state read and no merge.
  - `AC3.1: an empty statusCheckRollup is left open as pending` (non-own).
  - `AC3.2: a head that changes between classification and merge is left open as head-changed`.
  - `AC3.3 / Decision AC: each scope reason` — a marker PR on a head branch outside `learned-skills/*` → `not-learned-skills-branch`; a fork → `cross-repository`; a `learned-skills/*` PR touching a file outside `.claude/skills/` → `files-outside-skills`; a fork on a non-`learned-skills/*` branch → only `cross-repository`; each with no `pr merge`.
  - `Decision AC: a non-zero gh pr merge (not a head mismatch) is merge-failed with its stderr line as detail`.
  - `Decision AC: an armed PR lands in armed and not in leftOpen`.
  - `Decision AC: a drain touching two PRs (own and one other) writes two decisions.md lines, each with the lever tag, and no ci-gate write for the other run's PR`.
  - `AC5.1: in an unprotected repo (mergeStateStatus CLEAN) a drain never merges a PR whose checks have not all completed green` — for each rollup of: empty; one IN_PROGRESS + one SUCCESS; one CANCELLED; all SUCCESS but a head run `in_progress` — own PR under `merge-when-green`, watch until timeout → no `pr merge` call, reason `timeout` (or `red` for CANCELLED).
  - `own pending PR under merge-when-green with mergeStateStatus BLOCKED is armed with --auto`.
  - `own PR turning conflicting during the watch is conflicting, not timeout`.
  - `a PR already merged (state MERGED at the state read) is a no-op in no list`.
  - `autoMerge false merges nothing and makes no gh call` and `no gh: no-gh for the own PR, no gh call`.
  - `own PR writes drain.json; a sibling writes no drain.json` (temp run dir).
  - `LEFT_OPEN_REASONS is exactly the closed set` (deepEqual to the Decision's list).
  - `twin pin: LEVER_ACTIONS rows equal Step 2.5's table Value column` — read `plugin/skills/_shared/pr-first-merge.md`, slice from `## Step 2.5` to the next `## `, parse the `| Value | Green | Pending | Red |` table's first-column backticked values → `['merge-when-green','wait','off']`, `assert.deepEqual(Object.keys(LEVER_ACTIONS).sort(), parsed.sort())`, and assert the header columns are exactly `Value, Green, Pending, Red`; go-red control: the same parser over the section with a row `| \`strict\` | … |` appended yields a mismatch.
- [ ] **Step 2: Run** `node --test tests/bin-lib/learned-skills/drain.test.js` — Expected: FAIL (`Cannot find module '…/drain'`).
- [ ] **Step 3: Implement** `drain.js` and `layout.drainPath` per Interfaces. Header comment: module purpose, the reason set, the lever table and that `_shared/pr-first-merge.md` Step 2.5 is the source of the semantics, the one merge call. Follow the `gh-api-module-pattern` project skill (injectable runner, `--repo` and values as discrete argv elements, per-PR fail-safe). Spawn options come from `../learned-skills` realDeps (`windowsHide: true`), and no API the source-scan suites ban (`tests/windows-hide-conformance.test.js`, `tests/path-guard-conformance.test.js`).
  Proof(auth): drain.js merges only a PR passing `scopeProblem` (same repository, `learned-skills/*` head, marker, every file under `.claude/skills/`), pinned by this task's AC1.6/AC3.3/scope tests where a fork, a foreign branch, a no-marker PR and an out-of-scope file each record no `pr merge` call.
  Proof(irreversible-side-effect): the one merge call runs only on the strict-green verdict, after a fresh `mergeStateStatus`/`headRefOid` re-read, pinned with `--match-head-commit`; this task's AC5.1 test proves an empty, partial or pending rollup in an unprotected repo (mergeStateStatus CLEAN) never reaches `pr merge`.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then (AC6.1) revert each behavior once (drop the strict-green check, the pre-merge re-read, the scope check, the head pin) and see its test go red; quote the red output in the task report. Every other task does the same for its own new tests.
- [ ] **Step 5: Commit** `Add the learned-skills drain library — merges green learned-skills PRs through Step 2.5's semantics, refs #6112`.

### Task 3: `drain` CLI verb

**Files:**
- Modify: `plugin/bin/learned-skills-pr.js` (header, `USAGE`, `VERBS`, `FLAGS`, a `runDrain`)
- Test: `tests/bin-lib/learned-skills/drain-cli.test.js` (new)

**Interfaces:**
- Consumes: Task 2's `drain(...)`.
- Produces: `learned-skills-pr.js drain --run <run-dir> --integration-branch <name> [--own-pr <n>] [--repo <owner/name>]`. Required: `--run`, `--integration-branch`. `--own-pr` must match `/^[1-9]\d*$/` (else exit 2). The CLI resolves both levers with one deps seam `resolvePolicy(runDir) → { autoMerge: boolean, mergeVerification: string }` (default: `execFileSync(process.execPath, [path.join(__dirname, 'resolve-policy.js'), '--run', runDir, '--values', 'learned-skills-auto-merge,merge-verification'])`, two lines; anything but the literal `true` → `false`; a throw → `{autoMerge:false, mergeVerification:''}`), `--repo` defaults to `gh repo view --json nameWithOwner -q .nameWithOwner` (failure → leftOpen `no-gh` path not taken; exit 1). Prints one JSON line (Task 2's result). Exit 0 any outcome; 1 a listing or repo-read failure; 2 malformed call or refused `--run`.

- [ ] **Step 1: Failing tests:** `drain --run X --integration-branch main --own-pr 7` with stubbed `resolveTarget`, `resolvePolicy` and a stubbed `drainLib` → prints the lib's JSON, exit 0, and passes `{ ownPr: 7, autoMerge, mergeVerification, integrationBranch: 'main' }`; `--own-pr abc` → exit 2; missing `--integration-branch` → exit 2; a lib throw → exit 1 with stderr `learned-skills-pr.js: drain failed:`; `AC4.1 (code): resolvePolicy printing false → the lib gets autoMerge false`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/learned-skills/drain-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** (add `drainLib`/`resolvePolicy` to `realDeps` so tests inject them; extend the header's verb list and exit codes).
- [ ] **Step 4: Run** it and `node --test tests/wrap-up-learned-skills-pr.test.js tests/bin-lib/learned-skills/` — Expected: PASS.
- [ ] **Step 5: Commit** `Add the drain verb to learned-skills-pr.js — resolves the levers and prints one JSON line, refs #6112`.

### Task 4: render the own-PR outcome

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-render.js` (`formatDetailCell`, `dispositionFor`, `renderTrace`, `renderConsoleSections` gain an optional `opts.drain`)
- Modify: `plugin/bin/wrap-up-engine.js` (`runRender`, single-run path ~line 500: read `drainPath(resolvedDir)` when present; unparseable → ignore)
- Test: `tests/bin-lib/wrap-up/engine-render.test.js` (or the existing render test file — grep `learned-skills PR` under `tests/` and extend that file)

**Interfaces:**
- Consumes: `layout.drainPath`; `drain.json` `{ pr, outcome, reason? }`.
- Produces: when a finding's `pr` URL ends `/pull/{drain.pr}`, the text `learned-skills PR {url}` becomes `learned-skills PR {url} — merged` / `— armed` / `— conflicting` / `— left open: {reason}`, in both the trace Detail cell and the console disposition. No drain file → output byte-identical to today.

- [ ] **Step 1: Failing tests:** `AC (deliverable 4): the Skills row shows merged`, `… left open: pending`, `… conflicting`, `Decision AC: … armed for an armed --own-pr`; `a drain for another PR number changes nothing`; `no drain → unchanged`; a CLI test through `wrap-up-engine.js render --run-dir {tmp}` with `engine-state.json` + `learned-skills/drain.json` showing `— merged` in `--section trace` and `--section console`.
- [ ] **Step 2: Run** the test file — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `node --test tests/wrap-up-learned-skills-pr.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `Show the learned-skills drain outcome in the Skills row and console disposition, refs #6112`.

### Task 5: wrap-up prose — drain step, phase order, FYI

**Files:**
- Modify: `plugin/skills/wrap-up/learned-skills-pr.md` (13,140 B; replace `## The PR waits for a human` with `## Drain at the end of wrap-up`; update the opening paragraph's "waits for a human")
- Modify: `plugin/skills/wrap-up/curation-engine.md` (29,454 B; section 2 names the drain step after the Review Console and `record`, before the phase-trace render)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` (34,669 B; the FYI paragraph ~line 263: run the drain before composing the FYI so its Skill updates section carries the outcome)
- Test: `tests/wrap-up-learned-skills-pr.test.js`

**Interfaces:** Consumes Task 3's CLI shape and Task 4's render.

New section content (facts the tests pin):
- Resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values learned-skills-auto-merge`; only when it prints `true`, run once, after the Review Console resolves and every `record` call, before the phase-trace report:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" drain --run "{run}" --integration-branch "{integration-branch}" --own-pr {pr-number}
  ```
  `{pr-number}` is `land`'s `pr.number`; omit `--own-pr` when `land` opened no PR this run. With the lever `false`, run nothing.
- What the outcomes mean (merged, armed, `leftOpen` reasons, `conflicting`), that the CLI logs one line per classified PR itself — this run's and other runs' alike — with `[lever: learned-skills-auto-merge={value}]` (`AUTO` merged/armed, `SKIP` left open/conflicting), while the Skills row and FYI show only this run's PR, and exit 1/2 handling (exit 1 → log `SKIP … Learned-skills drain (degraded) …` via `--text-file`, continue).
- Body bullet stays (marker, `refs #{n}` only, no closing keyword, no run marker); "Where a human sees it" gains: the Skills row and console disposition append the drain outcome.
- No literal `gh pr merge` or `--auto` in this file.

- [ ] **Step 1: Update tests first:** replace the `Never armed` fact with `[/only when it prints `true`, run once, after the Review Console resolves and every `record` call/, 'drain runs only when the lever is true, after the console and record']`, add facts for the drain fence and the lever tag; change `three CLI fences` → `four` and add the `drain` verb to `runFence`'s accepted verbs; add `AC4.1: with learned-skills-auto-merge false the procedure runs no drain` — assert every `drain` fence in `PROC` sits after the lever condition sentence and the condition names `true` only, with a go-red control that strips the condition sentence; update the comment above `BANNED` to the new rule (prose never merges by hand; the CLI does). Add a fact for curation-engine.md (`ENGINE`) naming the drain step and one for `SHORT_CIRCUIT` (drain before the FYI).
- [ ] **Step 2: Run** `node --test tests/wrap-up-learned-skills-pr.test.js` — Expected: FAIL on the new facts.
- [ ] **Step 3: Edit the three prose files.** Keep each file under the 52,500 B rail (`wc -c`).
- [ ] **Step 4: Run** `node --test tests/wrap-up-learned-skills-pr.test.js` then grep `tests/` for distinctive phrases from each edited paragraph (moved-prose pin check) and run those files — Expected: PASS.
- [ ] **Step 5: Commit** `Run the learned-skills drain at the end of wrap-up when learned-skills-auto-merge is on, refs #6112`.

### Task 6: retired-phrase and "Not yet used" sweep

**Files:**
- Modify: `plugin/bin/learned-skills-pr.js:36` header, `plugin/bin/lib/learned-skills/land.js:4` header and `:278` PR body sentence (→ `Opened ready: wrap-up's drain merges it once CI is green when learned-skills-auto-merge is on; otherwise a human merges or closes it.`), `plugin/bin/lib/reconcile/archive-branches.js:54` comment
- Modify: `docs/skill-graph.md:807` (the `wrap-up/learned-skills-pr.md` row only — not 809)
- Modify: `docs/getting-started.md:69` (the `/claude-tweaks:wrap-up` paragraph's "never armed and waits for a human" clause → the PR merges itself once CI is green when `learned-skills-auto-merge` is on, otherwise a human merges it)
- Modify: `docs/plugin-structure.md:152` (list `drain.js`) and `:318` (`capture|land|stage|drain`), `docs/journeys/review-a-runs-learned-skill-edits-on-their-own-pr-5290.md:24,46` (the PR merges once green under the lever; add an "Updated by #6112" line). `docs/decisions/0040-*.md` is a decision record — history, not edited.
- Modify: `plugin/bin/lib/policy-schema.js:152` summary (drop `Not yet used.`), `plugin/skills/_shared/policy-schema.md:100` (`Not yet read — …` → names the drain as the reader; no net growth), `docs/journeys/resolve-a-policy-key.md` and `docs/journeys/review-project-policy.md` (drop `learned-skills-auto-merge` from the "Not yet used" lists; add an "Updated by #6112" line)
- Test: `tests/resolve-policy-control-mode.test.js` (remove `learned-skills-auto-merge` from `NOT_YET_USED`), `tests/bin-lib/learned-skills/land.test.js` (any pin on the body sentence; keep `never armed` assertion meaning "land itself never merges" but rename its message to `land makes no merge call`)

- [ ] **Step 1:** Edit `NOT_YET_USED` first; run `node --test tests/resolve-policy-control-mode.test.js` — Expected: FAIL (summary still opens "Not yet used").
- [ ] **Step 2:** Make the edits above.
- [ ] **Step 3: Verify** `git grep -n -i -E "never armed|never-armed|waits for a human|wait for a human" -- plugin docs/skill-graph.md docs/getting-started.md README.md` lists only lines owned by other mechanisms (dispatch/settle-and-merge, tidy, github-pr-scan, release, pr-first-merge-post-merge, skill-graph 547/809) — none about the learned-skills PR; `wc -c plugin/skills/_shared/policy-schema.md` ≤ 51,604.
- [ ] **Step 4: Run** `node --test tests/resolve-policy-control-mode.test.js tests/policy.test.js tests/bin-lib/learned-skills/land.test.js` and any test file grep finds pinning the edited sentences — Expected: PASS.
AC7.1 (`npm test -- --full` passes) is proved by `/build`'s Common Step 5 and `/test`, after this task.

- [ ] **Step 5: Commit** `Retire the never-armed wording for learned-skills PRs and mark learned-skills-auto-merge as read, refs #6112`.
