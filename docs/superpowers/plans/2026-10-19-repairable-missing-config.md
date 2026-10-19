# Repairable missing-config Artifact Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify a first call whose only defect is a missing `config.yml` as `repairable`, and route that case to a repair-then-continue branch in the dispatch two-call gate instead of the §5 teardown.

**Architecture:** `checkFirstCallArtifacts` keeps first-failure-wins for every reason, but on `missing-config` it runs the claim checks and (policy-resolved `pr-first` only) the PR checks to compute an additive `repairable` boolean. A new pure `resolveFirstCallGate({ reply, artifact })` in the same module is the code twin of the gate's ordering (status line first, then OUTCOME, then artifact). `two-call-gate.md` §2 and `sequential-execution.md`'s loop gain the repair branch; `/flow`'s existing adoption logic rebuilds `config.yml` on call 2.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T141629-record-3226/work/3226-spec.md` (record #3226)

Scope keywords: checkFirstCallArtifacts, missing-config, repairable

## Global Constraints

- `repairable` is present only when `reason === 'missing-config'`; absent (not `false`) for every other reason and on `ok: true`.
- On the missing-config path the top-level return is always `{ ok: false, reason: 'missing-config', message, repairable }` — a secondary check's own reason never surfaces.
- `integration-model` is read with `resolvePolicyConfig` (`plugin/bin/lib/policy-schema.js`), never the defaulting `resolveIntegrationModel`; a throw, `invalid: true`, or unresolved (`null`) value ⇒ `repairable: false`.
- Strict `=== 'pr-first'` gates the PR checks; `local-merge` (any non-null non-`pr-first` value) skips them.
- Literal log line (exact copy): `AUTO {time} — Artifact check: config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption. Reversibility: high.`
- Call 2 is dispatched byte-identical to the normal second call — no repair flag or hint.
- Corrected premise (logged in decisions.md): `sequential-execution.md`'s stale `/claude-tweaks:flow {target} wrap-up` teardown reference was already fixed by #3367 and is pinned by `tests/dispatch-sequential-execution-conformance.test.js` AC2 — no edit for that deliverable. Waived AC8.2 (already satisfied at base; the existing #3367 pin covers it).

## Build deviations (Common Step 4.5)

- Beneficial: an unset `integration-model` key in `policy.yml` (`value: null`, not `invalid`) requires the same PR evidence as `pr-first` — never claim-only, never outright `false` (final-review ruling, `729a9e544`). The spec's "any other resolved value" rule covers resolved non-`pr-first` values only; an unresolved key is not one, and claim-only repair on it would repair on less evidence than `pr-first` demands. This supersedes the Review Focus line below that expected `false`.
- Beneficial: `resolveFirstCallGate` is the tested code twin of §2's ordering, so AC9's fixture test has a function to drive. It is not called at runtime; the prose pin (AC9.2) guards the executed gate.
- Update the spec (staged): the spec's "these fields are exactly what `computeAdoption` needs, no superset or subset" premise is wrong. `computeAdoption` keys on `state.pr`/`dispatched`/run content, and claim liveness serves call 2's ownership-checked release. The shipped comment states the real relationship.

## Review Focus

- `policy.yml` present but with no `integration-model:` key — resolves `value: null`; must be `repairable: false` (unresolved is missing evidence, not "some other value"). Test in Task 1.
- `policy.yml` absent entirely (readFile ENOENT throws inside `resolvePolicyConfig`) — must be `repairable: false`, never a throw out of the check. Test in Task 1.
- Multi-member group where one member's claim is live and another's is absent — must be `repairable: false`. Test in Task 1.
- A claim that is present but expired (`stale`, not `live`) — `repairable: false`. Test in Task 1.
- A reply whose status line has trailing text (`STATUS: DONE (backgrounded)`) paired with a `repairable: true` artifact — must resolve `blocked`, never `repair`. Test in Task 2.

---

### Task 1: `repairable` classification in `checkFirstCallArtifacts`

**Files:**
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js`
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js` (append only — existing cases stay byte-for-byte unchanged)

**Interfaces:**
- Consumes: `resolvePolicyConfig({ git, readFile, runDir, keys })` from `../policy-schema` (returns `{ root, policyRaw, runConfigRaw, result }`; `result['integration-model']` is `{ value, source, invalid? }`).
- Produces: `checkFirstCallArtifacts(...)` missing-config return `{ ok: false, reason: 'missing-config', message, repairable: boolean }`. Two private helpers extracted from the existing inline loops and reused by both paths: `claimFailure({ ghApi, repoSlug, issueNumbers, runId, now }) -> null | failObject` and `prFailure(parsedRunState, gitRunner) -> null | failObject` (the existing main-path checks call them so the two paths cannot drift).

