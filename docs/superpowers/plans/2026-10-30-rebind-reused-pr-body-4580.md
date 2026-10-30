# Rebind a reused PR's body to the resuming run (#4580) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `openPrEarly` reuses a still-open PR whose body names another run, rebind that body to the current run, exactly as the reopen branch already does, so `bin/pr-checklist.js` stops refusing phase-checklist updates with exit 4.

**Architecture:** `plugin/bin/lib/flow/pr-early-open.js` gains one shared `rebind(number, kind)` helper (compose body, `gh pr edit --body-file`, AUTO log line; on failure a `SKIP` degrade line). The reopen branch and both reuse returns call it. The reuse paths call it only when the PR body, after `pr-checklist.js`'s own marker repair, names a run other than this one. The body is read through the existing `gh` calls: `body` is added to the `pr list` and the recorded-PR `pr view` `--json` field lists. `_shared/pr-early-run-lifecycle.md` is the prose spec the module implements; its OPEN-reuse bullet and its Resume "Still open" bullet state the rebind.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T123820-record-4580/work/4580-spec.md`

## Global Constraints

- Log line on success, verbatim (formatted through the module's existing `log()` helper, which prefixes `PR-early run lifecycle: `): `rebound reused PR #{n} to run {run-id}`, reversibility `high`.
- A failed rebind is a logged `SKIP` degrade, never a stop: `rebind of reused PR #{n} failed ({error}); phase-checklist updates will exit 4 until its body names run {run-id}`, reversibility `n/a`. Do not change the existing reopened wording (`rebound reopened PR #…`, `rebind of reopened PR #… failed (…)…`). `tests/dispatch-retry-prior-attempt-conformance.test.js` and the existing unit tests pin it.
- Rebind on the head-branch OPEN path happens **before** Step 2's push and before `record()`, mirroring the reopen branch's order (reuse line, then rebind, then record, then push). The reuse line stays the first line written: `hasPrEarlyStep1LineFor` reads `lines[0]`.
- "Names another run" is defined as pr-checklist's own refusal test: `firstLineRunId(repairPrBody({ body, runId, fixesLines: [] }).body) !== runId`. Use `firstLineRunId` from `./pr-checklist` and `repairPrBody` from `./pr-body`. Never hand-roll a marker regex. A non-string body (field absent) is "cannot judge": no rebind, no log line.
- No new `require` of `fs` or path-guard-sensitive APIs in `plugin/bin/` (`tests/path-guard-conformance.test.js`).
- Commit messages: `{Verb} {what} — {detail}` style, ending `refs #4580` (never `closes`/`fixes`), plus the trailer `Claude-Session: https://claude.ai/code/session_01JHXvgULwevyiwYq1Edzhuu`.
- Doc headroom: `plugin/skills/_shared/pr-early-run-lifecycle.md` is 33,071 B against `RAIL_BYTES` 52,500 B. The added prose (under 1.5 KB) leaves more than 18 KB.

## Review Focus

1. A body that carries **no** run marker at all (hand-written PR): `repairPrBody` would prepend this run's marker, so pr-checklist accepts it. **No** rebind and no edit (test in Task 1).
2. A body whose first line is the plain-text companion `claude-tweaks-run: {this run}` (an MCP-written body): it names this run, so there is no rebind (test in Task 1).
3. A `pr view` / `pr list` result with no `body` field (older fixture, or gh omitting it): no rebind, no throw, reuse proceeds as before. The existing tests at "a recorded PR that is still OPEN…" and "an OPEN match is reused…" cover this once their fixtures stay body-less.
4. The success line must not read as a degrade to `hasLoggedPrDegrade`. The failure SKIP line does read as one, and that is harmless only because the PR is recorded (Task 1 extends the gate-matcher test).
5. A rebind on the recorded-PR path must not push, list, or call `record()` again (test in Task 1).

---

### Task 1: Rebind on both reuse outcomes in `pr-early-open.js`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/flow/pr-early-open.js` (header comment lines 15-19; `listPrs` field list ~line 92; recorded-PR view ~lines 103-111; `writeBody` moves above the Resume block; reopen branch ~lines 179-186 switches to the shared helper; OPEN branch ~lines 153-160)
- Test: `tests/bin-lib/flow/pr-early-open.test.js`

**Interfaces:**
- Consumes: `firstLineRunId(body) -> string|null` from `plugin/bin/lib/flow/pr-checklist.js`; `repairPrBody({ body, runId, fixesLines }) -> { body, restored }` and `composePrEarlyBody(...)` from `plugin/bin/lib/flow/pr-body.js`.
- Produces: no new export. `openPrEarly`'s return shapes are unchanged (`{ outcome: 'reused', number, url }` on both reuse paths).

- [ ] **Step 1: Write the failing tests**

In the test file, add `const { composePrEarlyBody } = require('../../../plugin/bin/lib/flow/pr-body');` and a helper `const bodyFor = (runId) => composePrEarlyBody({ runId, specSummary: 'S.', target: '#4027', nextStep: 'build', fixesLines: ['Fixes #4027'] });` with `const OTHER_RUN = '2026-10-24T000000-record-4027';`. Then add:

```js
test('AC1.1: an OPEN head-branch match whose body names another run is rebound to this run before the push', async () => {
  const h = harness({ list: [{ number: 7, url: URL7, state: 'OPEN', isDraft: true, body: bodyFor(OTHER_RUN) }] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'reused', number: 7, url: URL7 });
  const bodyPath = path.join(h.bodyDir, `pr-early-body-${RUN_ID}.md`);
  const editAt = idx(h.calls, (c) => c[0] === 'gh' && c[2] === 'edit');
  assert.deepEqual(h.calls[editAt], ['gh', 'pr', 'edit', '7', '--repo', REPO, '--body-file', bodyPath]);
  assert.ok(editAt < idx(h.calls, isPush), 'rebind precedes the push');
  assert.equal(fs.readFileSync(bodyPath, 'utf8').split('\n')[0], `<!-- claude-tweaks-run: ${RUN_ID} -->`);
  assert.ok(h.lines.some((l) => l.includes(`PR-early run lifecycle: rebound reused PR #7 to run ${RUN_ID}.`)));
  assert.ok(h.lines[0].includes(`reusing open PR #7 for ${BRANCH}.`), 'the Step 1 line stays first');
  assert.deepEqual(h.records, [{ number: 7, url: URL7 }]);
});

