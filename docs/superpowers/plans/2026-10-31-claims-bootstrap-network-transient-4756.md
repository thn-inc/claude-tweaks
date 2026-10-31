# Claims-branch bootstrap: network failure is transient (#4756) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A network failure while `claim-targets.js` bootstraps the missing `claims-registry` branch exits 4 (transient), and exit 6 is kept for real refusals.

**Architecture:** `classifyGhApiError` gains a `permission-refused` outcome for HTTP 401/403 (not a secondary rate limit), so `network-failure` now means transport only. `ensureClaimsBranch` marks a contents-API leg that failed with `network-failure` as transient, the same way it already marks `secondary-rate-limit`, and names the cause in a new `failure` field. `handleBranchMissing` uses that field to pick the exit-4 error name. The exit-code prose then follows.

**Tech Stack:** Node.js (CommonJS), `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T205402-record-4756/work/4756-spec.md`

Scope keywords: ensureClaimsBranch, claims-branch-bootstrap-rate-limited

## Global Constraints

- New classifier outcome, exact value: `{ failure: 'permission-refused', status: 401 }` or `{ failure: 'permission-refused', status: 403 }`.
- New exit-4 error name, exact value: `claims-branch-bootstrap-network-failure`. The existing `claims-branch-bootstrap-rate-limited` stays unchanged.
- Exit 6 is kept for genuine refusals only: permission 401/403, a ruleset 422, and 404 (spec Deliverable 3).
- Every existing caller of `classifyGhApiError` / `defaultGhApi` keeps its current exit behaviour for a 403/401 (spec Deliverable 1). Caller audit, done at plan time:
  - `reconcile/pr-state.js:32`, `reconcile/release-merged.js:155` and `reconcile/preflight.js:36` collapse everything except `gh-absent` to one value, so they are unchanged.
  - `release-claim/release.js:102` passes `failure` into a thrown Error message. That is still a throw, so it is unchanged.
  - `claim-targets.js:502` and `:621`, `dispatch-resume.js:496` and `dispatch/first-call-artifact-check.js:133` test `failure` for truthiness, so the exit is unchanged.
  - `list-claims.js` passes the value through and documents the list of values at line 22. Only that comment changes.
  - The one visible difference: on a claim read or write refused by a permission 401/403, the exit-4 envelope's `error` string reads `permission-refused` where it used to read `network-failure`. Name this in the PR.
- Governing skill `gh-api-module-pattern` (`batching-failure-posture.md`), verbatim: "Enumerate an operation's full documented error-status set in one sitting." and "Classify a `gh api` rate-limit failure per `plugin/skills/_shared/github-rate-limit.md`'s taxonomy before deciding whether to retry — a plain 403 under that file's rules is not transient and must not be retried." (`SKILL.md`): "Over the contents API, `POST repos/{slug}/git/refs` answers 422 for both \"reference already exists\" and a ruleset refusal, so the 422 is settled by a branch re-read (`claimsBranchExists` in `plugin/bin/lib/issues/claim-store.js`): present is the lost race, absent is a refusal, and a `null` read (the lookup itself failed) is neither."
- Size headroom: `plugin/skills/_shared/issue-claims.md` is 49449 bytes against `RAIL_BYTES` 52500 (94%, nearCeiling). The Task 3 edit there replaces a clause and adds at most 120 bytes net. No other governed file is near the rail (`flow/claim-targets.md` 37368, `dispatch/settle-and-merge.md` 46146).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

1. **A 403 that is a secondary rate limit** must still classify as `secondary-rate-limit`. The new permission check sits after the rate-limit check. The existing tests "classifyGhApiError: secondary rate limit is distinct from network-failure" and "Retry-After signature" pin this, and both must stay green (Task 1).
2. **A permission 403 on a claim read** (not a bootstrap) keeps exit 4 and now reads `error: 'permission-refused'`. Task 1 adds a claim-targets test for it.
3. **A network failure before the POST** (the default-branch read or the tip read) is transient too, because both go through `apiRefusal`. Task 2 extends the existing "unresolvable default branch" test.
4. **The git leg refused while the contents-API leg hit a network failure** is transient: a later run may succeed. Task 2 adds a claim-store test.
5. **`gh-absent` in the contents-API leg** stays a refusal, never transient. Task 2 adds a claim-store test.

---