- [ ] **Step 1: Append the failing tests** to `tests/bin-lib/dispatch/first-call-artifact-check.test.js`. Add a fixture helper `repoRootWithPolicy(policyText | null)` that makes a tmp dir, writes `{root}/.claude-tweaks/policy.yml` when text is non-null, and returns the root; and `fakeRepoGit(root, pushedBranches, calls = [])` that records each argv in `calls`, returns `root + '\n'` for `['rev-parse', '--show-toplevel']`, and otherwise behaves like `fakeGitRunner`. Every missing-config run dir is written with `writeRunDir(runDir, { runState })` (no config). Tests (names carry the AC ids):

```js
test('AC1.1: missing-config + live matching claim + pr-first PR recorded and pushed -> repairable: true', () => {
  // policy 'integration-model: pr-first\n'; runState { pr: { number: 42, url: '...', branch: 'worktree-2806' } }; branch pushed
  assert.deepEqual(result, { ok: false, reason: 'missing-config', message: result.message, repairable: true });
});
test('AC2.1: missing-config + claim absent, stale, or held under another runId -> repairable: false', () => {
  // three sub-cases in one test: fakeGhApi({2806: null}); claimedAt 100h before NOW with ttlHours 72; liveClaimContent('other-run')
  // each: assert.equal(r.reason, 'missing-config'); assert.equal(r.repairable, false)
});
test('AC3.1: missing-config under pr-first with PR unrecorded, branch unrecorded, or branch unpushed -> repairable: false', () => { /* runState {}, {pr:{number:42}}, pushed [] */ });
test('AC4.1: integration-model read fails (invalid value, policy.yml absent, readFile throws) -> repairable: false', () => {
  // 'integration-model: bogus\n'; repoRootWithPolicy(null); deps.readFile that throws for policy.yml but reads run-state.json
});
test('AC5.1: missing-config under local-merge with a live matching claim -> repairable: true from the claim checks alone', () => {
  // policy 'integration-model: local-merge\n', runState {} (no pr); assert repairable true AND calls has no ls-remote entry
});
test('Review focus: policy.yml without an integration-model key resolves unresolved -> repairable: false', () => { /* 'autonomy: trusted\n' */ });
test('Review focus: one member live, another absent -> repairable: false', () => { /* issueNumbers [2806, 2807] */ });
test('AC6.2: every reason other than missing-config, and ok: true, carries no repairable key', () => {
  // claim-absent with config present: assert.equal(Object.prototype.hasOwnProperty.call(r, 'repairable'), false)
  // pr-branch-unpushed with config present: same; fully-formed pass: assert.deepEqual(r, { ok: true })
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: FAIL — AC1.1/AC5.1 report `repairable` undefined (the AC6.2 test passes already; that is expected — it pins unchanged behavior).

- [ ] **Step 3: Implement.** Extract `claimFailure`/`prFailure` from the existing loops (same reasons, same messages, same order). On the `config.yml` read failure, return `{ ...fail('missing-config', msg), repairable: assessRepairable(...) }` where `assessRepairable` runs inside one `try { … } catch { return false; }`: claims first (`claimFailure` non-null ⇒ false); then `resolvePolicyConfig({ git: gitRunner, readFile, keys: ['integration-model'] }).result['integration-model']` — `!entry || entry.invalid || entry.error || entry.value == null` ⇒ false; `entry.value === 'pr-first'` ⇒ `prFailure(...) === null`; otherwise ⇒ true. Update the header comment: state the missing-config exception to first-failure-wins, and add the cross-reference — claim liveness/`runId` and PR recorded/pushed are exactly the facts `plugin/bin/lib/flow/preflight.js`'s `computeAdoption` keys on to land call 2 in case 3 (a recorded `pr` with `dispatched: true` and no `config.yml` is case 3; without `pr`, under local-merge, case 2 initializes in place — #3242) — no superset, no subset.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: PASS, every pre-existing case included (AC6.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/first-call-artifact-check.js tests/bin-lib/dispatch/first-call-artifact-check.test.js
git commit -m "Classify a missing-config first call as repairable — claim/PR evidence decides (refs #3226)"
```

### Task 2: `resolveFirstCallGate` — the gate's ordering as code

**Files:**
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js` (add + export)
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`