test('AC1.1: a recorded still-open PR whose body names another run is rebound, with no list, record or push', async () => {
  const h = harness({ runState: { pr: { number: 9, url: URL7 } }, view: { state: 'OPEN', isDraft: true, url: URL7, body: bodyFor(OTHER_RUN) } });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'reused', number: 9, url: URL7 });
  assert.deepEqual(h.calls[0], ['gh', 'pr', 'view', '9', '--repo', REPO, '--json', 'state,isDraft,url,body']);
  assert.ok(h.calls.some((c) => c[0] === 'gh' && c[2] === 'edit' && c[3] === '9'));
  assert.deepEqual(h.lines.map((l) => l.replace(/^- AUTO \S+ — log-decision: /, '')), [`PR-early run lifecycle: rebound reused PR #9 to run ${RUN_ID}. Reversibility: high.`]);
  assert.equal(h.calls.find((c) => c[0] === 'gh' && c[2] === 'list'), undefined);
  assert.equal(h.calls.find(isPush), undefined);
  assert.deepEqual(h.records, []);
});

test('AC2.1: a reused PR whose body already names this run gets no gh pr edit, on either reuse path', async () => {
  const bodies = [bodyFor(RUN_ID), `claude-tweaks-run: ${RUN_ID}\n\nMCP-written body`, 'A hand-written body with no marker.'];
  for (const body of bodies) {
    const listed = harness({ list: [{ number: 7, url: URL7, state: 'OPEN', body }] });
    await openPrEarly(OPTS, listed.deps);
    const recorded = harness({ runState: { pr: { number: 9, url: URL7 } }, view: { state: 'OPEN', url: URL7, body } });
    await openPrEarly(OPTS, recorded.deps);
    for (const h of [listed, recorded]) {
      assert.equal(h.calls.find((c) => c[0] === 'gh' && c[2] === 'edit'), undefined, `no edit for: ${body.split('\n')[0]}`);
      assert.ok(!h.lines.some((l) => l.includes('rebound') || l.includes('rebind')));
    }
  }
});