### Task 1: Split a permission refusal out of `network-failure` in `classifyGhApiError`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js:108-158` (header comment and `classifyGhApiError`)
- Modify: `plugin/bin/list-claims.js:22` (comment listing failure values: add `permission-refused`)
- Test: `tests/bin-lib/issues/claim-store.test.js` (replace the test at line 371, "a plain 403 with no rate-limit text still falls to network-failure")
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js` (add one read-site test next to the "write secondary-rate-limit" tests, around line 1598)

**Interfaces:**
- Produces: `classifyGhApiError(e) -> { failure: 'gh-absent'|'secondary-rate-limit'|'permission-refused'|'network-failure'|null, status: number|null }`. For `permission-refused`, `status` is the matched 401 or 403.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/claim-store.test.js`, replace the test "classifyGhApiError: a plain 403 with no rate-limit text still falls to network-failure" with:

```js
test('AC1.1 AC1.2: classifyGhApiError: a plain HTTP 403 and an HTTP 401 are permission-refused, never network-failure', () => {
  const forbidden = new Error('gh: Resource not accessible by integration (HTTP 403)');
  forbidden.stderr = 'gh: Resource not accessible by integration (HTTP 403)';
  assert.deepEqual(classifyGhApiError(forbidden), { failure: 'permission-refused', status: 403 });
  const unauthorized = new Error('gh: Bad credentials (HTTP 401)');
  assert.deepEqual(classifyGhApiError(unauthorized), { failure: 'permission-refused', status: 401 });
});

test('classifyGhApiError: a transport error with no HTTP status stays network-failure', () => {
  assert.deepEqual(classifyGhApiError(new Error('read ECONNRESET')), { failure: 'network-failure', status: null });
  assert.deepEqual(classifyGhApiError(new Error('gh: HTTP 502: Bad Gateway')), { failure: 'network-failure', status: null });
});
```

In `tests/bin-lib/claim-targets/claim-targets.test.js`, add:

```js
test('read refused by a permission 403: still transient exit 4 (exit behaviour unchanged), error names permission-refused', () => {
  const { ghApi } = makeGhApi({
    reads: { 742: [{ stdout: null, failure: 'permission-refused', status: 403 }] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '742'], deps);

  assert.equal(code, 4, io.err.join(''));
  assert.deepEqual(JSON.parse(io.out[0]).transient, [{ issue: 742, error: 'permission-refused' }]);
});
```

- [ ] **Step 2: Run tests to verify the classifier test fails**

Run: `node --test --test-name-pattern="AC1.1" tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL. The actual value is `{ failure: 'network-failure', status: null }`.

(The claim-targets read test passes before and after this task, because it pins caller behaviour that must stay the same. It is not the go-red test.)

- [ ] **Step 3: Implement the permission branch in `classifyGhApiError` (`plugin/bin/lib/issues/claim-store.js`)**

Add one branch directly after the secondary-rate-limit line and before the 404 line. It matches `/\bHTTP (401|403)\b/` against the error text and returns `{ failure: 'permission-refused', status: Number(match[1]) }`. Extend the header comment with a paragraph: a permission refusal (401, or 403 that is not a secondary rate limit) is its own outcome, so `network-failure` means a transport failure only (#4756). Update the `list-claims.js:22` comment to list `permission-refused`.

- [ ] **Step 4: Run both test files**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/list-claims.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "fix: classify a permission 401/403 as permission-refused, not network-failure (refs #4756)"
```

