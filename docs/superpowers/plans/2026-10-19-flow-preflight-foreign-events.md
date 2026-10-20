# Flow-preflight foreign events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freshly minted run dir is no longer classified as an adoption (case 3) because a sibling session's hook events landed in it, and the hook's fallback attribution stops guessing events into a mint or into a run bound to another worktree.

**Architecture:** Two independent changes. (1) `plugin/bin/lib/flow/preflight.js`'s `computeAdoption` replaces its "any non-fallback line is content" events rule with positive evidence: an event counts only when it carries this run's own worktree (a locator field inside `run-state.json`'s `worktree`) or session (a session field equal to `run-state.json`'s `sessionId`). Every other parsed line is counted as `eventsForeign`, and unparseable lines still count as content. (2) `plugin/bin/lib/hooks/context.js`'s `resolveRun` gains an opt-in `strictAttribution` mode, used only by `hooks.js`'s `ownedRun` resolution (the write path, never E1's enforcement `runDir`). In that mode the fallback arms also skip a claim-log-only mint and any candidate bound to a worktree other than the caller's resolved toplevel. When that leaves nothing, the result carries a `dropped` list, which `hooks.js` reports as one `attribution:`-prefixed stderr line.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185533-record-3515/work/3515-spec.md`

**Scope keywords:** eventsHaveOwnContent, isSkippableFallbackCandidate

**Premise-refs:** plugin/bin/lib/flow/preflight.js, plugin/bin/lib/hooks/context.js, plugin/bin/hooks.js, plugin/bin/lib/log-decision/claim-log.js

## Global Constraints

- The spec names `bin/lib/hooks/run-dir-resolve.js` and `tests/bin-lib/hooks/run-dir-resolve.test.js` / `tests/bin-lib/flow-preflight/*.test.js`. Those are stale locations (premise reversal logged in `decisions.md`). The event-attribution fallback is `context.js`'s `resolveRun` (called at `hooks.js:1658`), and its tests are `tests/hooks-run-attribution.test.js`. The preflight tests are `tests/bin-lib/flow/preflight.test.js` and `tests/bin-lib/flow/preflight-cli.test.js`. `run-dir-resolve.js` is the `resolve-run-dir` CLI's slug resolver and is not touched.
- The `preflight.json` field name is exactly `eventsForeign` (an integer), on `adoption.value`.
- Never break a session: the new stderr write in `hooks.js` is wrapped in `try`/`catch`, and the hook exit code is unchanged.
- E1's enforcement resolution (`hooks.js:1656`, `resolveRunDir(cwd, process.env)`) must not change. `strictAttribution` is passed only on the `ownedRun` call at line 1658. A main-checkout E1 target bound to a worktree must still resolve there.
- Additive flag, not a default flip: every existing `resolveRun` caller and test without `strictAttribution` keeps byte-identical results.

## Review Focus

1. A dispatched or adopted run whose own events carry only locator-less lines (e.g. `skill_invoked`) — these are no longer adoption evidence. Such a run always carries a `dispatched` stamp, a `decisions.md` beyond claim lines, or a committed spec, so case 3 must still come from those. Task 1 pins the decisions.md path in its existing tests, which stay green.
2. A caller in the main checkout resolving E1's `runDir` against a worktree-bound run: it must still resolve. Task 2 adds a non-strict pin next to the strict one.
3. A standalone run dir (`decisions.md` with real content, no `run-state.json`) must still win the strict fallback, and only a claim-log-only `decisions.md` is a mint. Task 2 pins both.
4. A candidate whose recorded worktree has been removed from disk is not the caller's toplevel, so strict mode skips it. Task 2 pins it.
5. An `events.jsonl` line that is valid JSON but not an object (`"x"`, `3`) counts as foreign, never as own, and never throws. Task 1 pins it.

---

### Task 1: Preflight counts only own-attributed events as adoption evidence

**Files:**
- Modify: `plugin/bin/lib/flow/preflight.js:97-180` (replace `eventsHaveOwnContent`; thread `state` into it; add `eventsForeign` to every `computeAdoption` return)
- Modify: `plugin/skills/flow/steps-and-gates.md:70` and `:74` (case 2 / case 3 events clauses; file is 38,150 B against the 52,500 B rail, so the ~200 B change leaves ~14 KB of headroom)
- Test: `tests/bin-lib/flow/preflight.test.js`
- Test: `tests/bin-lib/flow/preflight-cli.test.js`

**Interfaces:**
- Produces: `classifyEvents(deps, file, state) -> { own: number, foreign: number, unparseable: number }`, exported from `preflight.js` alongside the existing exports. `computeAdoption(...)` return objects gain `eventsForeign: number` on every case (cases 4 and 5 report `0`).
- Own-evidence rule (exact): a parsed line is **own** when it is a plain object, its `attribution` is not `'fallback'`, and either (a) one of its string fields `dir`, `path`, `worktree`, `actual` equals `state.worktree` or lies under it (`path.resolve(v) === wt || path.resolve(v).startsWith(wt + path.sep)`, with `wt = path.resolve(state.worktree)`; only when `state.worktree` is a non-empty string), or (b) one of its string fields `sessionId`, `session`, `callerSessionId` equals `state.sessionId` (only when that is a non-empty string). Every other parsed line, including non-object JSON, is **foreign**. A line that fails `JSON.parse` is **unparseable**. Blank lines are skipped.
- `hasOtherContent = decisionsHasContent || events.own > 0 || events.unparseable > 0 || specMaterialized === true`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/flow/preflight.test.js` (reuse `mainRoot`, `deps`, `NO_SPEC`, `adoptionFor`, and `CLAIM_ONLY` already in the file; seed `run-state.json` with `fs.writeFileSync` where a test needs one):
  - `AC1.1: a fresh mint holding two events from another worktree classifies case 2 with eventsForeign 2`. These are the two real `#3401` lines (archived run `2026-10-17T190411-spec-3401`), verbatim: `{"tool":"Write","path":"/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3405/.superpowers/sdd/2026-10-17-partial-rollup-pending/task-3-report.md","ts":"2026-10-17T19:07:23.418Z","type":"gate-exempt-gitignored"}` and the same line with `"tool":"Edit"` and `"ts":"2026-10-17T19:07:26.142Z"`. Use `decisions.md = CLAIM_ONLY` and no `run-state.json`. Assert `a.case === 2`, `a.eventsForeign === 2`, `a.hasOtherContent === false`. Repeat with `run-state.json = { worktree: '/w/own', status: 'active', sessionId: 's-own' }` and assert the same three values.
  - `AC1.2: one own-worktree event among foreign ones classifies case 3`. Use the two lines above plus `{"action":"commit","dir":"/w/own","hash":"abc","ts":"…","type":"commit"}`, with `run-state.json = { worktree: '/w/own', status: 'active' }`. Assert `a.case === 3`, `a.eventsForeign === 2`, `a.hasOtherContent === true`.
  - `AC1.2: an event under the run's own worktree (path inside it) counts as own`: `{"type":"gate-exempt-gitignored","path":"/w/own/.superpowers/x.md"}` plus the same run-state, asserting case 3. A sibling prefix such as `/w/own-other/x.md` must count as foreign (case 2, eventsForeign 1).
  - `an event carrying this run's own sessionId counts as own → case 3`: `{"type":"pre-compact","trigger":"auto","sessionId":"s-own"}` with `run-state.json = { status: 'active', sessionId: 's-own' }` → case 3. With `sessionId: 's-other'` in the event → case 2, eventsForeign 1.
  - `a valid-JSON non-object events line counts as foreign, never throws`: events `'"x"\n3\n'` → case 2, eventsForeign 2.
  - Change the two existing tests whose contract this record changes, renaming both to name the new rule:
    - `events.jsonl mixing a fallback-attributed line with one non-fallback line…` (line ~419): with no run-state, the unattributed locator-less `skill_invoked` line is no longer evidence. Assert case 2, eventsForeign 2.
    - `claim-log-only decisions.md beside a non-empty events.jsonl is still case 3…` (line ~401): replace its `'{"event":"x"}\n'` with an own-worktree commit event plus `run-state.json = { worktree: '/w/own', status: 'active' }` so it still asserts case 3. Keep the config.yml half unchanged.
  - Keep `an unparseable events.jsonl line counts as other-run content → case 3` unchanged, and add `assert.strictEqual(a.eventsForeign, 0)`.
  - In `tests/bin-lib/flow/preflight-cli.test.js`, add `AC1.1/AC1.2: the CLI reports eventsForeign and the case through preflight.json`. Build a variant of `mainCheckoutWithRun()` with no `config.yml`, `decisions.md` = the claim-only line `## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n`, no `work/` spec, `run-state.json = { worktree: root, status: 'active' }`, and `events.jsonl` = the two real `#3401` lines. Call `run(['--run', fx.runDir, '--steps', 'build,test'], d)` and assert that `preflight.json` has `adoption.value.case === 2` and `adoption.value.eventsForeign === 2`. Then append `{"action":"commit","dir":"<root>","type":"commit"}` (root is the fixture's realpath'd root), re-run, and assert `case === 3`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js`
Expected: FAIL. The new AC1.1 tests read `eventsForeign` as `undefined`, and the AC1.1 fresh-mint test gets case 3 (the unattributed real `#3401` lines count as content under the current rule).

- [ ] **Step 3: Implement `classifyEvents(deps, file, state)` in `plugin/bin/lib/flow/preflight.js`**, replacing `eventsHaveOwnContent`. Rewrite its header comment to state the own-evidence rule and why: an unattributed line from a sibling session is as foreign as a stamped one (pre-#2783 writes carried no stamp). In `computeAdoption`, call it with the already-read `state`, compute `hasOtherContent` per the Interfaces rule, and add `eventsForeign: events.foreign` to the case 1/2/3 returns and `eventsForeign: 0` to the case 4/5 returns. Export `classifyEvents`.

- [ ] **Step 4: Update `plugin/skills/flow/steps-and-gates.md`.** In case 2 (line 70), replace `no \`events.jsonl\` content beyond \`attribution: "fallback"\` lines — another session's guessed ownership, not this run's work —` with `no \`events.jsonl\` line carrying this run's own worktree or session — a line naming another worktree, a \`fallback\`-attributed guess, or one with neither is another session's write, counted in \`adoption.value.eventsForeign\` —`. In case 3 (line 74), replace `an \`events.jsonl\` with any line not attributed \`fallback\` (an unparseable line counts)` with `an \`events.jsonl\` line carrying this run's own \`run-state.json\` \`worktree\` (a \`dir\`/\`path\`/\`worktree\`/\`actual\` under it) or \`sessionId\` (an unparseable line counts)`.

- [ ] **Step 5: Run the tests to verify they pass, plus the prose pins**

Run: `node --test tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js tests/flow-preflight-conformance.test.js tests/flow-dispatched-run-auto-mode.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Run the real-input probe and an independent count.** Copy the archived run's first two events lines into a scratch mint, then run the CLI against it:

```bash
node -e "const fs=require('fs'),p=require('path');const src='/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-17T190411-spec-3401/events.jsonl';const lines=fs.readFileSync(src,'utf8').split('\n').slice(0,2);console.log(lines.filter(l=>l.includes('dispatch-record-3405')).length)"
```
Expected: `2` (the independent count of foreign lines). Then `computeAdoption` over a fixture holding exactly those two lines (the AC1.1 test) must report `eventsForeign: 2`, matching that count.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/flow/preflight.js plugin/skills/flow/steps-and-gates.md tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js
git commit -m "Count only own-attributed events as preflight adoption evidence — refs #3515"
```

### Task 2: Strict fallback attribution for hook event writes

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js:302-392` (`isSkippableFallbackCandidate`, `resolveRun`; new helpers next to `isUnadoptedMint`)
- Modify: `plugin/bin/hooks.js:1658` (pass `{ strictAttribution: true }`; emit the stderr diagnostic)
- Modify: `docs/hooks.md:21` (the "Two resolutions, not one" bullet)
- Test: `tests/hooks-run-attribution.test.js`

**Interfaces:**
- Consumes: `classifyDecisions(text) -> 'absent'|'empty'|'claim-log-only'|'content'` from `plugin/bin/lib/log-decision/claim-log.js`, and `wtDetect.repoInfo(cwd) -> { repoRoot, isLinkedWorktree, indeterminate }` / `wtDetect.safeReal(p)` (already imported in `context.js`).
- Produces: `resolveRun(cwd, env, sessionId, { strictAttribution: true })`. When strict, both fallback arms (the `!me` loop and the `unowned` pick) also skip:
  - (a) `isClaimLogOnlyMint(dir, state)`: no `run-state.json` file on disk and `classifyDecisions(<decisions.md text>) === 'claim-log-only'`. Read errors are treated as not-a-mint.
  - (b) `isOtherWorktreeBound(cwd, state)`: `state.worktree` is a non-empty string, `wtDetect.repoInfo(cwd)` is not `indeterminate` and has a `repoRoot`, and `(wtDetect.safeReal(state.worktree) || path.resolve(state.worktree)) !== repoRoot`. `includeWorktreeForeign: true` disables (b), like the #1410 check.
  - When strict resolution finds no candidate and skipped at least one under (a)/(b), it returns `{ dir: null, attribution: null, dropped: ['<run-id> (claim-log-only mint)' | '<run-id> (bound to <worktree>)', …] }`. Otherwise the return shapes are unchanged. No `dropped` key appears on any non-strict call or on a strict call that found a run.
  - `hooks.js` prints, when `ownedRun.dropped` is a non-empty array, exactly one line to stderr: ``attribution: dropped — no fallback run dir matches ${cwd}; skipped ${ownedRun.dropped.join(', ')} — this hook's events are not recorded\n``. The line is wrapped in `try`/`catch`, and the exit code is unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-run-attribution.test.js` (reuse `mkRun`, `gitRepo`, `linkedWorktreeOf`, `project`). The claim-only text is `'## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n'`:
  - `#3515 strict: a claim-log-only mint (no run-state.json) is never guessed into; an older standalone run wins`: in `project()`, an older `2026-07-01T090000-standalone` dir has `decisions.md` = `'## /tidy\n- AUTO 10:00:00 — x. Reversibility: high.\n'`, and a newer `2026-07-02T090000-record-7` dir has `decisions.md` = the claim-only text. `resolveRun(cwd, {}, 'me', { strictAttribution: true })` deep-equals `{ dir: <standalone>, attribution: 'fallback' }`. The same call without the opt still returns the mint (existing behavior pinned).
  - `#3515 strict: only a claim-log-only mint exists → dropped, never guessed`: deep-equals `{ dir: null, attribution: null, dropped: ['2026-07-02T090000-record-7 (claim-log-only mint)'] }` for both `'me'` and `null` session ids.
  - `AC2.1: strict: a caller in the main checkout skips an unowned run bound to a linked worktree`: `main = gitRepo(); wt = linkedWorktreeOf(main); mkRun(main, '2026-07-01T090000-bound', { status: 'active', worktree: wt })`. `resolveRun(main, {}, 'me', { strictAttribution: true })` deep-equals `{ dir: null, attribution: null, dropped: [\`2026-07-01T090000-bound (bound to ${wt})\`] }`. The non-strict call `resolveRun(main, {}, 'me')` still returns `{ dir: <bound>, attribution: 'fallback' }`, and `resolveRunDir(main, {})` still returns `<bound>` (E1 unchanged). This is the test that goes red when guard (b) is removed.
  - `strict: a caller inside the bound worktree still resolves it`: `resolveRun(wt, {}, 'me', { strictAttribution: true })` → `{ dir: <bound>, attribution: 'fallback' }`.
  - `strict: a candidate whose bound worktree was removed from disk is skipped`: bind to `path.join(main, 'gone-wt')` (never created). The strict call from `main` → `dropped` names it.
  - `strict + includeWorktreeForeign: guard (b) is disabled`: the AC2.1 fixture with `{ strictAttribution: true, includeWorktreeForeign: true }` returns `<bound>`.
  - `AC2.1 e2e: hooks.js pre-compact from the main checkout leaves a claim-log-only mint untouched and reports the drop on stderr`: `main = gitRepo()`, a mint dir with claim-only `decisions.md`. Use `child_process.spawnSync('node', [<repo>/plugin/bin/hooks.js, 'pre-compact'], { input: JSON.stringify({ session_id: 's1', trigger: 'auto' }), cwd: main, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '' } })`. Assert `status === 0`, `stderr` matches `/^attribution: dropped — /m` and includes the mint's basename, and the mint has no `events.jsonl`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-run-attribution.test.js`
Expected: FAIL. The strict tests get the mint or bound dir back with no `dropped` key, and the e2e test finds an `events.jsonl` in the mint and empty stderr.

- [ ] **Step 3: Implement in `plugin/bin/lib/hooks/context.js`.** Add `isClaimLogOnlyMint(dir, state)` and `isOtherWorktreeBound(cwd, state)` beside `isUnadoptedMint`, each with a header comment naming #3515 and the #3401 incident. Require `classifyDecisions` from `'../log-decision/claim-log'`, checking first that `claim-log.js` does not require `context.js` (no cycle). Extend `isSkippableFallbackCandidate` to return a reason string or `null` instead of a boolean, and update its two call sites to test truthiness. The strict-only reasons are produced only when `opts.strictAttribution === true`. `resolveRun` collects the strict-only reasons into `dropped` and attaches the array only on the strict null return.

- [ ] **Step 4: Implement in `plugin/bin/hooks.js`.** At line 1658 pass `{ strictAttribution: true }`. Right after it, emit the diagnostic per the Interfaces block. Add a comment that line 1656 deliberately stays non-strict (E1 must still resolve a run it does not own).

- [ ] **Step 5: Update `docs/hooks.md:21`.** After the `(#721)` sentence, add: `**Strict attribution for writes (#3515):** \`ctx.ownedRun\` resolves with \`strictAttribution\`, so its fallback also skips a mint whose \`decisions.md\` holds only Step 2.8 claim-log lines (no \`run-state.json\` — the claim log defeated the #721 mint check) and any candidate bound to a worktree other than the caller's resolved toplevel (a main-checkout caller included, and a binding gone from disk). When that leaves nothing, the hook writes no event and prints one \`attribution: dropped — …\` line to stderr. E1's owner-unfiltered \`runDir\` stays non-strict.` Then amend the later sentence `(a caller in the main checkout — where most hook firings happen — classifies \`'indeterminate'\` and still guesses into the candidate)` to append `— for E1's \`runDir\` only; the strict write path above skips it`.

- [ ] **Step 6: Run the tests to verify they pass, plus the hook suites near this code**

Run: `node --test tests/hooks-run-attribution.test.js tests/hooks-post-tool-use-adhoc-rundir.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/friction-adhoc-enterworktree-roundtrip.test.js tests/hooks-post-tool-use-ask-user-question.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/hooks/context.js plugin/bin/hooks.js docs/hooks.md tests/hooks-run-attribution.test.js
git commit -m "Stop hook fallback attribution guessing into mints and foreign-bound runs — refs #3515"
```

### Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (preflight own-evidence, `eventsForeign`) | Task 1 |
| Deliverable 2 (fallback worktree guard + stderr drop) | Task 2 |
| Deliverable 3 (foreign-events fixtures in both suites) | Task 1 Step 1, Task 2 Step 1 |
| AC1.1, AC1.2 | Task 1 (unit and CLI tests) |
| AC2.1 | Task 2 (main-checkout strict test + e2e) |
| AC3.1 `npm test` passes in full | Build Common Step 5 (central full-suite run) |
