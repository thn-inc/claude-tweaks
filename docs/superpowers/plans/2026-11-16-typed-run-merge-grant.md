# Merge Grant Requires a Live Build Grant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merge grant (`auto:merge`, or an `auto:merge-pending` at maturation) authorizes a merge only when the same live label read also carries `auto:build`, in both the driver lane and the prose lane (#5734).

**Architecture:** Stateless — every merge-authorizing read already fetches live labels; each one additionally requires `auto:build`. The driver's two label reads in `merge.js` stop `not-authorized` with a distinct detail. `evaluateMaturation` gains a `hasBuildLabel` input checked first and failing closed (`no-build-grant`); all four callers (two modules, two skill snippets) pass it, pinned by a caller conformance scan. Prose readers and the two canonical docs state the both-labels rule.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T183729-record-5734/work/5734-spec.md`

Scope keywords: evaluateMaturation, AUTHORIZING_LABEL

## Global Constraints

- The new maturation state name is exactly `no-build-grant`.
- The driver reuses the reason word `not-authorized`; only the detail changes. `MERGE_STOP_REASONS` (merge.js ~line 1574) is not edited.
- `auto:merge-pending` still does not count in the driver.
- `evaluateMaturation` fails closed: `hasBuildLabel` omitted, or anything other than `true`, answers `{ mature: false, state: 'no-build-grant' }`, checked before `already-mature` and `matured`.
- Out of scope, unchanged: `/claude-tweaks:wrap-up #N merge` (reads no grant label) and the `merge-authorization: pre-authorized` lever (`manifesto-authorized-merge.md`'s own pre-authorized branch).
- Rail (`RAIL_BYTES` = 52500, `plugin/bin/lib/skill-audit/budgets.js`): `plugin/skills/dispatch/settle-and-merge.md` is at 51120 B (1380 headroom) and `plugin/skills/_shared/github-pr-scan.md` at 52145 B (355 headroom). Edits to these two files must be net-neutral or smaller — trim equal bytes in the same paragraph; never cut a clause's consequence. Check `wc -c` after editing.
- Never loosen the rule to keep a fixture green: an existing fixture that authorizes a merge with `auto:merge` alone gains `auto:build`.
- Commit subjects: `{Verb} {what} — {detail}` with `refs #5734`, never `closes`/`fixes`.
- Governing skill `bin-source-scan-conformance` (Task 4's scan reads `plugin/bin/**/*.js` as text), quoted: "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`." / "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." / "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15." / "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`" / "A markdown file is judged fence by fence" / "Fence text is read raw." / "Anchor the fence regex on `\r?\n`, and plant a CRLF copy of the markdown fixture built with `.replace(/\n/g, '\r\n')`" / "Use an exact roster of site files across both trees as the floor, beside the `>=` count." / "use the manual `withFileTypes` walk (`listJs` in `tests/path-containment-conformance.test.js`) and a floor on files walked" / "A new scan written inside a per-module suite as a raw-text regex" is an anti-pattern — hence its own file.
- Governing skill `driver-step-addition` names `merge.js`; its rules on new awaits, seams and time constants do not apply (no new step, await, seam or constant). Its line 10 restates the merge rule and is updated in Task 6.

## Review Focus

1. A record carrying `auto:merge-pending` past its window and no `auto:build` must never be promoted to `auto:merge` — the label swap in both skill snippets runs only on `state === 'matured'`, which `no-build-grant` precedes. Pinned by Task 1's AC4.1 pending case.
2. `hasBuildLabel` passed as a truthy non-boolean (`1`, `'auto:build'`) fails closed like omission. Pinned by Task 1's omitted-input test.
3. A bundle with one member lacking `auto:build` falls back for the whole group (`resolve.js` returns at the first non-mature member). Pinned by Task 3's two-member resolve.js test.
4. `auto:build` removed between the driver's entry and pre-merge reads stops at `merge-call` with no `gh pr merge`. Pinned by Task 2's AC2 test.
5. A label spelled differently (`Auto:Build`) is not the grant — exact `includes('auto:build')`, the same match today's `auto:merge` check uses. Reviewer check only.

---

### Task 1: `evaluateMaturation` takes the build label and fails closed

**Files:**
- Modify: `plugin/bin/lib/issues/grant-maturation.js:82-122`
- Test: `tests/bin-lib/issues/grant-maturation.test.js`

**Interfaces:**
- Produces: `evaluateMaturation({ hasBuildLabel, hasPendingLabel, hasMergeLabel, pendingSince, vetoWindowHours, now })` → `{ mature, state, reason, ageHours?, windowHours? }`; new `state: 'no-build-grant'`, `mature: false`, `reason` containing `auto:build`.

- [ ] **Step 1: Write the failing tests** — three new tests in `tests/bin-lib/issues/grant-maturation.test.js`:
  - `AC4.1: no-build-grant when auto:merge is present without auto:build` — `evaluateMaturation({ hasBuildLabel: false, hasPendingLabel: false, hasMergeLabel: true, pendingSince: null, vetoWindowHours: 24, now: NOW })` → `mature === false`, `state === 'no-build-grant'`, `reason` matches `/auto:build/`.
  - `AC4.2: no-build-grant when auto:merge-pending is past its window without auto:build` — `pendingSince` 48h before `NOW`, `hasPendingLabel: true`, `hasMergeLabel: false`, `hasBuildLabel: false` → `mature === false`, `state === 'no-build-grant'`.
  - `AC4.3: no-build-grant when the build-label input is omitted or not true` — for each of the input omitted, `hasBuildLabel: undefined`, `hasBuildLabel: 1`, `hasBuildLabel: 'auto:build'`, with `hasMergeLabel: true` → `state === 'no-build-grant'`.
  - AC4.4: add `hasBuildLabel: true` to every existing `evaluateMaturation({...})` call in this file and prefix each existing test name with `AC4.4: `, so its five states stay pinned unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/grant-maturation.test.js`
Expected: FAIL — the three new tests fail (`already-mature`/`matured` returned instead of `no-build-grant`).

- [ ] **Step 3: Implement** — in `evaluateMaturation`, destructure `hasBuildLabel`; first statement: `if (hasBuildLabel !== true) return { mature: false, state: 'no-build-grant', reason: 'no auto:build label present — a merge grant counts only together with a live auto:build' };`. Add the state to the header comment's state list and `hasBuildLabel` to its parameter comment.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/grant-maturation.test.js`
Expected: PASS. Known and intended: the console suites Task 3 lists go red after this task (their callers pass no `hasBuildLabel` yet) — that is the fail-closed behavior, and Task 3 runs next and greens them. A reviewer of Task 1 does not treat those suites as a Task 1 regression.

- [ ] **Step 5: AC8.2 go-red control** — temporarily delete the `hasBuildLabel !== true` line, run `node --test tests/bin-lib/issues/grant-maturation.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T183729-record-5734/evidence/red-evaluator.txt" 2>&1` (create the directory first with `mkdir -p` on that `evidence` path; plain Bash redirect, never the Write tool), confirm the three new tests fail in that file, restore the line, re-run Step 4 green. Do not commit the removal.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/grant-maturation.js tests/bin-lib/issues/grant-maturation.test.js
git commit -m "Add no-build-grant state to evaluateMaturation — fails closed without auto:build, refs #5734"
```

### Task 2: Driver merge step requires `auto:build` at both label reads

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js:2-1092` (lines 2, 96-97, 242-244, 1088-1092)
- Test: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: `LABELS.AUTO_BUILD` from `plugin/bin/lib/issues/record-vocabulary.js` (already imported as `LABELS`).
- Produces: stop `{ stop: 'not-authorized' }` with detail `record lacks auto:build` (merge-entry) and `record lacks auto:build at the pre-merge read` (merge-call).

- [ ] **Step 1: Update fixtures and write the failing tests** — in `tests/bin-lib/driver/merge.test.js`: `defaultMergeScript`'s default labels (line ~122) become `[{ name: 'auto:build' }, { name: 'auto:merge' }]`; `AUTO_MERGE` (line ~1606) becomes the same pair; line ~434's `ok` harness adds `{ name: 'auto:build' }`. Then two new tests:
  - `AC1.1, AC1.2: auto:merge without auto:build stops not-authorized at merge-entry with no label, comment, ready or merge call` — `mergeHarness({ labels: [{ name: 'auto:merge' }] })` → `pick(r)` deep-equals `{ outcome: 'pending-review', reason: 'not-authorized', mergeCommit: null, postMerge: null }`; `r.detail === 'record lacks auto:build'`; `assertNoReadyNoMerge(h)`; `[lastEvent(h).step, lastEvent(h).status]` is `['merge-entry', 'stop']`; no call in `h.calls` is a `gh issue edit`, `gh pr comment` or `gh issue comment`.
  - `AC2.1, AC2.2: auto:build removed before the pre-merge read stops not-authorized at merge-call with no merge call` — `mergeHarness({ labels: seq(AUTO_MERGE, [{ name: 'auto:merge' }]) })` → reason `not-authorized`, `r.detail === 'record lacks auto:build at the pre-merge read'`, `noMerge(h)`, last event `['merge-call', 'stop']`.
  - AC3.1: every existing test keeps its outcome with both labels present at both reads (Step 4's run).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/driver/merge.test.js`
Expected: FAIL — the two new tests (outcome `merged` instead of `pending-review`).

- [ ] **Step 3: Implement** — the proof this step carries:

  Proof(auth): the merge-entry and merge-call label reads both refuse a record whose live labels lack `auto:build`, so a leftover `auto:merge` on a typed-built record never reaches `gh pr merge`; the AC1/AC2 tests and the Step 5 go-red control prove it.

  After the existing `AUTHORIZING_LABEL` check at each read, add `if (!labels.names.includes(LABELS.AUTO_BUILD)) return stop(s, '<same step>', 'not-authorized', '<detail above>');`. Update the module header (line 2) and the `readLabels` comment (line 96) to say the authorization is `auto:merge` together with `auto:build`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/driver/merge.test.js`
Expected: PASS

- [ ] **Step 5: AC8.1 go-red control** — temporarily delete both new `AUTO_BUILD` checks, run `node --test tests/bin-lib/driver/merge.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T183729-record-5734/evidence/red-driver.txt" 2>&1`, confirm exactly the two new tests fail, restore, re-run Step 4 green.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/merge.js tests/bin-lib/driver/merge.test.js
git commit -m "Require auto:build at both driver merge label reads — a leftover auto:merge no longer merges, refs #5734"
```

### Task 3: Console resolver and executor pass the build label

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js:448-463`
- Modify: `plugin/bin/lib/reconcile/console-execute.js:391-408`
- Test: `tests/bin-lib/console/resolve.test.js`
- Test: `tests/console-execute.test.js`
- Test: `tests/bin-lib/console/cli.test.js`
- Test: `tests/review-console-unattended-no-ask-conformance.test.js`
- No-change (classified): `plugin/bin/console-resolve.js` and `plugin/bin/lib/issues/merge-lane-breaker.js` mention `evaluateMaturation` in comments only; `plugin/skills/_shared/console-execution.md:230` says the executor uses "the same `evaluateMaturation` helper" — still true.

**Interfaces:**
- Consumes: Task 1's `hasBuildLabel` input and `no-build-grant` state.
- Produces: resolve.js leave-open reason for this state: `` `#${n} lacks auto:build — a merge grant counts only together with a live auto:build (${mat.reason})` ``; console-execute `mergeGrantGap = { member: n, reason: mat.reason }` (shape unchanged).

- [ ] **Step 1: Update fixtures and write the failing tests** — every grant fixture gains `auto:build` in its `labels` (resolve.test.js lines ~49, 732, 741, 749, 755, 943, 966; console-execute.test.js lines ~331, 336, 344, 355, 363, 374-375, 408, 418-420, 481, 492, 526 where they build `memberGrants`/grant replies; cli.test.js lines ~41, 180, 211, 248; the conformance test's line ~187 reply). A fixture asserting a withhold for a *different* reason also gains it, so it keeps failing for its own reason; where a test asserts the fetched `labels` array verbatim (cli.test.js ~235, console-execute.test.js ~485) update the expected array to match. New tests:
  - resolve.test.js `AC5.1, AC5.3: a member carrying auto:merge without auto:build resolves the merge half to leave-open naming the member` — group grants `{ 7: { labels: ['auto:build', 'auto:merge'] }, 8: { labels: ['auto:merge'] } }` → `resolution === 'leave-open'`, `reason` matches `/^#8 lacks auto:build/`.
  - console-execute.test.js `AC5.2, AC5.3: a solo record with auto:merge and no auto:build -> mergeGrantGap names the missing build grant` — `prBody: 'Fixes #7'`, `memberGrants: { 7: { labels: ['auto:merge'], pendingSince: null } }` → `mergeGrantGap.member === 7`, `mergeGrantGap.reason` matches `/auto:build/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/console-execute.test.js tests/bin-lib/console/cli.test.js tests/review-console-unattended-no-ask-conformance.test.js`
Expected: FAIL after Step 1 — and after Task 1 has landed: the callers pass no `hasBuildLabel`, so merge-expecting tests get `no-build-grant`, and the two new tests fail on the reason text.

- [ ] **Step 3: Implement** — both callers pass `hasBuildLabel: labels.includes('auto:build')` (console-execute: `hasBuildLabel: (grant.labels || []).includes('auto:build')`). In resolve.js, `mat.state === 'no-build-grant'` returns the reason in the Interfaces block; other non-mature states keep today's text. The `merge` reason string stays unchanged (pinned by three tests and read from `console.json` by an installed previous release).

- [ ] **Step 4: Run tests to verify they pass**

Run: the Step 2 command.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js plugin/bin/lib/reconcile/console-execute.js tests/bin-lib/console/resolve.test.js tests/console-execute.test.js tests/bin-lib/console/cli.test.js tests/review-console-unattended-no-ask-conformance.test.js
git commit -m "Pass the build label to evaluateMaturation from the console resolver and executor, refs #5734"
```

### Task 4: Skill snippets pass the build label, pinned by a caller conformance scan

**Files:**
- Create: `tests/evaluate-maturation-build-label-conformance.test.js`
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:9-63`
- Modify: `plugin/skills/dispatch/grant-maturation-gate.md:17-70`
- Modify: `tests/helpers/strip-comments.js` (header caller list)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` (item 15 caller list)

**Interfaces:**
- Consumes: Task 1's `hasBuildLabel` / `no-build-grant`; Task 3's two module call sites.

- [ ] **Step 1: Write the failing test** — a conformance scan, `tests/evaluate-maturation-build-label-conformance.test.js` (pattern: `tests/trust-policy-keys-conformance.test.js`, which walks both trees):
  - Walk `plugin/bin` (`.js`, manual `withFileTypes` walk, floor on files walked) and `plugin/skills` (`.md`), reading through `readText` (`tests/helpers/read-skill.js`).
  - `.js`: `stripComments` text, `stripperVerdict` `misparsed`/`unparseable` pushed as an offender. `.md`: each fenced block judged on its own, raw, fence regex anchored on `\r?\n`.
  - For each `evaluateMaturation({` occurrence (the definition `function evaluateMaturation(` does not match), take the text from `{` to its matching `}` and require a `hasBuildLabel:` property whose value text contains `includes('auto:build')`. Offenders as `path:line`.
  - `AC6.1: every evaluateMaturation call under plugin/ passes the build label` — offenders `[]`; exact site-file roster `['plugin/bin/lib/console/resolve.js', 'plugin/bin/lib/reconcile/console-execute.js', 'plugin/skills/dispatch/grant-maturation-gate.md', 'plugin/skills/wrap-up/auto-merge-short-circuit.md']` beside a `>= 4` sites floor.
  - Self-tests: `evaluateMaturation({ hasMergeLabel: true })` flags line 1; `evaluateMaturation({ hasBuildLabel: true, hasMergeLabel: true })` flags (value is not a label read); a `// evaluateMaturation({ ... })` comment is not a site in `.js`; a markdown fixture whose call is in one fence and `hasBuildLabel` in the next flags, and its CRLF copy gives the same verdict; a planted mis-parse (`if (b) /'/.test(b); evaluateMaturation({ hasMergeLabel: true });`) is reported, never a clean scan.
  - Add the test-file stem to `tests/helpers/strip-comments.js`'s header caller list and `.claude/skills/parse-signal-discipline/SKILL.md` item 15's list.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/evaluate-maturation-build-label-conformance.test.js`
Expected: FAIL — offenders in `plugin/skills/wrap-up/auto-merge-short-circuit.md` and `plugin/skills/dispatch/grant-maturation-gate.md`.

- [ ] **Step 3: Edit the snippets and their surrounding prose**
  - Both snippets: `hasBuildLabel: labels.includes('auto:build'),` as the first property of the `evaluateMaturation({` object.
  - `auto-merge-short-circuit.md` (AC7.1, AC7.2): applicability (lines 12-14) reads "the issue's live labels carry `auto:build` together with `auto:merge` or `auto:merge-pending`"; Authorization's first bullet requires `auto:build` beside `auto:merge`; line 48 adds `'no-build-grant'` (no live `auto:build`) to the states that fail Authorization and says it is never promoted — the promotion below runs only on `'matured'`. Header lines 5-7 keep their meaning.
  - `grant-maturation-gate.md` (AC7.1): line 58's failing-states list gains `no-build-grant` (a member with no live `auto:build`) — no promotion, the group falls back.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/evaluate-maturation-build-label-conformance.test.js tests/strip-comments-callers-twin.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/evaluate-maturation-build-label-conformance.test.js plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/dispatch/grant-maturation-gate.md tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md
git commit -m "Pin every evaluateMaturation call to pass the build label — skill snippets and a conformance scan, refs #5734"
```

### Task 5: Prose merge gates require both labels

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md:3-262` (lines 3, 244-262)
- Modify: `plugin/skills/_shared/express-lane.md:23`
- Modify: `plugin/skills/wrap-up/SKILL.md:273`
- Modify: `plugin/skills/wrap-up/review-console.md:27`
- Modify: `plugin/skills/wrap-up/manifesto-authorized-merge.md:9`
- Modify: `plugin/skills/dispatch/routine-template.yml:40-43`

- [ ] **Step 1: Edit**
  - `settle-and-merge.md` (AC7.1, AC7.2): line 3, the gate heading's lead paragraph (line 246) and the Authorization step say every member carries `auto:build` together with `auto:merge` or a matured `auto:merge-pending`; Authorization's failing-states list gains `no-build-grant`. Net-neutral bytes (Global Constraints).
  - `express-lane.md` step 9 (AC7.2): "the record's live labels (re-read now) carry `auto:merge` and `auto:build`".
  - `wrap-up/SKILL.md` line 273 (AC7.2): "a live `auto:build` together with `auto:merge` or `auto:merge-pending`".
  - `review-console.md` line 27 and `manifesto-authorized-merge.md` line 9: the same both-labels wording for the short-circuit's label trigger (the pre-authorized trigger is unchanged).
  - `routine-template.yml` line 42: "when every member carries auto:build with auto:merge or a matured auto:merge-pending". It lists no maturation state names, so nothing else changes there.

- [ ] **Step 2: Verify bytes and wording**

Run: `wc -c plugin/skills/dispatch/settle-and-merge.md` → ≤ 51120 (net-neutral). Then `git grep -n -e "carr[a-z]* \`auto:merge\` or" -e "carry \`auto:merge\` or" -- plugin/skills/dispatch/settle-and-merge.md plugin/skills/wrap-up plugin/skills/_shared/express-lane.md` → every hit also names `auto:build`. Absence-grep control: the same command against `git show HEAD~1:plugin/skills/wrap-up/review-console.md` shows line 27 matching before the edit.

- [ ] **Step 3: Run the prose suites**

Run: `npm test > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T183729-record-5734/evidence/task5-npm-test.txt" 2>&1` (locally impact-selected: picks the prose and rail suites these files feed).
Expected: exit 0; the log's summary shows `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/dispatch/settle-and-merge.md plugin/skills/_shared/express-lane.md plugin/skills/wrap-up/SKILL.md plugin/skills/wrap-up/review-console.md plugin/skills/wrap-up/manifesto-authorized-merge.md plugin/skills/dispatch/routine-template.yml
git commit -m "Require auto:build beside the merge grant in every prose merge gate, refs #5734"
```

### Task 6: Arm route, ceiling text and canonical docs state the rule

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md:224-255`
- Modify: `plugin/skills/tidy/actions-github-issues.md:80`
- Modify: `plugin/skills/_shared/autonomy-ceiling.md:217-226`
- Modify: `plugin/skills/_shared/work-record.md:195-206`
- Modify: `docs/driver.md:3-179` (lines 3, 37, 179)
- Modify: `docs/hooks.md:120`
- Modify: `docs/plugin-structure.md:297`
- Modify: `plugin/bin/lib/driver/run.js:89`
- Modify: `plugin/bin/drive.js:4-5`
- Modify: `.claude/skills/driver-step-addition/SKILL.md:10`
- No-change (classified): `docs/journeys/*.md` (say "nothing merges unless the record carries `auto:merge`" — still true as a necessary condition); `plugin/skills/dispatch/SKILL.md:263` (describes when the gate's file loads; 837 B headroom); `plugin/bin/lib/issues/grouping.js:202` (bundle bucketing, not authorization).
- Waived `plugin/bin/lib/release-claim/release.js`: read only, by Step 2's audit. Waived `plugin/bin/lib/reconcile/release-merged.js`: read only, by Step 2's audit.

- [ ] **Step 1: Edit**
  - `github-pr-scan.md` item 9: the classifier's record branch also requires `(labelsByIssue.get(n) || []).includes('auto:build')` for every linked record; prose line 224 and the ungranted message say `auto:build` and `auto:merge`. Net-neutral bytes (355 B headroom) — trim within item 9.
  - `tidy/actions-github-issues.md` line 80: the re-check reads "every linked record still carries `auto:build` and `auto:merge`".
  - `autonomy-ceiling.md` lines 217 and 226: a record carrying `auto:build` with `auto:merge` or a matured `auto:merge-pending`.
  - `work-record.md` Grant semantics (AC9.1): the `auto:merge` bullet states the rule once — "A merge grant (`auto:merge`, or `auto:merge-pending` at maturation) authorizes a merge only when the same live label read also carries `auto:build` (#5734): a typed run on a record without `auto:build` ends at `pending-review`, and a person merges it with `/claude-tweaks:wrap-up #N merge`." The typed-command bullet keeps "never implies `auto:merge`".
  - `docs/driver.md` (AC9.1): Build authority (line 37) states the same rule once in place of its parenthetical; lines 3 and 179 say `auto:merge` and `auto:build`.
  - `docs/hooks.md:120`: "so the run ends at `pending-review`" (drop "unless the record carries `auto:merge`" — a typed run's record has no `auto:build`).
  - `docs/plugin-structure.md:297`, `run.js:89`, `drive.js:4`, `driver-step-addition/SKILL.md:10`: "carries `auto:merge` and `auto:build`".

- [ ] **Step 2: Gotcha audit — label path cannot regress** — read every `auto:build` remover: `plugin/skills/dispatch/settle-and-merge.md` (failure Settle, steps 3 and 6 — a failed run only), `plugin/bin/lib/reconcile/release-merged.js` (`removeGrantLabels`, on merged-PR evidence), `plugin/bin/lib/release-claim/release.js` (`GRANT_LABELS`, release after merge/failure). Confirm none runs before the merge read of a run that should still merge; record the result as one `AC evidence` `decisions.md` entry via `log-decision.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T183729-record-5734" --section "/build" --status AUTO --step "AC evidence" --text-file {file}`.

- [ ] **Step 3: Verify no stale sentence remains (AC9.1)**

Run: `git grep -n -e "carries \`auto:merge\` and the" -e "carries auto:merge and the" -e "carry \`auto:merge\` (" -- docs/driver.md plugin/bin/lib/driver/run.js plugin/bin/drive.js docs/plugin-structure.md`
Expected: no output. Absence-grep control: `git grep -n -e "carries \`auto:merge\` and the" HEAD~1 -- docs/driver.md` matches line 3 before the edit.

- [ ] **Step 4: Run the affected suites**

Run: `node --test tests/bin-lib/driver/run.test.js tests/strip-comments-callers-twin.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan.md plugin/skills/tidy/actions-github-issues.md plugin/skills/_shared/autonomy-ceiling.md plugin/skills/_shared/work-record.md docs/driver.md docs/hooks.md docs/plugin-structure.md plugin/bin/lib/driver/run.js plugin/bin/drive.js .claude/skills/driver-step-addition/SKILL.md
git commit -m "State once that a merge grant counts only with a live auto:build — arm route, ceiling and driver docs, refs #5734"
```

## Spec coverage map

| AC clause | Where |
|---|---|
| AC1.1, AC1.2 | Task 2 Step 1 entry-read test |
| AC2.1, AC2.2 | Task 2 Step 1 pre-merge-read test |
| AC3.1 | Task 2 Step 4 (existing tests, both labels) |
| AC4.1, AC4.2, AC4.3, AC4.4 | Task 1 Step 1 |
| AC5.1, AC5.2, AC5.3 | Task 3 Step 1 |
| AC6.1 | Task 4 Step 1 conformance scan |
| AC7.1 | Task 4 Step 3 (`auto-merge-short-circuit.md`, `grant-maturation-gate.md`) and Task 5 Step 1 (`settle-and-merge.md`); verified by Task 5 Step 2's grep |
| AC7.2 | Task 4 Step 3 (short-circuit applicability) and Task 5 Step 1 (`express-lane.md`, `wrap-up/SKILL.md`); verified by Task 5 Step 2's grep |
| AC8.1 | Task 2 Step 5 go-red control |
| AC8.2 | Task 1 Step 5 go-red control |
| AC8.3 | PR body (below) |
| AC9.1 | Task 6 Steps 1 and 3 |
| AC10.1 | PR body (below) |

## PR body requirements (run, not a task)

Waived AC10.1: met in the PR body, not by a test. The PR body states the release order (this ships before thn-inc/claude-user-config#50); quotes the two red runs from `evidence/red-evaluator.txt` and `evidence/red-driver.txt` (AC8.1, AC8.2); records the `auto:build`-remover audit (Task 6 Step 2); and states the choices the decision rule settled — the resolve.js `merge` reason string kept unchanged; the caller scan in its own conformance file (project skill `bin-source-scan-conformance`) rather than inside `grant-maturation.test.js`; and the merge-authorizing readers outside Key Files brought in under Deliverable 1 (`github-pr-scan.md` item 9, `tidy/actions-github-issues.md`, `review-console.md`, `manifesto-authorized-merge.md`, `autonomy-ceiling.md`, `docs/hooks.md`, `docs/plugin-structure.md`).
