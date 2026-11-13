# Driver Merge Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the pipeline driver its step 10 — `plugin/bin/lib/driver/merge.js` takes a record whose live labels carry `auto:merge` from a green draft PR to a merged one, in program code, with no model call; with no judgment supplier configured it changes no production behavior.

**Architecture:** `merge(ctx, deps)` is one async function over the driver's injected `deps` seam, built from small step functions (entry, closing links, compose, mark ready, gate, watch, park, conflict, merge call, confirm, post-merge). `steps.js` gains one `STEPS` entry (`merge`) after `ci` that calls `merge` only when `ctx.ci === 'green'`; `run.js` gives steps an event writer on `ctx`, carries the merge result onto the final line, and follows the run directory into the archive after reconcile.

**Tech Stack:** Node 18+ CommonJS, `node --test`, the existing `plugin/bin` CLIs (`closing-links.js`, `compose-subject.js`, `ready-run.js`, `post-merge-run.js`, `resolve-policy.js`, `log-decision.js`, `hooks.js`), `gh` and `git` through `deps`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T071151-spec-5226/work/5226-spec.md` (record #5226). Interface facts below were extracted from the tree at `a351c8f72`; `file:line` cites are against it.

Scope keywords: MERGE_WATCH, summaryLogged, MERGE_STEP_NAMES

## Global Constraints

- No model call anywhere in `merge.js`: it requires none of `./worker`, `./roles` or a judgments module, never names `launchWorker`, never spawns `claude`; the supplier is reached only as `deps.judgments` (AC14).
- `merge.js` code (comments stripped) names no `rebase`, contains neither `--force` nor `--force-with-lease`, and passes no `merge` or `push` to git (AC6). Never `--admin`, never `--delete-branch` on `gh pr merge` (spec Gotchas).
- The string `gh pr merge` / a `pr`,`merge` argv appears only in `merge.js`; `steps.js` names neither `pr merge` nor `pr ready` (`run.test.js` AC8.1 regex `/pr['",\s]+merge|pr['",\s]+ready|gh pr merge|gh pr ready/` must keep passing on `steps.js`).
- `run.js` contains no step-name literal (`run.test.js` AC13.1 scans every `STEP_NAMES` entry quoted — `'merge'` is one once it joins `STEP_NAMES`).
- Every `pending-review` reason is one of the closed set: `no-supplier`, `labels-unreadable`, `not-authorized`, `summary-entry-missing`, `not-pr-first`, `gh-absent`, `supplier-failed`, `verdict-not-confirmed`, `acceptance-not-completed`, `compose-refused`, `ready-failed`, `state-read-failed`, `pr-not-open`, `moving-target`, `checks-read-failed`, `check-failed:{names}`, `checks-pending-timeout`, `draft-skip-without-ready-trigger:{files}`, `conflict`, `merge-refused`; anything else is `unclassified` with the failing step named in the event detail. Outcomes: `merged`, `armed`, `pending-review`.
- `--match-head-commit` is always `ctx.head`; no merge call goes out against any other head (AC9).
- Watch constants: `MERGE_WATCH_BOUND_MS = 15 * 60 * 1000`, `MERGE_WATCH_POLL_MS = 30 * 1000`, exported and pinned by value; poll counts in tests derive from them (driver-step-addition skill).
- Public comments are fixed templates filled with closed-set words; check names, file names and any free text go through `settle.js`'s exported `reduceDetail` (spec Gotchas; settle.js:37-59, exported :363-366).
- Classify a failed `gh` call on its **stderr** (`err.stderr`), never `err.message` — execFileSync's message embeds the whole argv, title included (steps.js:726-731).
- `post-merge-run.js` is routed on its `verdict`, never on exit 0 alone; exit 2/3 or unparseable stdout is a post-merge failure (interface ref §5: exits 0 when an entry printed, 2 malformed, 3 run dir missing/unanchored — the spec's "exits 0 in every state" holds only for a well-formed call on an anchored dir).
- No test reads `docs/driver.md` or any skill prose (spec Non-Goals).

Governing project skills — quoted verbatim where they bind this plan:

- `.claude/skills/driver-step-addition/SKILL.md` (Sites table): "`plugin/bin/lib/driver/events.js` `STEP_NAMES` | The step's name, at its table position. This list is the event vocabulary. Event fields may be added but never renamed, because the settle unit reads the final line's `stop`" · "`plugin/bin/lib/driver/run.js` `newCtx` and `interruptClass` | Needed only for a new durable side effect. … Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one" · "`realDeps` in `run.js` | Each new external call, as a `deps` member with its own bound (see `gh-api-module-pattern`). A new gh-shaped kind states its reason beside it, as `ghBatch` and `ghCreate` do" · "`tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else." · "`docs/driver.md` | Copied by hand, and no test reads it. For a new step: the `step` list under "Event lines"."
- Same skill, Decisions: "a step that awaits (`deps.sleep`, the worker) checks `ctx.shared.interrupted` after each await and stops before its next side effect" · "If the handler can report a step mid-flight, that step keeps on `ctx` whatever the interrupted line must carry, as the ci step does with `ctx.ci` and `ctx.ciWaitStartedAt`." · "The step's time constants are exported from `steps.js` and each is pinned by value in a test … Poll and call counts in tests are derived from those constants (`WINDOW_POLLS`), never written as numbers" · "The harness clock advances 1 per `now()` call and `ms` per `sleep(ms)`, and nowhere else." · "Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3)."
- `.claude/skills/bin-source-scan-conformance/SKILL.md`: "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`" (from `tests/bin-lib/driver/` the path is `../../helpers/strip-comments`) · "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15. … Add the stem to both lists in the commit that adds the suite. If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`".
- `.claude/skills/windows-checkout-test-parity/SKILL.md`: "Take `platform` and `env` as parameters, never stub `process.platform`". `merge.js` builds paths with `path.join` only and reads no platform-specific value; every spawn goes through `deps` (realDeps already sets `windowsHide: true`).
- `.claude/skills/gh-api-module-pattern` (named by the spec): every external call through `deps`; the per-call fail-safe — one failed call never throws out of `merge`, it becomes that step's `fail` event and the closed-set reason.
- `.claude/skills/regex-scan-linearity`, `headless-worker-launch`, `upstream-repin`, `transcript-payload-verification` name driver files but govern scanners, the worker step, pin bumps and transcripts — none of which this plan touches.
- Source-scan lint (path-guard conformance): no bare `fs.existsSync` / `fs.realpathSync` in `merge.js`; existence checks use `deps.lstatType(p)` (realDeps `lstatType`, run.js:457, from `../path-guard`).

## Review Focus

1. A record whose `auto:merge` label is removed while the bounded watch runs — the next pre-merge label read must refuse (`not-authorized`), never merge on the first read's authority. Test: Task 5 `AC1.4`.
2. A PR that turns conflicting mid-watch must stop as `conflict` at that poll, not time out (#5179's gap). Test: Task 4 `AC10.2`.
3. A `gh pr merge` that exits 0 but whose confirmation read fails twice must never report `merged` and never run post-merge. Test: Task 5 `AC11.9`.
4. A reconcile that archives the run directory: the remaining decisions writes and the final event must land in `archive/{run-id}/`, never fail silently against the moved path. Test: Task 6 `AC12.6` and Task 7's sink rebind test.
5. An `--auto` call refused because auto-merge is not enabled must degrade to a fresh state read (the `wait` row), never an immediate merge without one, and an immediate call can never degrade again (no loop). Test: Task 5 `AC11.1`, `AC11.2`.

## Spec coverage map (authoritative for clause ids)

Clause ids are `plan-audit.js`'s split of the spec's Acceptance Criteria (`AC{item}.{clause}`). **Every test cites the ids this map gives it, in its name** — where a sample test name in a task step carries a different id, this map wins and the implementer renames it.

| Clause | Task | Test |
|---|---|---|
| AC1.1 | 1 | no supplier makes no call at all |
| AC1.2 | 7 | with no supplier, no call is recorded after the `ci` event |
| AC1.3, AC1.4, AC1.5 | 1 | labels without auto:merge / unreadable, PR stays draft, no ready, no merge |
| AC1.6 | 5 | label removed between reads → not-authorized; failed pre-merge read → labels-unreadable; a re-entered gate reads labels again before its merge call |
| AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6, AC2.7 | 1 | the one table-driven entry-refusal test with residue per row |
| AC3.1, AC3.2 | 1 | supplier auto-merge without a confirmed line (fixtures from `verdictMarker`) |
| AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.6, AC4.7, AC4.8, AC4.9, AC4.10 | 5, 6 | happy-path call order (Task 5 to the confirm read, Task 6 completes it) |
| AC4.11 | 5, 7 | `merge` returns `merged`; run-level: a stand-in merge step setting `ctx.merge` makes the final line's `outcome` `merged` |
| AC4.12, AC4.13 | 2 | already-ready skip logged; failed isDraft / ready → ready-failed |
| AC5.1, AC5.2, AC5.3, AC5.4, AC5.5, AC5.6, AC5.7 | 3, 4 | red / draft-skip / read-failure / not-open rows; label-retry re-draft; timeout park (Task 4) |
| AC6.1 | 3, 4, 5 | conflict on the first read (3), mid-watch (4), on a merge failure signature (5) |
| AC6.2, AC6.3 | 8 | source scan with go-red controls; real-git tips unchanged |
| AC7.1, AC7.2, AC7.3 | 2 | compose exit 1 → compose-refused, PR draft, no ready recorded |
| AC8.1 | 1 | off / empty / error / missing / exit 1 / unparseable / timeout → wait; a failed lever read never stops entry (separate integration-model read) |
| AC8.2, AC8.3 | 3, 4 | merge-when-green green/BLOCKED/other (Task 4: a BLOCKED pending poll arms); wait re-read before immediate merge; a state read precedes every merge call |
| AC9.1, AC9.2, AC9.3, AC9.5 | 3 | first read ≠ ctx.head; one change re-enters; two changes → moving-target |
| AC9.4 | 5 | every recorded `pr merge` call (auto, immediate, degraded, re-entered) carries `--match-head-commit` = `ctx.head` |
| AC10.1, AC10.2 | 4 | constants by value; red at any poll; conflict mid-watch |
| AC10.3 | 4, 7 | `ciWaitMs` on the `merge-watch` event; run-level: `msWithoutCi` excludes it |
| AC11.1, AC11.2, AC11.3, AC11.4, AC11.5, AC11.6, AC11.7 | 5 | signature table, degrade-to-wait, no second degrade, confirm outcomes, retry-once, exit 0 alone never merged |
| AC11.8 | 2 | compose exit 2 → gh-absent |
| AC12.1, AC12.2, AC12.3, AC12.4, AC12.5, AC12.6, AC12.7, AC12.8, AC12.9, AC12.10, AC12.11 | 6 | order, failures stay merged, integration-branch guard, ref-missing success, archive follow, stdout-only, reconcile failure keeps path; AC12.10 also in 7 (`eventsFile: 'stdout-only'`) |
| AC13.1 | 8 | verify exits 0 for merged, armed, pending-review-after-red fixtures |
| AC14.1, AC14.2 | 8 | no model module/launcher/claude spawn; `judgments` appears in merge.js only as `deps.judgments` |
| AC15.1 | 7 | constants update; green path unchanged apart from the merge step's own event |

---

## Shared shapes (every task reads this)

`merge.js` exports:

```js
module.exports = {
  merge,                       // (ctx, deps) => Promise<MergeResult>
  MERGE_WATCH_BOUND_MS, MERGE_WATCH_POLL_MS, RECONCILE_TIMEOUT_MS, // 900000, 30000, 150000
  REASONS,                     // frozen array of the closed reason stems (without ':{names}' / ':{files}' tails)
  classifyMergeFailure,        // (stderr: string) => 'auto-not-allowed'|'checks'|'conflict'|'permission'|'unrecognized'
  parkComment, conflictComment,// fixed templates (Task 3)
};
```

- `ctx` (built by `steps.js`, Task 7): `{ record, pr, repo, branch, base, head, runDir, runRoot, mainCheckout, worktree, summaryLogged }` — `record`/`pr` integers, `repo` `owner/name`, `head` the 40-char sha `express-lane.js check` verified, `base` the integration branch name, `runRoot`/`mainCheckout` the main checkout path.
- `deps`: the driver's realDeps members (`gh`, `ghCreate`, `git`, `node`, `readFile`, `writeFile`, `mkdirSync`, `lstatType`, `ghAvailable`, `now`, `sleep`, `env`) plus, from the step entry: `judgments` (optional), `emit(step, status, ms, detail, extra)`, `rebindEvents(dirOrNull)`, `interrupted()` → falsy or the signal name, `watchClock(startedAtOrNull)`.
- `MergeResult`: `{ outcome, reason, detail, mergeCommit, runDir, ciWaitMs, postMerge }` per the spec's Data / API Surface (`runDir: string` — never `null`), plus one additive field `eventsStdoutOnly: boolean` (default `false`): `true` when neither the run dir nor its archive twin exists after reconcile, in which case `runDir` keeps the original path string and the final event goes to stdout only.
- Internal state object `s = { ctx, deps, runDir, value, source, valueRaw, keepOpen, subject, reentries, ciWaitMs, lastRead, logFailures }` threads through the step functions; every step function is `async (s) => Step` where `Step` is `{ ok: true, ... } | { stop: reason, detail }`.
- Sub-step event names, emitted through `deps.emit` (one event per sub-step call, `status` `ok`|`stop`|`fail`, `detail` neutralized): `MERGE_STEP_NAMES = ['merge-entry', 'merge-supplier', 'merge-closing-links', 'merge-compose', 'merge-ready', 'merge-gate', 'merge-watch', 'merge-park', 'merge-conflict', 'merge-call', 'merge-confirm', 'merge-post-merge', 'merge-release-status', 'merge-reconcile', 'merge-teardown', 'merge-delete-branch']` — defined in `events.js` (Task 7) alongside `SETTLE_STEP_NAMES`; until Task 7 lands, `merge.js` imports it from `./events` and Task 1 adds it there (see Task 1 Files).
- Decision lines go through `log-decision.js --run {runDir} --status {AUTO|SKIP} --section /express-lane --step {step} --text-file {runDir}/merge-log-{k}.txt` (cwd `mainCheckout`, timeout `CLI_TIMEOUT_MS`), mirroring `steps.js`'s `logDecisionFile` (steps.js:609-617). A non-zero exit never stops the merge: append `log:{step}` to `s.logFailures` and name it in that sub-step's event detail.
- `unclassified`: `merge` wraps its whole body in `try`; a throw from any step function yields `{ outcome: 'pending-review', reason: 'unclassified', detail: '{sub-step}: {neutralized error text}' }`. `merge` itself never throws.

---

### Task 1: merge.js skeleton and entry conditions

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/merge.js`
- Modify: `plugin/bin/lib/driver/events.js` (add `MERGE_STEP_NAMES` frozen array after `SETTLE_STEP_NAMES`, export it)
- Create: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: `events.js` `neutralize`, `firstLine`, `errorText`, `CLI_TIMEOUT_MS`, `MERGE_STEP_NAMES`; `../dispatch/merge-verdict` `confirmFromFile(file, members)` → `{ [n]: { confirmed, latest, error? } }`.
- Produces: `merge(ctx, deps)`; internal `entry(s)` returning `{ ok: true }` or `{ stop }`; `s.value` (`'merge-when-green'|'wait'`), `s.source`, `s.valueRaw`; the test harness `mergeHarness(over)` (see Step 1) every later task's tests reuse.

Header comment: names `_shared/pr-first-merge.md` Steps 2 to 3, `_shared/pr-first-merge-post-merge.md` Steps 4 and 5, and `_shared/express-lane.md` step 9 as the ported procedure; states no test reads that prose and drift is accepted by design (spec Gotchas); each step function's comment names the section it ports, citing symbols, not line numbers.

Entry order (spec Technical Approach "Entry, in this order"), each failure `pending-review` with no label, no comment, no ready and no merge call:
1. `typeof deps.judgments !== 'function'` → `no-supplier`, **zero calls of any kind** (no `ghAvailable`, no read, no emit other than the `merge-entry` event).
2. `deps.ghAvailable()` false → `gh-absent`.
3. Labels: `deps.gh(['issue', 'view', String(record), '--repo', repo, '--json', 'labels'])`; a throw or a payload whose `labels` is not an array of `{ name }` → `labels-unreadable`; no `name === 'auto:merge'` exactly (`auto:merge-pending` does not count) → `not-authorized`.
4. `ctx.summaryLogged !== true` → `summary-entry-missing`.
5. Two separate `resolve-policy.js` reads, so a failure of one never decides the other (AC8: every failure of the lever read is `wait`, never a stop). Both `deps.node(bin('resolve-policy.js'), args, { cwd: mainCheckout, timeout: CLI_TIMEOUT_MS, env: deps.env })`.
   - **5a integration-model** (entry condition): `args = ['--run', runDir, '--values', 'integration-model']`. Exit non-zero, `code === null`, or `stdout.trim() !== 'pr-first'` → `not-pr-first`. Then `run-state.json` via `deps.readFile(path.join(runDir, 'run-state.json'))`; unparseable or `pr.number` not a positive integer → `not-pr-first`.
   - **5b merge-verification** (never a stop): `args = ['--run', runDir, 'merge-verification']` — the JSON form of the spec's `--values merge-verification` read, so the source rides along for the `--lever` log field (probed: `node plugin/bin/resolve-policy.js --run {this run's dir} --values merge-verification` printed `merge-when-green`, exit 0; the JSON form printed `{"merge-verification":{"value":"merge-when-green","source":"run-config"}}`). `raw = parsed['merge-verification'].value`; exit non-zero, `code === null`, unparseable stdout, an entry carrying `error`, a missing entry, or a non-string value → `raw = ''`, `s.source = 'unresolved'`. `s.value = raw === 'merge-when-green' ? 'merge-when-green' : 'wait'`, `s.valueRaw = raw`, `s.source = entry.source || 'unresolved'`; when `raw` is not `merge-when-green` or `wait` (including `off` and every failure), log `AUTO` step `Step 2.5` text `lever unresolved ("{neutralized raw}") — proceeding as wait` (for `off`: `lever off is not ported on the driver lane — proceeding as wait`). 5b runs after 5a passes, before the supplier.
6. Supplier: `await deps.judgments(ctx)` in try. Throw/reject, or a return that is not an object with `mergeCheck.verdict` a string and `acceptance.completed` a boolean → `supplier-failed`. `mergeCheck.verdict !== 'auto-merge'` → `verdict-not-confirmed`. `acceptance.completed !== true` → `acceptance-not-completed`. Then `confirmFromFile(path.join(runDir, 'decisions.md'), [record])[record].confirmed !== true` → `verdict-not-confirmed` (detail names `latest` or `error`).

- [ ] **Step 1: Write the failing tests**

Harness in `merge.test.js` (mirror `run.test.js`'s scripted dispatcher, run.test.js:263-328): `mergeHarness(over)` returns `{ deps, calls, events, logs, clock }`; `calls` records `{ kind, args, cwd }` for `gh`, `ghCreate`, `git`, `node`, `judgments`, `ghAvailable`, `readFile`, `lstatType` (its default reply is the real `{ type, code }` object — `{ type: 'directory', code: null }` / `{ type: 'missing', code: 'ENOENT' }` — never a bare string); a scripted list `[matcher, reply]` with `over.script` tried first, then `defaultMergeScript(over)` (the full happy path: labels `[{name:'auto:merge'}]`, resolve-policy `--values integration-model` → stdout `pr-first\n`, resolve-policy `merge-verification` → `{"merge-verification":{"value":"merge-when-green","source":"run-config"}}`, run-state `{ pr: { number: 9 } }`, every later task appends its happy replies here); no match throws `unexpected {kind} {args}`. `fx = fixture()` builds a real temp main checkout (`.git` dir) with `.claude-tweaks/pipelines/2026-11-13T000000-drive-7/` holding `decisions.md` whose verdict line is built with `merge-verdict.js`'s own `verdictMarker(VERDICT_STEPS.gate, 7)` + `formatEntry`-shaped text `- AUTO 09:00:00 — {marker}. Reversibility: high.`; `CTX = { record: 7, pr: 9, repo: 'o/r', branch: 'drive-7', base: 'main', head: 'a'.repeat(40), runDir, runRoot: main, mainCheckout: main, worktree, summaryLogged: true }`. Clock: `now()` +1 per call, `sleep(ms)` +ms.

```js
test('AC1.1: no supplier makes no call at all and returns no-supplier', async () => {
  const h = mergeHarness({ deps: { judgments: undefined } });
  const r = await merge(CTX, h.deps);
  assert.deepEqual(pick(r), { outcome: 'pending-review', reason: 'no-supplier', mergeCommit: null, postMerge: null });
  assert.deepEqual(h.calls, []);
});
test('AC1.2, AC1.3: labels without auto:merge, empty, auto:merge-pending only → not-authorized; unreadable → labels-unreadable', async () => {
  for (const [labels, reason] of [[[], 'not-authorized'], [[{ name: 'auto:merge-pending' }], 'not-authorized'], [[{ name: 'auto:build' }], 'not-authorized'], [new Error('HTTP 502'), 'labels-unreadable'], ['not json', 'labels-unreadable']]) {
    const h = mergeHarness({ labels });
    const r = await merge(CTX, h.deps);
    assert.equal(r.reason, reason);
    assertNoReadyNoMerge(h);   // no gh pr ready / gh pr merge in h.calls (any kind)
  }
});
// AC2: one table-driven test, one row per reason, each asserting the residue table's row 1 (PR draft untouched: no `pr ready`; labels none written: no `issue edit`; comments none: no `issue comment`/`pr comment`)
test('AC2.1–AC2.6: entry refusals with their residue', async () => { /* rows: summaryLogged false/'true'/undefined → summary-entry-missing; resolve-policy 'local-merge' / exit 1 / run-state without pr → not-pr-first; ghAvailable false → gh-absent (and no labels read: AC ordering); judgments throws / rejects / returns null / {mergeCheck:{verdict:1}} / {acceptance:{completed:'yes'}, mergeCheck:{verdict:'auto-merge'}} → supplier-failed; verdict 'needs-human' → verdict-not-confirmed; completed false → acceptance-not-completed */ });
test('AC3.1–AC3.3: a supplier auto-merge without a confirmed decisions.md line is verdict-not-confirmed', async () => { /* rows: decisions.md with no verdict line; decisions.md missing (unreadable → error); a confirmed line followed by verdictMarker(VERDICT_STEPS.gate, 7, 'needs-human') — each: reason verdict-not-confirmed, no closing-links.js call, no ready, no merge */ });
test('AC8.1: merge-verification off, empty, unparseable and a resolver error all run as wait', async () => { /* merge-verification read rows: {value:'off'}, {value:''}, {error:'boom'}, a missing key, exit 1 with stderr, unparseable stdout 'not json', code null (timeout) → the entry passes (no not-pr-first, the supplier is called), s.value 'wait' and the AUTO 'lever unresolved' / 'lever off' log line is written for each; Task 3 adds: the first gh pr merge (when reached) carries no --auto */ });
test('AC8.1: a failed merge-verification read never stops entry; a failed integration-model read is not-pr-first', async () => { /* integration-model --values exit 1 → not-pr-first and no merge-verification read; integration-model ok + merge-verification exit 1 → supplier called (entry passes) */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/driver/merge.test.js`
Expected: FAIL — `Cannot find module '…/driver/merge'`.

- [ ] **Step 3: Implement `merge(ctx, deps)` skeleton + `entry(s)` in `plugin/bin/lib/driver/merge.js`**

`merge` builds `s`, runs `entry`, and (until later tasks) returns `pending-review` with reason `unclassified` and detail `not implemented past entry` when entry passes — Task 2 replaces that tail. Result fields default `mergeCommit: null`, `postMerge: null`, `ciWaitMs: 0`, `runDir: ctx.runDir` (always a string), `eventsStdoutOnly: false`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/driver/merge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/merge.js plugin/bin/lib/driver/events.js tests/bin-lib/driver/merge.test.js
git commit -m "Add driver merge entry conditions — supplier, labels, summary, pr-first, verdict confirmation"
```

---

### Task 2: closing links, subject composition, mark ready

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js`
- Test: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: Task 1's `s`, `entry`.
- Produces: `closingLinks(s)` → sets `s.keepOpen` (`[record]` or `[]`); `compose(s)` → `{ ok, title, bodyFile }` or `{ stop: 'compose-refused'|'gh-absent'|'unclassified' }`, sets `s.subject`; `markReady(s)` → `{ ok }` or `{ stop: 'ready-failed' }`. `compose(s)` runs here once and again only on Task 3's gate re-entry — never as an extra call before the merge call (spec Plan Review Clarifications: decided by the user at plan review); Task 5's merge call uses `s.subject` as it stands.

- **Closing links** (ports `_shared/pr-checklist-refresh.md` "Then check the forge's closing links"): `deps.node(bin('closing-links.js'), ['--run', runDir, '--mode', 'pre-merge'], nodeOpts)`. Exit 0 with an envelope carrying `keepOpen` (actions `clean`/`unlinked`/`still-linked`) → `s.keepOpen = keepOpen.includes(record) ? [record] : []`. `still-linked` is left for post-merge Step 4.0 (event detail says so). Exit 3, 4, 5, any other non-zero, unparseable stdout, or action `gh-absent`/`no-pr`/`no-fixes-span` → warn (event `ok`, detail names the exit/action) and proceed with `s.keepOpen = []`; exit 3 or any exit other than 0/4/5 also logs a `SKIP` (step `Closing links (pre-merge) (degraded)`, text `condition: closing-links.js exited {code} → fallback: closing links not checked this merge`) — closing-links.js self-logs only gh-absent, 4 and 5 (interface ref §1).
- **Compose** (ports Step 3's composer fence): out dir `path.join(runDir, 'merge-subject')`; `deps.node(bin('compose-subject.js'), [String(record), '--repo', repo, '--tag', 'auto-merge', ...(s.keepOpen.length ? ['--keep-open', String(record)] : []), '--pr', String(pr), '--out-dir', outDir], nodeOpts)`. Exit 1 → `compose-refused`, detail `reduceDetail(firstLine(stderr))`; exit 2 → `gh-absent`; exit 3 or other → `unclassified` (detail `compose: compose-subject.js exited {code}`). On exit 0 read `title.txt` via `deps.readFile`; title empty/unreadable → `unclassified`. `bodyFile = path.join(outDir, 'body.md')`. Never parse the composer's single-quoted stdout line.
- **Mark ready** (ports Step 2): `deps.gh(['pr', 'view', String(pr), '--repo', repo, '--json', 'isDraft'])` → `JSON.parse(...).isDraft`; throw or non-boolean → `ready-failed`. `true` → `deps.gh(['pr', 'ready', String(pr), '--repo', repo])` (throw → `ready-failed`), log `AUTO` step `Step 2 (mark ready)` text `undrafted PR #{pr} (was draft).` reversibility `high (gh pr ready {pr} --undo)`; `false` → no ready call, log `PR #{pr} already ready — skipped gh pr ready.` reversibility `n/a (no state change)`. (Pass `--reversibility` as a separate log-decision argument.)

Order after entry: closing links → compose → mark ready (compose precedes ready on purpose: a refusal leaves the PR in draft, spec Gotchas).

- [ ] **Step 1: Write the failing tests**

```js
test('AC7.1: compose-subject exit 1 is compose-refused with the reduced stderr line, PR still draft', async () => {
  const h = mergeHarness({ compose: { code: 1, stdout: '', stderr: 'compose-subject.js: record(s) #7 carry no non-empty "## Release Note" section\n' } });
  const r = await merge(CTX, h.deps);
  assert.equal(r.reason, 'compose-refused');
  assert.match(r.detail, /carry no non-empty/);
  assert.ok(!h.calls.some(isReadyCall), 'no gh pr ready recorded');
});
test('AC11.10: compose-subject exit 2 is gh-absent', async () => { /* … reason gh-absent, no ready */ });
test('compose argv: --tag auto-merge, --pr, --out-dir under the run dir, --keep-open only when closing-links keepOpen names the record', async () => { /* two runs: keepOpen [] → no --keep-open; keepOpen [7, 12] → ['--keep-open','7'] */ });
test('closing-links exit 3 warns, logs a SKIP and proceeds; exit 5 proceeds without a second SKIP', async () => {});
test('AC4.3: an already-ready PR skips gh pr ready and logs the skip', async () => {});
test('AC4.4: a failed isDraft read or a failed gh pr ready is ready-failed and no merge call', async () => {});
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/driver/merge.test.js` → FAIL (reason `unclassified`).
- [ ] **Step 3: Implement `closingLinks`, `compose`, `markReady`** and chain them after `entry`; the tail stays `unclassified … not implemented past ready` until Task 3.
- [ ] **Step 4: Run to verify they pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add driver merge closing-link check, subject composition and mark-ready"` (stage the two files).

---

### Task 3: the merge-verification gate, Red path and Conflict path

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js`
- Test: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: `../pr-checks/classify` `normalizeEntry`, `FAILING_CONCLUSIONS`; `./settle` `reduceDetail`; `../issues/labels` `ensureLabelPayload(name, description, color)`; `../issues/record-vocabulary` `LABELS.BOT_PARKED`.
- Produces: `gateReads(s)` → `{ read, runs, ready }` or `{ stop: 'state-read-failed'|'checks-read-failed' }` (the caller passes which word a read failure maps to); `classify(read, runs, ready)` → `{ kind: 'red', names } | { kind: 'draft-skip', files } | { kind: 'conflict' } | { kind: 'pending' } | { kind: 'green' }`; `gate(s)` → final `{ stop }` or hands off to `mergeCall(s, mode)` (Task 5) / `watch(s)` (Task 4); `park(s, reason, phrase)`; `conflictStop(s)`; `parkComment({ value, reason, pr, names, files })`, `conflictComment({ pr, base })`.

Reads (ports Step 2.5 "Read state first"), each through `deps.gh`:
- `['pr', 'view', String(pr), '--repo', repo, '--json', 'state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup']` — must parse with those five fields.
- `['run', 'list', '--repo', repo, '--commit', headRefOid, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url']` — must parse as an array.
- `ready-run.js`: `deps.node(bin('ready-run.js'), ['--pr', String(pr), '--sha', headRefOid], { cwd: mainCheckout, … })` — non-zero exit or no `state` → read failure; `state: 'read-failed'` → read failure.

`gate(s)` algorithm (ports Step 2.5's table, `merge-when-green` and `wait` columns only — the `off` column is not ported):
1. First read fails → `state-read-failed` (no park). `state !== 'OPEN'` → `pr-not-open` (no park, no merge). `headRefOid !== ctx.head` → `moving-target`.
2. `mergeStateStatus === 'DIRTY' || mergeable === 'CONFLICTING'` → Conflict path (before reading runs).
3. Runs read, ready-run read; either fails → `state-read-failed`.
4. `classify`, in this order: any rollup entry (after `normalizeEntry`) with conclusion in `FAILING_CONCLUSIONS`, or any run with `status === 'completed'` and `conclusion.toUpperCase()` in it, or ready-run `red` → `red` (names: failing rollup entry names + failing runs' `workflowName` + ready-run `failing[].name`, de-duplicated); ready-run `draft-skip-without-ready-trigger` → `draft-skip` (files `draftSkipWithoutReadyTrigger`); ready-run `awaiting`, any rollup entry not `COMPLETED`, any run not `completed`, or an empty rollup → `pending`; otherwise `green`.
5. `red` → `park(s, 'check-failed:' + names.join(','), …)`; `draft-skip` → `park(s, 'draft-skip-without-ready-trigger:' + files.join(','), …)`.
6. `merge-when-green`: `green` → `mergeCall(s, 'auto')`; `pending` with `mergeStateStatus === 'BLOCKED'` → `mergeCall(s, 'auto')` (arm); `pending` otherwise → `watch(s)`.
7. `wait`: `green` → `rereadThenMerge(s)`; `pending` → `watch(s)`.
8. `rereadThenMerge(s)`: `['pr', 'view', String(pr), '--repo', repo, '--json', 'state,mergeStateStatus,headRefOid']`; read fails → `state-read-failed`; `headRefOid` differs from the first read's or `state !== 'OPEN'` → re-enter `gate` from step 1 once (`s.reentries += 1`, re-run `compose(s)` first — the only recompose; a refusal there returns its reason with the PR ready, and the event says so); a second change (`s.reentries >= 1` already) → `moving-target`; else `mergeCall(s, 'immediate')`.

Red path `park(s, reason, phrase)` (ports Step 2.5 "Red path"): never merge, never re-draft except the fallback.
- Bootstrap: `ensureLabelPayload('bot:parked', 'Bot state: merge-verification parked it (CI red/timed-out) — auto:* grants stay intact', '6A737D')`; `deps.gh(['label', 'list', '--repo', repo, '--search', name, '--json', 'name', '-q', '.[].name'])`; absent → `deps.gh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description])`. (Mirrors `claim-targets.js`'s private `ensureAndAddLabel`, claim-targets.js:180-188.)
- Add: `deps.gh(['issue', 'edit', '--repo', repo, '--add-label', 'bot:parked', '--', String(record)])`; re-read labels (`['issue', 'view', String(record), '--repo', repo, '--json', 'labels']`); missing → add once more, re-read once more; still missing → `deps.gh(['pr', 'ready', String(pr), '--repo', repo, '--undo'])` (the only re-draft in the module) and the event/log say `bot:parked NOT applied to #{record}; PR re-drafted as the fallback lock`.
- Comment on the record: `deps.gh(['issue', 'comment', '--repo', repo, '--body', parkComment({...}), '--', String(record)])` (settle's argv shape, settle.js:246).
- Log `AUTO` step `Step 2.5 (merge-verification gate)` text `parked — {reason} on PR #{pr}; bot:parked applied to #{record}` (or the NOT-applied variant), reversibility `high (label removal + resume)`, `--lever "merge-verification={s.value} ({s.source})"` (log-decision.js USAGE: `[--lever "<k>=<v> (<source>)"]`). The armed line in Task 5 carries the same `--lever`.
- Result: `pending-review`, the reason as passed.

`parkComment({ value, reason, pr, names, files })` — fixed template, exactly:
`Parked by merge-verification (${value}): ${phrase} on PR #${pr}. ${resume}` where `value ∈ {merge-when-green, wait}` (anything else → `wait`), `phrase` is `reduceDetail(names.join(', '))` for `check-failed`, `checks still pending after 15m` for `checks-pending-timeout`, `${reduceDetail(files.join(', '))} skips drafts with no ready_for_review trigger — add ready_for_review to its types (_shared/ci-skips-drafts.md)` for draft-skip; `resume` is `Resume once its workflow is fixed or a post-ready run lands.` for draft-skip, else `Resume once green.`

Conflict path `conflictStop(s)`: one PR comment `deps.gh(['pr', 'comment', '--repo', repo, '--body', conflictComment({ pr, base }), '--', String(pr)])`; no git call, no further gh call; result `pending-review` / `conflict`; PR left as it is (ready). `conflictComment` exactly: `Merge stopped: PR #${pr} conflicts with ${reduceDetail(base)}. The driver does not update a conflicting branch; resolve the conflict and run the record again.`

- [ ] **Step 1: Write the failing tests**

```js
// AC5: one row per state; outcome pending-review in all; asserts residue per the spec's table rows 2–4
test('AC5.1–AC5.6: red, draft-skip and read failures never merge', async () => { /* rows:
  rollup FAILURE entry 'unit' → reason 'check-failed:unit', issue edit --add-label bot:parked, one issue comment equal to parkComment(...), no pr merge, PR not re-drafted;
  head run completed/failure workflowName 'lint' → 'check-failed:lint';
  ready-run red failing [{name:'e2e'}] → 'check-failed:e2e';
  ready-run draft-skip draftSkipWithoutReadyTrigger ['.github/workflows/test.yml'] → 'draft-skip-without-ready-trigger:.github/workflows/test.yml', comment uses the draft-skip resume;
  state read throws → 'state-read-failed', no label, no comment;
  run list throws / ready-run exit 2 / ready-run state read-failed → 'state-read-failed', parks nothing;
  state CLOSED → 'pr-not-open', no park, no merge */ });
test('AC5.7: label still missing after one retry re-drafts the PR and says so', async () => { /* labels re-read twice without bot:parked → exactly one gh pr ready --undo; event detail matches /re-drafted/ */ });
test('AC5.8: bot:parked is bootstrapped (label create) when the repo lacks it', async () => {});
test('AC6.1: DIRTY or CONFLICTING on the first read is conflict: one PR comment, no further call', async () => { /* both variants; after the comment, h.calls has nothing more; reason conflict */ });
test('AC9.1: a first read whose headRefOid differs from ctx.head is moving-target, no merge call', async () => {});
test('AC9.2: a head change between the first read and the re-read re-enters once and then merges (wait)', async () => { /* first read head==ctx.head, reread head 'b'*40 → re-entry → first read again head==ctx.head, reread same → merge call; exactly 2 compose-subject.js calls total (initial before ready, re-entry); stub mergeCall reached */ });
test('AC9.3: two changes return moving-target', async () => {});
test('AC8.2: merge-when-green pending with BLOCKED arms; pending with CLEAN runs the wait row (watch)', async () => {});
test('AC8.3: wait re-reads state and compares the head before the immediate merge', async () => { /* the reread call precedes the merge call; merge argv has no --auto */ });
test('AC8.4: a state read always precedes the first merge call under every lever value', async () => {});
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/driver/merge.test.js` → FAIL.
- [ ] **Step 3: Implement `gateReads`, `classify`, `gate`, `rereadThenMerge`, `park`, `conflictStop`, `parkComment`, `conflictComment`**; `watch` and `mergeCall` are stubs returning `{ stop: 'unclassified' }` with detail `watch not implemented` / `merge call not implemented` until Tasks 4 and 5 (tests that reach them assert only the calls before them).
- [ ] **Step 4: Run to verify they pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add driver merge-verification gate — Red path park, Conflict path, head guard and re-entry"`.

---

### Task 4: the bounded watch

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js`
- Test: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: Task 3's `gateReads`, `classify`, `park`, `conflictStop`, `rereadThenMerge`.
- Produces: `watch(s)`; `s.ciWaitMs` (ms spent in the watch, summed across re-entries); exports `MERGE_WATCH_BOUND_MS = 900000`, `MERGE_WATCH_POLL_MS = 30000`.

`watch(s)` (ports Step 2.5 "Bounded watch", deliberately **not** the prose loop's shape — #5179): `started = deps.now()`, `deps.watchClock(started)`; loop: `await deps.sleep(MERGE_WATCH_POLL_MS)`; if `deps.interrupted()` → return `{ stop: 'unclassified', detail: 'watch: interrupted' }` immediately (run.js's handler already wrote the final line; no further call); run `gateReads(s)` with read failures mapped to `checks-read-failed`; first read `state !== 'OPEN'` or `headRefOid !== s.lastRead.headRefOid` → re-entry per Task 3 step 8's rule (counts against the same single re-entry); `DIRTY`/`CONFLICTING` → `conflictStop(s)` at this poll; `red` → `park(... 'check-failed:…')`; `draft-skip` → `park(...)`; `green` → `rereadThenMerge(s)` (immediate merge — the `wait` row); under `s.value === 'merge-when-green'`, `pending` with this poll's `mergeStateStatus === 'BLOCKED'` → `mergeCall(s, 'auto')` (arm — Task 3 step 6's rule applies at every poll, AC8.2); `pending` and `deps.now() - started >= MERGE_WATCH_BOUND_MS` → `park(s, 'checks-pending-timeout', …)`; else continue. On every exit: `s.ciWaitMs += deps.now() - started`, `deps.watchClock(null)`; the `merge-watch` event carries `extra: { ciWaitMs }` so run.js's final line counts it as CI wait (run.js:179).

- [ ] **Step 1: Write the failing tests**

```js
const WATCH_POLLS = Math.ceil(MERGE_WATCH_BOUND_MS / MERGE_WATCH_POLL_MS);
test('AC10.1: the watch constants are 15 minutes and 30 seconds', () => {
  assert.equal(MERGE_WATCH_BOUND_MS, 15 * 60 * 1000);
  assert.equal(MERGE_WATCH_POLL_MS, 30 * 1000);
});
test('AC10.2: a PR that turns conflicting mid-watch returns conflict at that poll, not checks-pending-timeout', async () => { /* pending on first read and 2 polls, DIRTY on poll 3 → reason conflict; exactly 3 sleeps recorded */ });
test('AC10.3: a red result at any poll takes the Red path at once', async () => {});
test('AC10.4: still pending at the bound parks as checks-pending-timeout after WATCH_POLLS polls', async () => { /* sleeps recorded === WATCH_POLLS (derived), reason checks-pending-timeout, bot:parked added */ });
test('AC10.5: watch time is reported as ciWaitMs', async () => { /* result.ciWaitMs >= (polls * MERGE_WATCH_POLL_MS); merge-watch event extra.ciWaitMs equal */ });
test('AC5.9: a read failure during the watch is checks-read-failed and parks nothing', async () => {});
test('watch: a green poll re-reads and merges immediately (no --auto)', async () => {});
test('AC8.2: under merge-when-green a pending poll that reads BLOCKED arms (--auto), under wait it keeps watching', async () => { /* merge-when-green: first read pending/CLEAN → watch; poll 1 pending/BLOCKED → exactly one pr merge call carrying --auto, no further sleep; wait: same script → no merge call at poll 1, the watch continues */ });
test('watch: an interrupt during a sleep makes no further call', async () => { /* deps.interrupted returns 'SIGTERM' after first sleep → no gh call after the sleep */ });
```

- [ ] **Step 2: Run to verify they fail** — FAIL (stub `watch not implemented`).
- [ ] **Step 3: Implement `watch(s)`** replacing the stub.
- [ ] **Step 4: Run to verify they pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add driver merge bounded watch — merge state re-read every poll"`.

---

### Task 5: Step 3's merge call, failure signatures and confirmation

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js`
- Test: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: Task 2's `s.subject` (`{ title, bodyFile }`, from the initial compose or Task 3's re-entry recompose), Task 1's label read (factor it as `readLabels(s)` → `{ ok, names } | { stop }`), Task 3's `rereadThenMerge`, `conflictStop`.
- Produces: `mergeCall(s, mode)` where `mode ∈ {'auto', 'immediate'}`; `confirm(s)` → `{ outcome: 'merged'|'armed', mergeCommit }` or `{ stop }`; `classifyMergeFailure(stderr)` (exported).

`mergeCall(s, mode)`:
1. `readLabels(s)` again — no `auto:merge` → `not-authorized`; failed read → `labels-unreadable` (AC1 last clauses: on every entry of the gate, immediately before every `gh pr merge`).
2. `deps.ghCreate(['pr', 'merge', String(pr), '--repo', repo, ...(mode === 'auto' ? ['--auto'] : []), '--squash', '-t', s.subject.title, '--body-file', s.subject.bodyFile, '--match-head-commit', ctx.head])` — `ghCreate` is the existing write-bound gh kind (Task 7 updates its reason comment); never `--admin`, never `--delete-branch`.
3. On throw: `classifyMergeFailure(String(err.stderr || ''))`:
   - `conflict` → `conflictStop(s)`;
   - `auto-not-allowed` and `mode === 'auto'` → degrade to the `wait` row: `rereadThenMerge(s)` (a fresh state read, then the immediate call); `auto-not-allowed` on an `immediate` call → `merge-refused`, detail class `unrecognized`;
   - `checks` / `permission` / `unrecognized` → `merge-refused`, detail `merge-refused ({class}): {reduceDetail(firstLine(stderr))}`; nothing parked, no comment.
4. On success → `confirm(s)`. No `compose-subject.js` call happens inside `mergeCall` (Reading A).

`classifyMergeFailure(stderr)` — order and literals (ports Step 3 items 1–5; the fixtures carry these literals with a comment naming `pr-first-merge.md` Step 3 as the source):
1. `conflict`: `/not mergeable/i && /conflict/i`, or `/CONFLICTING/`.
2. `permission`: `/\b403\b/`, `/not accessible/i`, or `/must have write access/i`.
3. `auto-not-allowed`: contains `Auto merge is not allowed for this repository`, `Protected branch rules not configured for this branch`, or `Pull request is in clean status`; or `/auto-merge/i && /not allowed|not enabled/i`; or contains `enablePullRequestAutoMerge` (reached only when 1 and 2 did not match — the bare mutation name defers to them).
4. `checks`: `/not mergeable/i && /required status check|review|checks/i`.
5. else `unrecognized`.

`confirm(s)`: `deps.gh(['pr', 'view', String(pr), '--repo', repo, '--json', 'state,mergedAt,autoMergeRequest,statusCheckRollup,mergeCommit'])` — `mergeCommit` added to the spec's four fields so the merge sha needs no second read (logged in the plan as a deliberate superset). Throw/unparseable → retry once; still failing → `state-read-failed`, detail `merge call exited 0; state unconfirmed`, **no post-merge call**. `state === 'MERGED'` → `merged`, `mergeCommit = mergeCommit && mergeCommit.oid || null`; event detail summarizes the rollup (`merged, {names} concluded` / `merged — {name} had not concluded at merge time` / `merged — no status checks on this PR`). `state === 'OPEN' && autoMergeRequest` → `armed`; log `AUTO` step `Step 2.5 (merge-verification gate)` text `armed — forge holds the merge on PR #{pr}; reconciler completes cleanup on merged evidence.` reversibility `high (gh pr merge --disable-auto)`; nothing torn down, no post-merge call. Anything else → `merge-refused` (detail `confirmation read state {state}`). A `gh pr merge` exit 0 alone is never `merged`.

- [ ] **Step 1: Write the failing tests**

```js
// Fixture stderr literals — source: _shared/pr-first-merge.md Step 3 (items 1–5)
const SIG = {
  notAllowed: 'GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)',
  protectedRules: 'GraphQL: Pull request Protected branch rules not configured for this branch (enablePullRequestAutoMerge)',
  cleanStatus: 'GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)',
  mutationOnly: 'GraphQL: something unexpected (enablePullRequestAutoMerge)',
  checks: 'X Pull request o/r#9 is not mergeable: the base branch policy requires 1 required status check.',
  permission: 'HTTP 403: Resource not accessible by integration',
  conflict: 'X Pull request o/r#9 is not mergeable: the merge commit cannot be cleanly created (conflict).',
  conflictWithMutation: 'GraphQL: Pull request is not mergeable: conflict (enablePullRequestAutoMerge)',
  unknown: 'some brand new failure',
};
test('AC11.1: the auto-not-allowed signatures degrade to the wait row — a state read before an immediate merge', async () => { /* for notAllowed, protectedRules, cleanStatus, mutationOnly: first merge (--auto) throws {stderr}; next calls: pr view state,mergeStateStatus,headRefOid then pr merge without --auto */ });
test('AC11.2: an immediate call never degrades again', async () => { /* wait row, immediate merge throws SIG.notAllowed → merge-refused, exactly one immediate merge call */ });
test('AC11.3–AC11.5: checks, permission and unrecognized are merge-refused with the class named, nothing parked', async () => {});
test('AC11.6: a conflict wording (with or without the mutation name) returns conflict', async () => {});
test('classifyMergeFailure order: conflict and permission beat the bare mutation name', () => {
  assert.equal(classifyMergeFailure(SIG.conflictWithMutation), 'conflict');
  assert.equal(classifyMergeFailure('HTTP 403 (enablePullRequestAutoMerge)'), 'permission');
  assert.equal(classifyMergeFailure(SIG.mutationOnly), 'auto-not-allowed');
});
test('AC11.7: MERGED is merged with the merge commit; OPEN with autoMergeRequest is armed; anything else merge-refused', async () => {});
test('AC11.8: exit 0 alone is never merged', async () => { /* confirm read returns {state:'OPEN', autoMergeRequest:null} → merge-refused */ });
test('AC11.9: a confirmation read that fails twice is state-read-failed, detail says unconfirmed, no post-merge call', async () => {});
test('AC1.4: auto:merge removed between the two label reads is not-authorized with no merge call', async () => { /* labels reply: first [{name:'auto:merge'}], second [] */ });
test('AC1.5: a failed pre-merge label read is labels-unreadable with no merge call', async () => {});
test('AC9.4: every pr merge call carries --match-head-commit ctx.head — auto, immediate, degraded and re-entered paths', async () => { /* drive four scripted runs; for every recorded ghCreate pr merge call assert argAfter(c, ['--match-head-commit']) equals [CTX.head] */ });
test('AC4.1, AC4.2: the happy path calls happen in this order', async () => {
  const h = mergeHarness();
  const r = await merge(CTX, h.deps);
  assert.equal(r.outcome, 'merged');
  assert.deepEqual(sequenceFromSupplier(h.calls), [
    'judgments', 'closing-links.js --run', 'compose-subject.js 7', 'gh pr view isDraft', 'gh pr ready 9',
    'gh pr view state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup', 'gh run list --commit', 'ready-run.js --pr 9',
    'gh issue view 7 labels', 'ghCreate pr merge 9 --auto --squash',
    'gh pr view state,mergedAt,autoMergeRequest,statusCheckRollup,mergeCommit', 'post-merge-run.js --run',
  ]);
  const m = h.calls.find(isMergeCall);
  assert.deepEqual(argAfter(m, ['-t', '--body-file', '--match-head-commit']), [TITLE, path.join(CTX.runDir, 'merge-subject', 'body.md'), CTX.head]);
});
```

(`sequenceFromSupplier` maps each recorded call to a short label from the supplier call onward and drops `log-decision.js` calls; the confirmFromFile read is in-process and has no call record — its position is asserted by AC3's rows, which stop before `closing-links.js`.)

- [ ] **Step 2: Run to verify they fail** — FAIL.
- [ ] **Step 3: Implement `readLabels`, `mergeCall`, `classifyMergeFailure`, `confirm`**, replacing the stub; the `merged` tail calls Task 6's `postMerge(s)` (stub returning `{ verdict: null, failedSteps: [], failures: [] }` until Task 6) and the happy-path test's last expected entry is added in Task 6 — mark it in this task's test with a `// Task 6` comment and assert the sequence up to the confirm read here.
- [ ] **Step 4: Run to verify they pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add driver merge call — Step 3 signatures, degrade-to-wait, merged/armed confirmation"`.

---

### Task 6: the post-merge sequence

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js`
- Test: `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: `../hooks/worktree-reap` `parseWorktreeList`, `findWorktreeEntry`; `../hooks/worktree-detect` `safeReal` (settle.js:19-20 uses the same three for its registration check).
- Produces: `postMerge(s)` → `{ verdict, failedSteps, failures }` and sets `s.runDir` (the archive path when followed; otherwise unchanged — always a string) and `s.eventsStdoutOnly`, and calls `deps.rebindEvents(s.eventsStdoutOnly ? null : s.runDir)` before emitting anything after reconcile; exports `RECONCILE_TIMEOUT_MS = 150000`.

Order (AC12; each a `merge-*` event; a failure is a `fail` event, appended to `failures`, and never changes the outcome from `merged`):
1. **post-merge-run** (Steps 4.0/4.0b): `deps.node(bin('post-merge-run.js'), ['--run', runDir], nodeOpts)` → JSON `verdict` and `failedSteps`; non-zero exit or unparseable → failure `post-merge-run`; `verdict === 'failed'` → `fail` event (verdict and failedSteps carried, not a `failures` entry).
2. **release status** (Step 4.1): `git -C {mainCheckout} fetch origin {base}` then `git -C {mainCheckout} describe --tags --contains --first-parent --match v* {mergeCommit}` via `runGit(s, [...])`. Exit 0 → strip a trailing `~N`/`^N`, line `already carried by {tag}`; stderr starting `fatal: cannot describe` → line `not yet in a release — bump pending`; any other failure, a failed fetch, or no `mergeCommit` → failure `release-status`, log `pr-first-merge Step 4.1: release status unavailable ({reason})`, no comment. Otherwise log `pr-first-merge Step 4.1: release status — {line}.` and post the run comment: body file `{runDir}/release-status-comment.md` = `<!-- run-comment: release-status -->\n{line}\n`, `deps.gh(['pr', 'comment', String(pr), '--repo', repo, '--body-file', file])` — create only: the run directory is minted fresh per driver run and the merge runs once per run, so no earlier `release-status` comment can exist to update (code comment says so). A failed post → failure `release-status-comment`.
3. **reconcile** (Step 4.2): `deps.node(bin('hooks.js'), ['reconcile', '--checks', 'mirror,release,archive'], { cwd: mainCheckout, timeout: RECONCILE_TIMEOUT_MS, env: deps.env })`; non-zero or `code === null` (timeout) → failure `reconcile`, keep `s.runDir`. On success: `deps.lstatType(runDir).type === 'directory'` → keep (`lstatType` returns `{ type, code }` with `type ∈ 'missing'|'unreadable'|'symlink'|'file'|'directory'|'other'` — `plugin/bin/lib/path-guard/index.js` `lstatType`; never compare the object itself to a string); else `archive = path.join(mainCheckout, '.claude-tweaks', 'pipelines', 'archive', path.basename(runDir))`, `deps.lstatType(archive).type === 'directory'` → `s.runDir = archive`; neither → `s.runDir` keeps the original string and `s.eventsStdoutOnly = true` (decision lines are then skipped, each named in `s.logFailures`, and the final event goes to stdout only). Call `deps.rebindEvents(s.eventsStdoutOnly ? null : s.runDir)` before the reconcile event is emitted. The result's `runDir` is always a string; `eventsStdoutOnly: true` is the explicit flag (default `false`).
4. **teardown** (Step 4 teardown): `runGit(s, ['worktree', 'list', '--porcelain'])`; `findWorktreeEntry(parseWorktreeList(out), safeReal(worktree))` absent → `already gone` (not a failure). Present → `runGit(s, ['worktree', 'unlock', worktree])` (a "not locked" error is tolerated), then `runGit(s, ['worktree', 'remove', worktree])` — no force flag: a worktree with modified or untracked files refuses removal, stays, is named in the event, and is failure `teardown-worktree`. Branch, only once the worktree is gone: `runGit(s, ['rev-parse', '--verify', '--quiet', '--end-of-options', 'refs/heads/' + branch])` status 1 → already gone; else `runGit(s, ['branch', '-D', '--end-of-options', branch])` (failure `teardown-branch`).
5. **remote delete** (Step 5), only when the worktree is gone: if `branch === base` or `branch` is empty → no call, failure `delete-branch: refused (integration branch)`; else `deps.gh(['api', '-X', 'DELETE', 'repos/' + repo + '/git/refs/heads/' + branch])`; a throw whose stderr matches `/reference does not exist/i` is success. **Unverified:** the exact stderr wording of a DELETE on a missing ref has no safe read-only probe (a DELETE is the only call that produces it); the prose names only the phrase "reference does not exist" (post-merge file Step 5) — match case-insensitively. A kept worktree → no call, failure `delete-branch: worktree kept`.

`runGit(s, args)` is the only git call site in `merge.js`: `deps.git(['-C', ctx.mainCheckout, ...args], { cwd: ctx.mainCheckout })` (settle.js:214's shape; `remoteWrite: true` only for the `fetch`). Every git argv in the module is a literal array passed to `runGit` — Task 8's scan relies on it.

- [ ] **Step 1: Write the failing tests**

```js
test('AC12.1: on merged the post-merge sequence runs in order', async () => { /* labels of calls after the confirm read: post-merge-run.js --run, git fetch origin main, git describe --tags --contains --first-parent --match v* {sha}, gh pr comment --body-file, hooks.js reconcile --checks mirror,release,archive (timeout >= 150000), git worktree list, worktree unlock, worktree remove, rev-parse refs/heads/drive-7, branch -D, gh api -X DELETE repos/o/r/git/refs/heads/drive-7 */ });
test('AC12.2: a failure in any post-merge call stays merged and is listed', async () => { /* for each of post-merge-run exit 3, describe fails generically, reconcile code null, worktree remove throws, DELETE throws 'HTTP 500' → outcome merged; result.postMerge.failures includes the name; a fail event for that sub-step */ });
test('AC12.3: the remote delete never targets the integration branch', async () => { /* ctx.branch 'main' === base → no DELETE call */ });
test('AC12.4: "Reference does not exist" counts as success', async () => {});
test('AC12.5: the release-status comment carries the run-comment marker and the human line', async () => { /* describe exit 0 'v6.170.0~2' → body '<!-- run-comment: release-status -->\nalready carried by v6.170.0\n'; describe fatal: cannot describe → 'not yet in a release — bump pending' */ });
test('AC12.6: after reconcile archives the run dir, later writes and runDir follow the archive', async () => { /* real fixture: reconcile reply moves fixture runDir to archive/{run-id}; result.runDir === archive path; rebindEvents called with it before the merge-reconcile event; later log-decision --run args name the archive path */ });
test('AC12.7: neither path existing sends the final event to stdout only', async () => { /* reconcile reply deletes the run dir, no archive → result.runDir === CTX.runDir (still a string), result.eventsStdoutOnly === true, rebindEvents(null), no log-decision call after reconcile */ });
test('reconcile follow reads lstatType as an object: a directory keeps the path, a file at the path does not count', async () => { /* harness lstatType replies use the real shape {type:'directory',code:null} / {type:'file',code:null} / {type:'missing',code:'ENOENT'}; a run-dir path that is a file and an archive that is a directory → result.runDir === archive */ });
test('AC12.8: a failed or timed-out reconcile keeps the original path', async () => {});
test('teardown: a worktree that refuses removal stays, is named, and the branch and remote delete are skipped', async () => {});
test('AC8.5: armed tears nothing down and makes no post-merge call', async () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL.
- [ ] **Step 3: Implement `postMerge(s)`, `runGit(s, args)`**, replacing the stub; complete Task 5's happy-path sequence (drop its `// Task 6` marker, append the post-merge labels).
- [ ] **Step 4: Run to verify they pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add driver post-merge sequence — post-merge-run, release status, reconcile, teardown, remote delete"`.

---

### Task 7: wire the merge step into the driver

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/events.js:23-26` (append `'merge'` to `STEP_NAMES`), `:53-58` (append `MERGED: 'merged'`, `ARMED: 'armed'` to `OUTCOMES`; `OUTCOME_BY_CLASS` unchanged)
- Modify: `plugin/bin/lib/driver/steps.js` (header line 4; `summaryStep` sets `ctx.summaryLogged`; new `mergeStep`; `STEPS` gains it last)
- Modify: `plugin/bin/lib/driver/run.js` (`newCtx`, `driveRecord`, `finalEvent`, `realDeps.ghCreate` comment, `USAGE`)
- Modify: `tests/bin-lib/driver/run.test.js` (constants pins; green-gate rows)
- Modify: `docs/plugin-structure.md:189` (drive.js line: "nothing merges" and the outcome list)

**Interfaces:**
- Consumes: `merge(ctx, deps)` and `MergeResult` from Tasks 1–6.
- Produces: `ctx.summaryLogged`, `ctx.merge` (the `MergeResult`, or `null` when not entered), `ctx.events = { emit(step, status, ms, detail, extra), rebind(dirOrNull) }`, final-line field `merge: { outcome, reason, mergeCommit, postMerge }` and `eventsFile: 'stdout-only'` when the run dir vanished.

Changes:
- `steps.js` header line 4 → "Ports … Procedure steps 1–10 (step 9's merge lives in merge.js and runs as the `merge` entry)"; keep the "No test reads that prose" sentence.
- `summaryStep`: `ctx.summaryLogged = true` on its `ok` path, `false` on both failure paths.
- `mergeStep = defineStep(STEP.merge, STOP_CLASSES.NONE, async (ctx, deps) => …)`: when `ctx.ci !== 'green'` → `{ status: 'ok', detail: 'not entered: ci ' + ctx.ci }` and nothing else (no `merge` call, `deps.judgments` untouched). Otherwise build the merge ctx (`{ record: ctx.record, pr: ctx.pr.number, repo: ctx.shared.ghRepo, branch: ctx.branch, base: ctx.shared.ref, head: ctx.check.head, runDir: ctx.runDir, runRoot: ctx.shared.mainRoot, mainCheckout: ctx.shared.mainRoot, worktree: ctx.wt, summaryLogged: ctx.summaryLogged }`) and deps (`{ ...deps, emit: ctx.events.emit, rebindEvents: ctx.events.rebind, interrupted: () => ctx.shared.interrupted, watchClock: (t) => { ctx.ciWaitStartedAt = t; } }`), `const r = await merge(mctx, mdeps)`, `ctx.merge = r`, `if (r.runDir !== ctx.runDir) ctx.runDir = r.runDir` (always a string — Task 6), `if (r.eventsStdoutOnly) ctx.eventsStdoutOnly = true`; return `{ status: 'ok', detail: r.outcome + (r.reason ? ': ' + r.reason : ''), extra: {} }` (the watch's `ciWaitMs` rides on the `merge-watch` sub-event, not here, so it is not double-counted). Class `none`: a throw in the entry itself halts with class `none`, settle row `none` (no calls), outcome `pending-review`. No new `interruptClass` rung: `ctx.configWritten` is already true whenever this step runs, so any interrupt here is class `none` (state this in the step comment, with the consequence: a signal after a landed merge reports `pending-review`, and the reconciler's merged-evidence checks complete the run).
- `run.js` `newCtx`: add `summaryLogged: false, merge: null, events: null`. `driveRecord`: before the loop set `ctx.events = { emit: (name, status, ms, detail, extra) => sink.emit(eventFor(ctx, name, { status, detail: detail || undefined, extra: extra || {} }, ms, deps)), rebind: (dir) => { if (dir) sink.bindRunDir(dir); else { sink.unbind(); ctx.eventsStdoutOnly = true; } } }` — add `unbind()` to `createEventSink` in `events.js` (sets `eventsFile = null`; held lines stay queued and are never written). `finalEvent`: `outcome: !stop && ctx.merge ? ctx.merge.outcome : outcomeOf(settled.settledClass || stopClass)`; after the existing fields, `if (ctx.merge) event.merge = { outcome: ctx.merge.outcome, reason: ctx.merge.reason, mergeCommit: ctx.merge.mergeCommit, postMerge: ctx.merge.postMerge }`; `if (ctx.eventsStdoutOnly) event.eventsFile = 'stdout-only'`. No quoted step name anywhere in run.js.
- `realDeps.ghCreate` comment → "Writes to GitHub (`gh pr create`, the merge step's `gh pr merge`) take longer than a read, so they get the batched bound too."
- `USAGE` line `'its outcome: pending-review, express-escalated, blocked or refused. Nothing merges.'` → `'its outcome: pending-review, express-escalated, blocked, refused, merged or armed. A record merges only when a judgment supplier is configured; none is by default.'`.
- `docs/plugin-structure.md:189`: replace `nothing merges` with `merges only with a judgment supplier configured (none by default; bin/lib/driver/merge.js)` and the outcome list with `` (`pending-review`, `express-escalated`, `blocked`, `refused`, `merged` or `armed`) ``.

- [ ] **Step 1: Update the pins and write the failing tests in `run.test.js`**

```js
// constants update (AC15's one allowed change)
assert.equal(STEP_NAMES.length, 18);
assert.equal(STEP_NAMES[STEP_NAMES.length - 1], 'merge');
assert.deepEqual(Object.values(OUTCOMES).sort(), ['armed', 'blocked', 'express-escalated', 'merged', 'pending-review', 'refused']);

test('AC15.1: with no supplier the green path records no gh pr merge or gh pr ready and the final line names no-supplier', async () => {
  const h = harness();
  await run(['7'], h.deps);
  const final = h.lines().at(-1);
  assert.equal(final.outcome, 'pending-review');
  assert.deepEqual(final.merge, { outcome: 'pending-review', reason: 'no-supplier', mergeCommit: null, postMerge: null });
  assert.ok(!h.calls.some((c) => c.args.includes('merge') || c.args.includes('ready')));
});
test('merge is not entered unless the CI wait ended green', async () => {
  for (const ci of ['pending', 'red', 'no-ci', 'timeout', 'read-failed']) {
    const judged = [];
    const h = harness({ /* script pr-checks reply so the ci step records `ci` */ deps: { judgments: async () => { judged.push(1); } } });
    await run(['7'], h.deps);
    assert.deepEqual(judged, [], ci);
    assert.equal(h.lines().find((l) => l.step === 'merge').detail, `not entered: ci ${ci}`);
    assert.equal('merge' in h.lines().at(-1), false);
  }
});
test('merge is entered on green: with a supplier, the live label read comes first', async () => { /* deps.judgments recording; script gh issue view 7 --json labels → {labels:[]} → final.merge.reason 'not-authorized', judgments never called, no merge/ready call */ });
test('the summary step sets ctx.summaryLogged', async () => { /* driveRecord with a trailing look step capturing ctx: true on the green path; false when log-decision for summary.txt exits 1 */ });
test('AC1.2: with no supplier, no call is recorded after the ci event', async () => { /* index of the ci event's last call in h.calls; every call after it is none (the merge step's own event is a line, not a call) */ });
test('AC4.11, AC10.3, AC12.10: the final line takes the merge outcome, excludes watch time from msWithoutCi, and says stdout-only', async () => {
  /* driveRecord(7, newShared(), h.deps, [...STEPS.slice(0, -1), defineStep('merge', 'none', async (ctx) => {
       ctx.events.emit('merge-watch', 'ok', 5000, null, { ciWaitMs: 5000 });
       ctx.events.rebind(null);
       ctx.merge = { outcome: 'merged', reason: null, detail: null, mergeCommit: 'c'.repeat(40), runDir: ctx.runDir, eventsStdoutOnly: true, ciWaitMs: 5000, postMerge: { verdict: 'clean', failedSteps: [], failures: [] } };
       return { status: 'ok' }; })])
     → final.outcome 'merged'; final.merge.mergeCommit; final.msWithoutCi === final.msTotal - ciEvent.ciWaitMs - 5000; final.eventsFile === 'stdout-only' */
});
test('the event sink follows a rebind and goes stdout-only on unbind', () => { /* createEventSink: bindRunDir(a), emit, bindRunDir(b), emit → second line appended under b; unbind() → no further appendFile calls, stdout still receives lines */ });
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/driver/run.test.js` → FAIL (length 17, no merge step).
- [ ] **Step 3: Implement the changes above** in `events.js`, `steps.js`, `run.js`, `docs/plugin-structure.md`.
- [ ] **Step 4: Run both driver suites** — `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/settle.test.js` → PASS. The AC8.1 regex on `steps.js` and AC13.1's step-literal scan on `run.js` must pass unchanged.
- [ ] **Step 5: Commit** — `git commit -m "Wire the merge step into the driver — STEPS entry after ci, final-line merge field, sink rebind"`.

---

### Task 8: source scans, verify fixtures, real-git conflict proof, and docs/driver.md

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/driver/merge.test.js`
- Modify: `tests/helpers/strip-comments.js` (header caller list: add stem `merge`, matching how `run`/`settle` are listed) and `.claude/skills/parse-signal-discipline/SKILL.md` item 15's caller list (same stem)
- Modify: `docs/driver.md`

**Interfaces:**
- Consumes: `tests/helpers/strip-comments` `{ stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES }`; `tests/helpers/read-skill` `readText`; `tests/helpers/git-fixtures` `gitRepo`, `fixtureGit`.

- [ ] **Step 1: Write the tests**

```js
function codeOf(file) { const raw = readText(file); const stripped = stripComments(raw); const v = stripperVerdict(raw, stripped); assert.equal(v, 'ok', STRIPPER_VERDICT_MESSAGES[v]); return stripped; }
function noModelCall(src) { return !/require\([^)]*\b(worker|roles|judgments?)\b/.test(src) && !/\blaunchWorker\b/.test(src) && !/['"`]claude(\.cmd)?['"`]/.test(src); }
test('AC14.1–AC14.3: merge.js requires no worker, roles or judgments module, names no launchWorker and spawns no claude', () => {
  assert.ok(noModelCall(codeOf(MERGE)));
  for (const bad of ["const w = require('./worker');", 'deps.launchWorker(x)', "spawn('claude', [])"]) assert.ok(!noModelCall(bad), `go-red: ${bad}`);
  const bareJudgments = (src) => /(?<!deps\.)\bjudgments\b/.test(src.replace(/['"`][^'"`\n]*['"`]/g, '""'));
  assert.equal(bareJudgments(codeOf(MERGE)), false, 'AC14.2: judgments only as deps.judgments');
  assert.ok(bareJudgments('const j = require("./x").judgments; j(ctx);'), 'go-red: bare judgments');
});
// AC6: every git argv is a literal array passed to runGit; collect each runGit( call's balanced argument text
function gitArgTexts(src) { /* scan for 'runGit(' and return the balanced-paren argument text of each */ }
function gitWritesBranch(texts) { return texts.some((t) => /['"`](merge|push|rebase)['"`]/.test(t)); }
function forbiddenText(src) { return /\brebase\b|--force-with-lease|--force\b/.test(src); }
test('AC6.2: merge.js names no rebase, no --force, and passes no merge or push to git', () => {
  const src = codeOf(MERGE);
  const texts = gitArgTexts(src);
  assert.ok(texts.length >= 7, `runGit call sites seen: ${texts.length}`);   // fetch, describe, worktree list, unlock, remove, rev-parse, branch -D
  assert.equal(gitWritesBranch(texts), false);
  assert.equal(forbiddenText(src), false);
  assert.ok(gitWritesBranch(gitArgTexts("runGit(s, ['merge', 'origin/main'])")), 'go-red: merge');
  assert.ok(gitWritesBranch(gitArgTexts("runGit(s, ['push', 'origin', b])")), 'go-red: push');
  assert.ok(forbiddenText("x = ['--force']"), 'go-red: --force');
});
test('AC6.3: a conflict run leaves the branch tip and the integration branch tip unchanged (real git)', async () => {
  /* gitRepo() → main checkout with branch 'drive-7' and 'main'; record both tips via fixtureGit rev-parse; run merge with a fake gh whose first state read is DIRTY and a real deps.git (bounded execFileSync, windowsHide: true); assert reason 'conflict' and both tips unchanged */
});
test('AC13.1–AC13.3: express-lane.js verify exits 0 for fixture runs driven to merged, armed, and pending-review after a red check', async () => {
  /* for each outcome: fixture run dir as Phase 1 leaves it — decisions.md with the canonical claim line
     '- AUTO 09:00:00 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.' under '## /flow',
     the check line '- AUTO 09:01:00 — Express lane check: #7 proceed — 1 changed file(s), 4 implementation line(s) within bounds; runner stamp verifies HEAD {sha}. Reversibility: n/a.' under '## /express-lane',
     the verdict line, and run-state.json { worktree, pr: { number: 9, url } }; drive merge over it with the fake runner scripted for that outcome (reconcile reply a no-op for merged);
     then spawnSync(process.execPath, [EXPRESS_LANE, 'verify', '--run', runDir, '--issue', '7'], { cwd: fx.main, encoding: 'utf8', windowsHide: true }) → status 0 and JSON ok true */
});
```

- [ ] **Step 2: Run** — `node --test tests/bin-lib/driver/merge.test.js tests/strip-comments-callers-twin.test.js` → PASS (each go-red line must fail when its input is clean: the implementer confirms once by temporarily planting `runGit(s, ['push'])` in a scratch copy, never in the committed file).
- [ ] **Step 3: docs/driver.md** — line 3: replace "Nothing merges." with "A record merges only when a judgment supplier is configured (none is by default) — see "The merge step"." Add `merge` to the `step` list under "Event lines" and the `merge-*` sub-step names; add `merged` and `armed` to the "Outcome words" table; add a section "## The merge step" stating: it runs only after the CI wait ends `green`; the entry order; the reason words (the closed list from Global Constraints) and the residue of each (the spec's residue table, copied); what each outcome leaves behind (`merged`: run archived by reconcile, worktree, local branch and remote branch removed, claim released by reconcile; `armed`: claim, worktree and run directory stay, the reconciler completes cleanup on merged evidence and the locked worktree is reaped after its owner pid dies (24h orphan grace); `pending-review`: PR left draft or ready per the residue table); the final line's `merge` field and `eventsFile: 'stdout-only'`; and that an interrupt after a landed merge reports `pending-review` (class `none`).
- [ ] **Step 4: Commit** — `git commit -m "Pin the merge step's no-model and no-branch-rewrite rules, prove verify on driven fixtures, document the merge step"`.

---

## Final verification (folded into /build Common Step 5)

`npm test` via the project's verify runner — contributes runner checks only. Before the whole-branch review, run the finished `merge` once against a **real** archived driver run dir if one exists under `.claude-tweaks/pipelines/archive/*-drive-*` (Real-input probe check) in a read-only dry form: `node -e` requiring `merge.js` with a deps object whose `judgments` is absent — expect `no-supplier` and zero calls — and record the printed result; if no archived driver run exists, say so in the handoff rather than skipping silently.