### Task 2: A transport failure during the claims-branch bootstrap is transient (exit 4)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js:534-589` (`apiRefusal`, `ensureClaimsBranch` and their comments)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js:467-497` (`handleBranchMissing` and its comment)
- Test: `tests/bin-lib/issues/claim-store.test.js` (the `ensureClaimsBranch` block, lines 1198-1235)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js` (the bm4 / bm4c / bm5 / bm7 fixtures, and new bm8c / bm8d)

**Interfaces:**
- Consumes: `permission-refused` from Task 1.
- Produces: `ensureClaimsBranch(deps, repoSlug) -> { ok: true, created, via } | { ok: false, reason } | { ok: false, reason, transient: true, failure: 'secondary-rate-limit'|'network-failure' }`. `apiRefusal(r)` sets `transient: true, failure: r.failure` when `r.failure` is `secondary-rate-limit` or `network-failure`. Everything else, including `permission-refused` and `gh-absent`, is a refusal with no `transient` key.

- [ ] **Step 1: Update the fixtures that modelled a permission refusal as `network-failure`, and write the new tests**

Before #4756, the classifier produced `network-failure` for a permission 403, so these fixtures used it. Change each one to `failure: 'permission-refused', status: 403`, keeping its `error` text:
- claim-store "ensureClaimsBranch: both legs refused → ok:false with both reasons verbatim" (line 1216)
- claim-targets bm4 (line 2277), bm4c (line 2301), bm5 (line 2338) and bm7 (line 2371). These now also cover AC3.1.

In claim-store, rewrite "ensureClaimsBranch: a secondary-rate-limit POST is transient (reason verbatim); a 403 network-failure POST is not" as:

```js
test('AC4.1: ensureClaimsBranch: a secondary-rate-limit or network-failure POST is transient and names its failure; a permission-refused POST is not', () => {
  const post = (p) => ensureClaimsBranch({ ghApi: bootstrapGhApi([], { post: p }) }, 'acme/w');
  assert.deepEqual(post({ stdout: null, failure: 'secondary-rate-limit', status: 403, error: 'HTTP 403: secondary rate limit' }),
    { ok: false, reason: 'contents-api: HTTP 403: secondary rate limit', transient: true, failure: 'secondary-rate-limit' });
  assert.deepEqual(post({ stdout: null, failure: 'network-failure', status: null, error: 'read ECONNRESET' }),
    { ok: false, reason: 'contents-api: read ECONNRESET', transient: true, failure: 'network-failure' });
  assert.deepEqual(post({ stdout: null, failure: 'permission-refused', status: 403, error: 'HTTP 403: Forbidden' }),
    { ok: false, reason: 'contents-api: HTTP 403: Forbidden' });
});

test('ensureClaimsBranch: git leg refused + contents-API network failure → transient (a later run may succeed)', () => {
  const gitRunner = (args) => { if (args[0] === 'push') throw gitError('remote: Permission to acme/w.git denied'); return args[0] === 'rev-parse' ? 'abc\n' : ''; };
  const r = ensureClaimsBranch({ ghApi: bootstrapGhApi([], { post: { stdout: null, failure: 'network-failure', status: null, error: 'read ETIMEDOUT' } }), gitRunner }, 'acme/w');
  assert.equal(r.ok, false);
  assert.equal(r.transient, true);
  assert.equal(r.failure, 'network-failure');
  assert.match(r.reason, /^git: .*; contents-api: read ETIMEDOUT$/s);
});

