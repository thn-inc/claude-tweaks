# pr-state by-number argument guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a misordered or malformed call to `resolvePrStateByNumber`/`resolveIssueStateByNumber` return the distinct string `'invalid-arguments'` (never `'network-failure'`, never a throw), and document the positional signature and return contract in `dispatch/close-out.md` step 2.

**Architecture:** One pure guard helper in `plugin/bin/lib/reconcile/pr-state.js`, called by both by-number resolvers right after their existing `if (!number) return null` short-circuit and before any `gh` spawn. The guard returns `'invalid-arguments'` instead of throwing, because both resolvers feed the never-throwing SessionStart reconcile sweep (`archive-merged.js`) and a `forEach` in `_shared/github-pr-scan.md`. All three consumers already gate on `typeof result === 'object'`, so a new third string falls into their existing failure branch with no consumer change.

**Tech Stack:** Node 18+ CommonJS, `node --test` + `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T174740-record-3029/work/3029-spec.md`

**Scope keywords:** resolvePrStateByNumber, resolveIssueStateByNumber

## Global Constraints

- Never throw on bad arguments — return `'invalid-arguments'`.
- The existing `if (!number) return null` short-circuit stays first: `resolvePrStateByNumber('/tmp', undefined)` still returns `null`.
- Accept numeric strings: `resolvePrStateByNumber('/tmp', '42')` passes the guard (callers pass JSON-parsed numbers).
- Valid-number rule: `String(number)` matches `/^[1-9]\d*$/`; `repoRoot` must be `typeof 'string'`.
- No `gh` process is spawned when the guard rejects.
- Commit style: `{Verb} {what} — {detail}`, body `Refs #3029`, trailer `Claude-Session: https://claude.ai/code/session_01RyNvQh7QCD9vX7sCWKRKzG`. Never `Fixes`/`Closes`.

## Review Focus

- A negative number (`-5`) or a float (`3.5`) — must return `'invalid-arguments'`, not reach `gh`. Pinned in Task 1.
- A positive-integer string (`'42'`) — must still reach `gh` and return the parsed object. Pinned in Task 1.
- Zero (`0`) — falsy, so the existing `null` short-circuit wins; must stay `null`, not `'invalid-arguments'`. Pinned in Task 1.
- A string `number` that is non-numeric (`'abc'`) with a valid `repoRoot` — without the guard this DOES spawn `gh pr view abc`; the test must prove no spawn. Pinned in Task 1 via an argv-log spy.
- A doc reader treating a string result as "not DIRTY" — close-out step 2 must say any string stops the candidate. Pinned in Task 2's conformance test.

---

### Task 1: Guard both by-number resolvers

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js:112-170` (the `resolvePrStateByNumber` and `resolveIssueStateByNumber` blocks and their header comments)
- Test: `tests/bin-lib/reconcile/pr-state.test.js` (append after the existing `resolveIssueStateByNumber: malformed gh output -> network-failure, no throw` test, ~line 396)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `resolvePrStateByNumber(repoRoot: string, number: number|string) -> object | null | 'gh-absent' | 'network-failure' | 'invalid-arguments'`; `resolveIssueStateByNumber` — same signature and result set. Task 2 documents exactly these three strings.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/reconcile/pr-state.test.js`, after the last `resolveIssueStateByNumber` test:

```js
// #3029: a misordered/object-shaped/non-numeric call is a programming error,
// not a transport failure — it must read 'invalid-arguments', never
// 'network-failure', and never throw (archive-merged.js's sweep and
// github-pr-scan.md's forEach both rely on these resolvers never throwing).
function installArgvSpy(json) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-state-ghwrap-guard-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  const argvLog = path.join(wrapperDir, 'argv.log');
  fs.writeFileSync(wrapperPath, `#!/bin/sh\necho "$@" >> "${argvLog}"\ncat <<'EOF'\n${JSON.stringify(json)}\nEOF\n`);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { called: () => fs.existsSync(argvLog), restore: () => { process.env.PATH = originalPath; } };
}

test('by-number resolvers: misordered/object-shaped calls -> invalid-arguments, no gh call, no throw (#3029)', () => {
  const spy = installArgvSpy({ number: 42, state: 'OPEN' });
  try {
    assert.equal(resolvePrStateByNumber(4242, { cwd: '/tmp', repo: 'o/r' }), 'invalid-arguments');
    assert.equal(resolveIssueStateByNumber(4343, { cwd: '/tmp' }), 'invalid-arguments');
    assert.equal(spy.called(), false);
  } finally {
    spy.restore();
  }
});