test('AC4.1: a failing gh pr edit on a reused PR logs the SKIP degrade and still returns the reused PR, recorded', async () => {
  const h = harness({ list: [{ number: 7, url: URL7, state: 'OPEN', body: bodyFor(OTHER_RUN) }], edit: new Error('HTTP 422') });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'reused', number: 7, url: URL7 });
  assert.ok(h.lines.some((l) => l.startsWith('- SKIP ') && l.includes('rebind of reused PR #7 failed (HTTP 422)')
    && l.includes(`phase-checklist updates will exit 4 until its body names run ${RUN_ID}`)));
  assert.deepEqual(h.records, [{ number: 7, url: URL7 }]);
  assert.ok(h.calls.findIndex((c) => c[0] === 'record') < h.calls.findIndex(isPush));
  const recorded = harness({ runState: { pr: { number: 9, url: URL7 } }, view: { state: 'OPEN', url: URL7, body: bodyFor(OTHER_RUN) }, edit: new Error('HTTP 422') });
  assert.deepEqual(await openPrEarly(OPTS, recorded.deps), { outcome: 'reused', number: 9, url: URL7 });
  assert.ok(recorded.lines.some((l) => l.startsWith('- SKIP ') && l.includes('rebind of reused PR #9 failed (HTTP 422)')));
});
```

In the CLI section, add the AC3 end-to-end test, using `pr-checklist`'s `run` (`const { run: runChecklist } = require('../../../plugin/bin/pr-checklist');`). Wrap `cliDeps`' `gh` to answer `pr edit` by capturing the `--body-file` path. The pr-checklist half supplies `{ cwd: () => fx.root, mainRoot: fx.root, ghAvailable: () => true, gh, now: () => NOW, stdout, stderr }`; its `gh` answers `pr view` with `JSON.stringify({ body })` and `pr edit` with `''`:

```js
test('AC3.1: after a rebind, pr-checklist.js --phase build exits 0 with action written; the un-rebound body exits 4', async () => {
  // run pr-early-open's CLI with list: [{ number: 7, url: URL7, state: 'OPEN', body: bodyFor(OTHER_RUN) }]
  // -> exit 0; the captured --body-file text is `rebound`.
  // runChecklist(['--run', fx.runDir, '--phase', 'build', '--fixes', '4027'], depsServing(rebound))
  //   -> 0, JSON.parse(stdout).action === 'written'
  // runChecklist(same argv, depsServing(bodyFor(OTHER_RUN))) -> 4  (discrimination: the fix is what flips it)
});
```

The implementer writes that test body from the comment, following those exact assertions.

Extend the existing test `every line written satisfies the bookkeeping-stamps gate's own matchers`: add `harness({ list: [{ number: 7, url: URL7, state: 'OPEN', body: bodyFor(OTHER_RUN) }] })` to `scenarios` (a successful rebind's lines never read as a degrade). Update the existing pin in `a recorded PR that is still OPEN is reused with no list call and no new log line` from `'state,isDraft,url'` to `'state,isDraft,url,body'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/flow/pr-early-open.test.js`
Expected: FAIL. The AC1.1, AC3.1 and AC4.1 tests fail (no `gh pr edit` call; pr-checklist exits 4), and so does the updated `--json` pin (`state,isDraft,url` ≠ `state,isDraft,url,body`). AC2.1 passes already, since it asserts an absence.

- [ ] **Step 3: Implement in `plugin/bin/lib/flow/pr-early-open.js`**