**Interfaces:**
- Consumes: Task 1's artifact result shape.
- Produces: `resolveFirstCallGate({ reply, artifact }) -> 'blocked' | 'already-shipped' | 'artifact-failed' | 'repair' | 'dispatch'`. Order: (1) reply's last non-empty line must match `^STATUS: (DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)$` and be `DONE`/`DONE_WITH_CONCERNS`, else `'blocked'`; (2) `OUTCOME:` line value `already-shipped` ⇒ `'already-shipped'`, anything but `build-test-ok` ⇒ `'blocked'`; (3) `artifact && artifact.ok === true` ⇒ `'dispatch'`; `artifact.reason === 'missing-config' && artifact.repairable === true` ⇒ `'repair'`; else (including absent artifact) ⇒ `'artifact-failed'`.

- [ ] **Step 1: Append the failing tests**

```js
const REPAIRABLE = { ok: false, reason: 'missing-config', message: 'm', repairable: true };
const reply = (status, outcome = 'build-test-ok') => `GROUP: 3226\nOUTCOME: ${outcome}\nMANIFEST: /x\n\n${status}\n`;
test('AC9.1: a malformed status line with a repairable artifact resolves blocked, never repair', () => {
  assert.equal(resolveFirstCallGate({ reply: reply('STATUS: DONE (backgrounded)'), artifact: REPAIRABLE }), 'blocked');
  assert.equal(resolveFirstCallGate({ reply: 'GROUP: 3226\nOUTCOME: build-test-ok\n', artifact: REPAIRABLE }), 'blocked');
  assert.equal(resolveFirstCallGate({ reply: reply('STATUS: BLOCKED'), artifact: REPAIRABLE }), 'blocked');
});
test('resolveFirstCallGate: clean pair + repairable -> repair; ok -> dispatch; non-repairable or other reason -> artifact-failed', () => { /* DONE_WITH_CONCERNS also clean */ });
test('resolveFirstCallGate: OUTCOME already-shipped -> already-shipped; build-test-failed -> blocked', () => { /* artifact undefined */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: FAIL after Step 1 — `resolveFirstCallGate is not a function`.

- [ ] **Step 3: Implement `resolveFirstCallGate` and add it to `module.exports`.**

- [ ] **Step 4: Run to verify they pass** (same command) — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/first-call-artifact-check.js tests/bin-lib/dispatch/first-call-artifact-check.test.js
git commit -m "Add resolveFirstCallGate — status line before artifact check, as code (refs #3226)"
```

### Task 3: Repair branch in `two-call-gate.md` §2 and `sequential-execution.md`'s loop