test('ensureClaimsBranch: gh-absent on the contents-API leg is a refusal, never transient', () => {
  const r = ensureClaimsBranch({ ghApi: () => ({ stdout: null, failure: 'gh-absent', status: null }) }, 'acme/w');
  assert.equal(r.ok, false);
  assert.equal('transient' in r, false);
});
```

Extend "ensureClaimsBranch: an unresolvable default branch is a refusal, no POST" (its fixture is `network-failure` with `HTTP 502: Bad Gateway`). Add `assert.equal(r.transient, true); assert.equal(r.failure, 'network-failure');` and rename it to "...a default-branch read lost to a network failure is transient, no POST".

In claim-targets, add these next to bm8b:

```js
test('AC2.1 AC2.2: (bm8c) bootstrap POST fails with a transport error (no HTTP status): transient exit 4 named claims-branch-bootstrap-network-failure, never exit 6', () => {
  const { ghApi, state } = makeBranchlessGhApi({
    postResponse: { stdout: null, failure: 'network-failure', status: null, error: 'read ECONNRESET' },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 4, io.err.join(''));
  assert.deepEqual(JSON.parse(io.out[0]).transient, [{ issue: 720, error: 'claims-branch-bootstrap-network-failure' }]);
  assert.ok(!io.err.join('').includes(REFUSAL_PREFIX), 'no exit-6 stderr line');
  assert.equal(state.refPosts, 1, 'bootstrap is attempted once per run');
});

test('AC2.1: (bm8d) --keep-going with a transport-failed bootstrap skips the target as transient, exit 0', () => {
  const { ghApi } = makeBranchlessGhApi({
    postResponse: { stdout: null, failure: 'network-failure', status: null, error: 'read ECONNRESET' },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720', '--keep-going'], deps);

  assert.equal(code, 0, io.err.join(''));
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.deepEqual(body.skipped, [{ issue: 720, reason: 'transient', error: 'claims-branch-bootstrap-network-failure' }]);
});
```

Existing bm8b (`claims-branch-bootstrap-rate-limited`, exit 4) stays unchanged and covers AC4.1 at the CLI level.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="AC2|AC4" tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL after Step 1. bm8c exits 6 instead of 4. The AC4.1 rate-limit `deepEqual` has no `failure` key, and the network-failure POST has no `transient` key.

- [ ] **Step 3: Implement**

- `apiRefusal(r)` in `claim-store.js`: add `transient: true, failure: r.failure` when `r.failure` is `'secondary-rate-limit'` or `'network-failure'`. Update its comment: a transport failure is transient too (#4756), and a permission refusal is not.
- `ensureClaimsBranch`: when the contents-API leg is transient, return `{ ok: false, reason, transient: true, failure: a.failure }`. Update the doc comment's return line and its `transient` sentence to match.
- `handleBranchMissing` in `claim-targets.js`: in the `!b.ok && b.transient` branch, the error is `'claims-branch-bootstrap-rate-limited'` when `b.failure === 'secondary-rate-limit'`, otherwise `'claims-branch-bootstrap-network-failure'`. Update the comment above it: a secondary rate limit or a transport failure on the create is transient, and exit 6 is for a permission 401/403, a ruleset 422 or a 404.

- [ ] **Step 4: Run both test files**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/claim-targets/claim-targets.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "fix: a network failure while bootstrapping claims-registry is transient exit 4 (refs #4756)"
```

### Task 3: Exit-code prose: a network failure during bootstrap is exit 4

**Role:** transcription

**Files:**
- Modify: `plugin/bin/claim-targets.js:6-14` (header comment) and `:52`, `:55` (USAGE exit 4 and exit 6 lines)
- Modify: `plugin/skills/flow/claim-targets.md:316-318` (exit 4 bullet) and `:335` (exit 6 bullet)
- Modify: `plugin/skills/dispatch/settle-and-merge.md:45-46` (the "Claims branch missing" parenthetical)
- Modify: `plugin/skills/_shared/issue-claims.md:47` ("a refused creation exits `6`…"). Keep the net addition at 120 bytes or less (nearCeiling).
- Modify: `docs/plugin-structure.md:213` (claim-targets row: exit 4 and exit 6 clauses)
- No change: `docs/superpowers/plans/2026-10-31-claims-registry-bootstrap-4495.md`, a historical plan.

**Interfaces:**
- Consumes: the error name `claims-branch-bootstrap-network-failure` (Task 2).

- [ ] **Step 1: Edit each site**

- Exit 4 wording: covers a `claims-registry` bootstrap that hit a secondary rate limit (`claims-branch-bootstrap-rate-limited`) or a network failure (`claims-branch-bootstrap-network-failure`). Under `--keep-going` it is a skip.
- Exit 6 wording: the branch could not be created because the creation was refused (a permission 401/403, a ruleset 422 or a 404). A network failure during the bootstrap is exit 4, not exit 6.
- `USAGE` line 52: `exit 4 = transient gh failure (incl. a claims-registry bootstrap rate-limited by GitHub or lost to a network failure)`. Line 55: `exit 6 = the claims-registry branch is missing on origin and its creation was refused (permission, ruleset or 404) —`.

- [ ] **Step 2: Verify the prose**

Run: `grep -c -F "claims-branch-bootstrap-network-failure" plugin/skills/flow/claim-targets.md docs/plugin-structure.md`
Expected: each count is 1 or more. Control: both are 0 at the base, checked at plan time.

Run: `grep -n -i -F "network failure" plugin/bin/claim-targets.js plugin/skills/dispatch/settle-and-merge.md plugin/skills/_shared/issue-claims.md`
Expected: each file has a line, and in each the network failure is tied to the bootstrap and to exit 4 / transient (AC5.1). Control: all three are 0 at the base, checked at plan time.

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. The `rail:` cases in `context-cost.test.js` must not report `issue-claims.md` or a composed bundle over the rail.

- [ ] **Step 3: Commit**

```bash
git add plugin/bin/claim-targets.js plugin/skills/flow/claim-targets.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/_shared/issue-claims.md docs/plugin-structure.md
git commit -m "docs: a network failure during the claims-registry bootstrap is exit 4, not 6 (refs #4756)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1, AC1.1, AC1.2 | Task 1 |
| Deliverable 2, AC2.1, AC2.2 | Task 2 (bm8c, bm8d) |
| Deliverable 3, AC3.1 | Task 2 (bm4, bm5 and bm7 re-pointed to `permission-refused`, still exit 6, still printing the one-line reason) |
| AC4.1 | Task 2 (bm8b unchanged, plus the AC4.1 claim-store test) |
| Deliverable 4, AC5.1 | Task 3 |