- `listPrs`: `--json number,url,state,isDraft,body`. Recorded-PR view: `--json state,isDraft,url,body`.
- Move the `writeBody` arrow above the `// Resume:` block (unchanged body). Below it, add `const namesOtherRun = (body) => …` (per Global Constraints) and `const rebind = (number, kind) => { … }`, where `kind` is `'reopened'` or `'reused'` and the two log texts are the Global Constraints' wordings with `{kind}` substituted.
- Reopen branch: replace its inline try/catch with `rebind(pick.number, 'reopened')` (still gated on `adopted === pick.number`).
- Recorded-PR path: `if (view && view.state === 'OPEN') { if (namesOtherRun(view.body)) rebind(recorded.number, 'reused'); return { … unchanged … }; }`.
- OPEN branch: after the `reusing open PR` log and before `record(...)`, `if (namesOtherRun(open.body)) rebind(open.number, 'reused');`.
- Header comment (lines 15-19): say that the rebind SKIP wording is shared by the reopened and reused paths, and that each is harmless because the PR is recorded either right after the rebind attempt (Step 1's paths) or already (the recorded-PR path).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-early-open.test.js tests/dispatch-retry-prior-attempt-conformance.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/pr-early-open.js tests/bin-lib/flow/pr-early-open.test.js
git commit -m "Rebind a reused PR's body to the resuming run — pr-early-open now rebinds on both reuse paths, refs #4580"
```

### Task 2: State the rebind in `_shared/pr-early-run-lifecycle.md`

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md` (Step 1's `gh pr list` command line 88; OPEN bullet lines 91-97; Resume section's `gh pr view` line 447 and "Still open" bullet line 450)
- Test: `tests/pr-early-run-lifecycle.test.js`, `tests/dispatch-retry-prior-attempt-conformance.test.js`, `tests/pr-early-run-lifecycle-step1-logging-conformance.test.js` (existing, run only. Their regexes are prefix matches on the two `--json` lists, so appending `,body` keeps them green)

**Interfaces:**
- Consumes: Task 1's log wordings (Global Constraints).
- Produces: nothing code-facing.

- [ ] **Step 1: Edit**

- Line 88: `--json number,url,state,isDraft,body`. Line 447: `--json state,isDraft,url,body`.
- After the OPEN bullet's `reusing open PR` log line (line 97), add one paragraph. It must open with `**Rebind a reused body (#4580).**` and say the following. When the reused PR's body names a run other than this one (the run adopted a prior attempt's branch, or resumed a run dir whose PR an earlier run opened), so that `bin/pr-checklist.js` would refuse it with exit 4, rebind it before Step 2's push, as **Rebind a retry's body (#3887)** below does. Compose this run's body per Step 3, write it with `gh pr edit {number} --repo {host}/{owner}/{repo} --body-file "$PR_EARLY_BODY"` (gh absent: `mcp__github__update_pull_request`, per the same `_shared/github-write-transport.md` section that paragraph cites), and log `AUTO {time} — PR-early run lifecycle: rebound reused PR #{number} to run {run-id}. Reversibility: high.` A failed rebind is a degrade, never a stop: keep and record the PR, and log `SKIP {time} — PR-early run lifecycle: rebind of reused PR #{number} failed ({error}); phase-checklist updates will exit 4 until its body names run {run-id}. Reversibility: n/a.` A body that already names this run, or carries no run marker at all (pr-checklist's own repair adds this run's), is left untouched.
- Resume "Still open" bullet: replace `nothing to do — proceed …` with: rebind it per Step 1's **Rebind a reused body (#4580)** when its body names another run, then proceed to whichever phase this resume targets.

- [ ] **Step 2: Verify**

Run: `node --test tests/pr-early-run-lifecycle.test.js tests/dispatch-retry-prior-attempt-conformance.test.js tests/pr-early-run-lifecycle-step1-logging-conformance.test.js`
Expected: PASS, 0 failures.
Run: `wc -c plugin/skills/_shared/pr-early-run-lifecycle.md`
Expected: under 52500.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/_shared/pr-early-run-lifecycle.md
git commit -m "State the reused-PR rebind in pr-early-run-lifecycle.md — OPEN-reuse and Resume bullets, refs #4580"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1 Step 3. Deliverable 2 → Task 2. Deliverable 3 → Task 1 Step 1. AC1 → AC1.1 tests (both paths). AC2 → AC2.1. AC3 → AC3.1 (CLI end-to-end through the real `pr-checklist.js` `run`). AC4 → AC4.1.
- **Placeholders:** the AC3.1 body is specified by its exact assertions, not left open.
- **Return-shape widening check:** `listPrs` rows gain `body`. No test deep-equals a `listPrs` row (`grep -n "listPrs" tests` finds nothing; it is module-internal). The only pinned `--json` argv is the recorded-view test, which Task 1 updates.