**Files:**
- Modify: `plugin/skills/dispatch/two-call-gate.md` (§2 only; ~13.8 KB, far under the 51,200-byte ceiling; no file-specific byte pin found by `grep -rn two-call-gate tests` — only content pins in flow-cleanup-only, build-already-shipped-exit, pr-first-merge, settle-and-merge-lazy-read, wrap-up-record-resolution, none on §2's text)
- Modify: `plugin/skills/dispatch/sequential-execution.md` ("The loop" → "Artifact check, first call only (#2837)" paragraph only; ~15.3 KB)
- Test: `tests/dispatch-mechanical-enforcement.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `repairable`, Task 2's `resolveFirstCallGate` (cited by name in prose).

- [ ] **Step 1: Append the failing tests.** Factor one assertion function used by the positive tests and the go-red control:

```js
const REPAIR_LINE = "AUTO {time} — Artifact check: config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption. Reversibility: high.";
function section(t, start, end) { const s = t.indexOf(start); const e = t.indexOf(end, s + 1); assert.ok(s > -1 && e > s, `section ${start} not found`); return t.slice(s, e); }
function assertRepairBranch(text) {
  assert.ok(text.includes(REPAIR_LINE), 'literal repair log line');
  assert.match(text, /`repairable: true`/);
  assert.match(text, /`repairable: false`/);
  const status = text.search(/status line/i);
  const artifact = text.indexOf('Artifact check');
  const repair = text.indexOf(REPAIR_LINE);
  assert.ok(status > -1 && status < artifact && artifact < repair, 'status-line check precedes the artifact check precedes the repair branch');
}
test('AC7.1: two-call-gate.md §2 carries the repair branch, its literal log line, and an unchanged call 2', () => {
  const s = section(read('plugin/skills/dispatch/two-call-gate.md'), '## 2. The gate', '## 5.');
  assertRepairBranch(s);
  assert.match(s, /byte-identical/);
  assert.match(s, /keeps section 5's teardown/);
  assert.match(s, /resolveFirstCallGate/);
});
test('AC8.1: sequential-execution.md\'s loop mirrors the repair branch', () => {
  assertRepairBranch(section(read('plugin/skills/dispatch/sequential-execution.md'), '## The loop', '## No per-group timeout'));
});
test('AC9.2: in both files a malformed status line stays BLOCKED regardless of a repairable artifact', () => {
  assert.match(section(read('plugin/skills/dispatch/two-call-gate.md'), '## 2. The gate', '## 5.'), /malformed status line is `BLOCKED` regardless/);
  assert.match(section(read('plugin/skills/dispatch/sequential-execution.md'), '## The loop', '## No per-group timeout'), /malformed status line is `BLOCKED` regardless/);
});
test('go-red control: assertRepairBranch fails on §2 with the repair line removed, or moved before the status-line check', () => {
  const s = section(read('plugin/skills/dispatch/two-call-gate.md'), '## 2. The gate', '## 5.');
  assert.throws(() => assertRepairBranch(s.split(REPAIR_LINE).join('')));
  assert.throws(() => assertRepairBranch(REPAIR_LINE + '\n' + s.split(REPAIR_LINE).join('')));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dispatch-mechanical-enforcement.test.js`
Expected: FAIL after Step 1 — `literal repair log line`.

- [ ] **Step 3: Edit the prose.** In `two-call-gate.md` §2, change the closing sentence to "Only `{ ok: true }` — or the repair branch below — together with a clean STATUS/OUTCOME pair clears this gate." and append this paragraph after it (exact copy):

```markdown
**Repair branch: `missing-config` with `repairable: true` (#3226).** One failed result is not routed to section 5. When the check returns `reason: 'missing-config'` with `repairable: true` — `config.yml` is the only artifact missing, every member's claim is still live under `basename(runDir)`, and, when `integration-model` (read from `policy.yml`, since the run's own `config.yml` is the missing file) is `pr-first`, the recorded PR's head branch is on `origin` — log

`AUTO {time} — Artifact check: config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption. Reversibility: high.`

via `log-decision.js --status AUTO --step "Artifact check" --text "config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption" --reversibility high`, then dispatch the second call unchanged: byte-identical to the normal second-call invocation, with no repair flag or hint. `/flow` detects the repair from on-disk state alone — no `config.yml`, other run content present, and a recorded `pr` land call 2 in adoption case 3 (`flow/steps-and-gates.md`'s "Adopting an inherited run directory"; `bin/lib/flow/preflight.js`'s `computeAdoption`), which rewrites `config.yml` through `set-config.js` from `decisions.md`'s config snapshot. Under `local-merge` no `pr` is recorded, so the same run lands in case 2, which initializes `config.yml` in place. Every other failed result, and `missing-config` with `repairable: false`, keeps section 5's teardown. The repair branch is reachable only after the status-line check (#2429) and a clean STATUS/OUTCOME pair: a malformed status line is `BLOCKED` regardless of what the artifact check would return. `resolveFirstCallGate` in the same module is this ordering as code.
```

In `sequential-execution.md`'s "Artifact check, first call only (#2837)" paragraph, append (exact copy):

```markdown
The one exception is `two-call-gate.md` section 2's repair branch (#3226): a `missing-config` result carrying `repairable: true` is logged as `AUTO {time} — Artifact check: config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption. Reversibility: high.` and the second call is dispatched unchanged, because `/flow`'s own adoption rebuilds `config.yml` from on-disk state; `missing-config` with `repairable: false` keeps the teardown. The artifact check is consulted only after the status-line check above passes, so a malformed status line is `BLOCKED` regardless of a `repairable` result.
```

- [ ] **Step 4: Run to verify they pass, plus the suites named in AC 10**

Run: `node --test tests/dispatch-mechanical-enforcement.test.js tests/flow-cleanup-only-conformance.test.js tests/build-already-shipped-exit.test.js tests/dispatch-sequential-execution-conformance.test.js tests/pr-first-merge.test.js tests/dispatch-settle-and-merge-lazy-read.test.js tests/wrap-up-record-resolution-conformance.test.js tests/dispatch-heartbeat-visibility.test.js`
Expected: PASS (AC10.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/two-call-gate.md plugin/skills/dispatch/sequential-execution.md tests/dispatch-mechanical-enforcement.test.js
git commit -m "Add the missing-config repair branch to the two-call gate — dispatch call 2 unchanged (refs #3226)"
```