test('by-number resolvers: non-numeric, negative, and fractional numbers -> invalid-arguments, no gh call (#3029)', () => {
  const spy = installArgvSpy({ number: 42, state: 'OPEN' });
  try {
    for (const bad of ['abc', -5, 3.5, '042', '4 2', {}]) {
      assert.equal(resolvePrStateByNumber('/tmp', bad), 'invalid-arguments', `pr: ${JSON.stringify(bad)}`);
      assert.equal(resolveIssueStateByNumber('/tmp', bad), 'invalid-arguments', `issue: ${JSON.stringify(bad)}`);
    }
    assert.equal(spy.called(), false);
  } finally {
    spy.restore();
  }
});

test('by-number resolvers: falsy number still short-circuits to null before the guard (#3029)', () => {
  for (const fn of [resolvePrStateByNumber, resolveIssueStateByNumber]) {
    assert.equal(fn('/tmp', 0), null);
    assert.equal(fn('/tmp', undefined), null);
    assert.equal(fn(4242, null), null);
  }
});

test('by-number resolvers: a positive-integer string passes the guard and reaches gh (#3029)', () => {
  const spy = installArgvSpy({ number: 42, state: 'MERGED' });
  try {
    assert.equal(resolvePrStateByNumber('/tmp', '42').state, 'MERGED');
    assert.equal(resolveIssueStateByNumber('/tmp', '42').state, 'MERGED');
    assert.equal(spy.called(), true);
  } finally {
    spy.restore();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js`
Expected: FAIL — the misordered test gets `'network-failure'` instead of `'invalid-arguments'`, and the non-numeric test fails because `gh` is spawned for `'abc'`.

- [ ] **Step 3: Implement the guard**

In `plugin/bin/lib/reconcile/pr-state.js`, insert immediately above the `// #1962: archive-merged.js's main sweep derives a branch name` comment block:

```js
// #3029: caller-contract guard for the two by-number resolvers below. A
// misordered or object-shaped call (`resolvePrStateByNumber(4242, { cwd, repo })`)
// used to reach execFileSync, throw ERR_INVALID_ARG_TYPE, and be reported by
// classifyExecError as 'network-failure' — indistinguishable from a real outage.
// Returns 'invalid-arguments' rather than throwing: both resolvers feed the
// never-throwing SessionStart reconcile sweep (archive-merged.js) and
// github-pr-scan.md's per-PR forEach, where a throw would abort every
// remaining entry. Accepts a positive-integer string ('42') — callers pass
// JSON-parsed numbers.
const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;
function byNumberArgsValid(repoRoot, number) {
  return typeof repoRoot === 'string' && POSITIVE_INTEGER_RE.test(String(number));
}
```

Then, in `resolvePrStateByNumber`, change:

```js
function resolvePrStateByNumber(repoRoot, number) {
  if (!number) return null;
  return runClassified(
```

to:

```js
function resolvePrStateByNumber(repoRoot, number) {
  if (!number) return null;
  if (!byNumberArgsValid(repoRoot, number)) return 'invalid-arguments';
  return runClassified(
```

And in `resolveIssueStateByNumber`, change:

```js
function resolveIssueStateByNumber(repoRoot, number) {
  if (!number) return null;
  return runClassified(
```

to:

```js
function resolveIssueStateByNumber(repoRoot, number) {
  if (!number) return null;
  if (!byNumberArgsValid(repoRoot, number)) return 'invalid-arguments';
  return runClassified(
```

Update the two return-contract comments. In `resolvePrStateByNumber`'s header comment, replace the final sentence fragment `— no tie-break needed, since a PR number\n// resolves to at most one PR.` with:

```js
// — no tie-break needed, since a PR number
// resolves to at most one PR. Positional signature: (repoRoot, number) —
// repoRoot is the checkout whose `origin` gives gh its host and repo. Returns
// that object, null for a falsy number, or one of the strings 'gh-absent' /
// 'network-failure' (transport) / 'invalid-arguments' (#3029: a non-string
// repoRoot or a number that is not a positive integer, no gh call made).
```

In `resolveIssueStateByNumber`'s header comment, replace `// 'gh-absent'/'network-failure' like every other resolver in this module,\n// via the same classifyExecError/runClassified pair.` with:

```js
// 'gh-absent'/'network-failure' like every other resolver in this module,
// via the same classifyExecError/runClassified pair, and 'invalid-arguments'
// for a misordered/malformed call (#3029 — same guard as resolvePrStateByNumber).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js tests/reconcile.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state.js tests/bin-lib/reconcile/pr-state.test.js
git commit -m "Guard pr-state by-number resolvers — misordered calls return invalid-arguments, not network-failure" -m "Refs #3029

Claude-Session: https://claude.ai/code/session_01RyNvQh7QCD9vX7sCWKRKzG"
```

### Task 2: Document the contract in close-out step 2

**Files:**
- Modify: `plugin/skills/dispatch/close-out.md:41-43` (step 2's opening sentence)
- Create: `tests/close-out-pr-state-contract-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's result set — `'gh-absent'`, `'network-failure'`, `'invalid-arguments'`.
- Produces: nothing consumed by code.

- [ ] **Step 1: Write the failing conformance test**

Create `tests/close-out-pr-state-contract-conformance.test.js`:

```js
// tests/close-out-pr-state-contract-conformance.test.js — #3029: close-out.md
// step 2 must state resolvePrStateByNumber's positional signature and its full
// string-result contract, and say any string result stops the candidate —
// the missing signature is what let a caller misorder the arguments and read
// 'network-failure' as "not DIRTY".
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLOSE_OUT = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'close-out.md'), 'utf8');
const STEP_2 = CLOSE_OUT.slice(CLOSE_OUT.indexOf('2. **Re-check mergeability'), CLOSE_OUT.indexOf('3. **Convert draft to ready'));

test('close-out step 2 is locatable', () => {
  assert.ok(STEP_2.length > 0, 'step 2 span not found — the heading text moved');
});

test('close-out step 2 names the positional signature', () => {
  assert.match(STEP_2, /resolvePrStateByNumber\(repoRoot, number\)/);
});

test('close-out step 2 names every string result the resolver returns', () => {
  for (const s of ['gh-absent', 'network-failure', 'invalid-arguments']) {
    assert.ok(STEP_2.includes(`'${s}'`), `missing '${s}'`);
  }
});

test('close-out step 2 says a string result stops the candidate, never read as not DIRTY', () => {
  assert.match(STEP_2, /string result[\s\S]{0,120}stop[\s\S]{0,120}never read[\s\S]{0,40}not DIRTY/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
Expected: FAIL — `close-out step 2 names the positional signature` (the current text says only "Reuse `resolvePrStateByNumber`").

- [ ] **Step 3: Update close-out.md step 2**

In `plugin/skills/dispatch/close-out.md`, replace:

```markdown
2. **Re-check mergeability (AC3).** Reuse `resolvePrStateByNumber`
   (`bin/lib/reconcile/pr-state.js`) exactly as `_shared/github-pr-scan.md` item 11 already does for
   its own `mergeStateStatus` read — the same function, not a third PR-state-reading code path.
```

with:

```markdown
2. **Re-check mergeability (AC3).** Reuse `resolvePrStateByNumber(repoRoot, number)`
   (`bin/lib/reconcile/pr-state.js` — two positional arguments: the main checkout's path, whose
   `origin` remote gives `gh` its host and repo, then the PR number) exactly as
   `_shared/github-pr-scan.md` item 11 already does for its own `mergeStateStatus` read — the same
   function, not a third PR-state-reading code path. It returns the PR's
   `{state, mergeable, mergeStateStatus, …}` object, or one of the strings `'gh-absent'` /
   `'network-failure'` (transport failure) / `'invalid-arguments'` (a misordered or malformed
   call). Any string result stops this candidate — report it, and never read it as "not DIRTY".
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/close-out-pr-state-contract-conformance.test.js tests/bin-lib/reconcile/pr-state.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/close-out.md tests/close-out-pr-state-contract-conformance.test.js
git commit -m "Document resolvePrStateByNumber's signature in close-out step 2 — any string result stops the candidate" -m "Refs #3029

Claude-Session: https://claude.ai/code/session_01RyNvQh7QCD9vX7sCWKRKzG"
```
