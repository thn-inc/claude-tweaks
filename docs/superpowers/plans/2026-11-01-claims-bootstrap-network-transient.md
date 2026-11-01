# Claims-branch bootstrap: network failure is transient — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A network blip (or primary rate limit) while `claim-targets.js` bootstraps the missing `claims-registry` branch exits 4 (transient, a `--keep-going` skip) instead of exit 6; exit 6 stays for genuine refusals (permission 401/403, a confirmed-absent 422, 404).

**Architecture:** Split a `permission-refused` outcome out of `network-failure` in `classifyGhApiError` (with primary rate-limit text kept on `network-failure`), mark every `network-failure` in `ensureClaimsBranch`'s contents-API leg (and a 422 whose branch re-read is unreadable) as `transient` with a `failure` kind, and have `handleBranchMissing` name the transient by kind. Then sweep the exit-code prose.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191329-record-4756/work/4756-spec.md`

Scope keywords: classifyGhApiError, ensureClaimsBranch, claims-branch-bootstrap

Check B sweep, classified no-change: `plugin/bin/lib/reconcile/{preflight,pr-state,release-merged}.js` and `plugin/bin/lib/release-claim/release.js` (classifier consumers that keep their exit behaviour — Task 1's enumeration), `plugin/bin/lib/issues/claims-git-cas.js` (the git leg — its refusal reason is only concatenated, never classified), `tests/bin-lib/reconcile/release-merged.test.js` (no 403 case), `docs/donts.md` and `docs/superpowers/plans/2026-10-31-claims-registry-bootstrap-4495.md` (history).

## Global Constraints

- New classifier outcome name, exactly: `failure: 'permission-refused'`, with `status` the HTTP code (`401` or `403`).
- New transient error name, exactly: `claims-branch-bootstrap-network-failure`. The existing `claims-branch-bootstrap-rate-limited` stays for the secondary rate limit.
- The exit-6 stderr line is unchanged: `claim-targets: claims-registry branch missing on origin and could not be created: {reason} — create it from the default branch`.
- Exit 6 stays for genuine refusals only: permission 401/403, a ruleset 422 whose branch re-read succeeds and shows no branch, and 404 (spec Deliverable 3). `gh-absent` and "the repository reported no default branch" also stay refusals (unchanged).
- A primary rate-limit 403 or 429 (`API rate limit exceeded`, or `X-RateLimit-Remaining: 0`) stays transient — `network-failure` — never `permission-refused` (spec Deliverable 5).
- Governing skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/batching-failure-posture.md`), verbatim: "Classify a `gh api` rate-limit failure per `plugin/skills/_shared/github-rate-limit.md`'s taxonomy before deciding whether to retry — a plain 403 under that file's rules is not transient and must not be retried." And: "Enumerate an operation's full documented error-status set in one sitting."
- `plugin/skills/_shared/github-rate-limit.md`, verbatim rows: Primary exhaustion = "HTTP 403 or 429 whose body/headers show `X-RateLimit-Remaining: 0` on the bucket in use" → Transient; Plain 403 (catchall) = "Carries neither the secondary-limit message nor exhaustion evidence" → "Not transient — never retry".
- Every other caller of `classifyGhApiError` / `defaultGhApi` keeps its exit code for a 403/401 (spec Deliverable 1). Enumerated in Task 1's Interfaces block; the only visible change is the error *name* some of them print (`permission-refused` instead of `network-failure`). Name that in the PR description.
- Skill-file byte rail is `RAIL_BYTES` = 52,500 B. Measured at base: `_shared/issue-claims.md` 49,449 B (3,051 headroom), `dispatch/settle-and-merge.md` 47,046 B (5,454), `flow/claim-targets.md` 37,894 B (14,606). Prose additions are one clause each — no file approaches the rail.

## Review Focus

1. A gh timeout (`ETIMEDOUT`, a killed process with no HTTP status) during the default-branch or tip read, before any POST, is a transport failure — the bootstrap must be transient, not exit 6. Test: Task 2 (`ensureClaimsBranch: an unreachable default-branch read is transient, no POST`).
2. The git leg failing on a network error while the contents-API leg answers a permission 403 is a genuine refusal — exit 6, never transient. Test: Task 2 (`ensureClaimsBranch: git network failure + contents-API permission 403 → refusal`).
3. `gh: API rate limit exceeded ... (HTTP 403)` with no `Retry-After` must not read as `permission-refused` (it would turn a waitable throttle into a permanent stop). Test: Task 1 (AC6.1).
4. A bare `HTTP 429` (no body text) stays `network-failure`. Test: Task 1.
5. Every non-bootstrap claim path that sees a permission 403 (claim read, claim write) keeps exit 4 — only the printed error name changes. Test: Task 3 (`a permission-refused claim read keeps exit 4`).

---

### Task 1: Split `permission-refused` out of `network-failure` in `classifyGhApiError`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js:109-159` (header comment + `classifyGhApiError`)
- Test: `tests/bin-lib/issues/claim-store.test.js` (new classifier tests; rewrite the test at :371)

**Interfaces:**
- Produces: `classifyGhApiError(e) -> { failure: 'permission-refused', status: 401 | 403 }` for an HTTP 401, and for an HTTP 403 that is neither a secondary rate limit nor primary exhaustion. All other outcomes unchanged.
- Consumer enumeration (each keeps its exit behaviour; verify by reading, no code change):
  - `claim-store.js` internals (`readClaimBlobContentsApi`, `listClaimEntries`, `writeClaimBlob`, `claimsBranchExists`, `createClaimsBranchContentsApi`, `createClaimReader`): all branch on `failure` truthiness or on `status === 404/409/422`; a 403/401 still carries a truthy `failure` and a status that matches none of those.
  - `claim-targets.js` read/write paths (:502, :620): any `failure` → exit 4, error = the failure name (now `permission-refused`).
  - `list-claims.js`: any failure → exit 3, stderr prints the name.
  - `dispatch-resume.js` (:503): any claim-read failure → exit 4.
  - `lib/dispatch/first-call-artifact-check.js` (:133): any failure → `claim-read-failed`.
  - `lib/release-claim/release.js` `writeTombstone` (:102): failure becomes the thrown message; `isAlreadyReleasedError` matches only `HTTP 404|409|422`, so `permission-refused` stays `failed` as `network-failure` did.
  - `lib/reconcile/preflight.js` (:37), `lib/reconcile/pr-state.js` (:33), `lib/reconcile/release-merged.js` (:156): map everything but `gh-absent` to one value — unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/claim-store.test.js`, next to the existing classifier tests:

```js
test('AC1.1: classifyGhApiError: a plain HTTP 403 (no rate-limit text) is permission-refused, not network-failure', () => {
  const err = new Error('gh: Resource not accessible by integration (HTTP 403)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'permission-refused', status: 403 });
});

test('AC1.1: classifyGhApiError: an HTTP 401 is permission-refused', () => {
  const err = new Error('gh: Bad credentials (HTTP 401)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'permission-refused', status: 401 });
});

test('AC6.1: classifyGhApiError: a primary rate-limit 403 (API rate limit exceeded, no Retry-After) is transient network-failure, never permission-refused', () => {
  const err = new Error('gh: API rate limit exceeded for user ID 1. (HTTP 403)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'network-failure', status: null });
});

test('classifyGhApiError: X-RateLimit-Remaining: 0 on a 403 is primary exhaustion -> network-failure', () => {
  const err = new Error('gh: HTTP 403');
  err.stderr = 'HTTP 403\nX-RateLimit-Remaining: 0';
  assert.deepEqual(classifyGhApiError(err), { failure: 'network-failure', status: null });
});

test('classifyGhApiError: a bare HTTP 429 stays network-failure', () => {
  assert.deepEqual(classifyGhApiError(new Error('gh: HTTP 429')), { failure: 'network-failure', status: null });
});
```

Rewrite the test at :371 (`a plain 403 with no rate-limit text still falls to network-failure`) — it pins the old behaviour; delete it (the AC1.1 403 test replaces it). The existing `Retry-After` test (:365) and the generic `connection reset by peer` test (:259) stay unchanged and must still pass.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL — the AC1.1 tests get `{ failure: 'network-failure', status: null }` (AC1.2: they fail against the current classifier). The AC6.1/429/X-RateLimit tests already pass (they pin that the new branch does not swallow them).

- [ ] **Step 3: Implement** in `classifyGhApiError`, after the 409 branch and before the final `network-failure` return, in this order: primary exhaustion (`/API rate limit exceeded|X-RateLimit-Remaining:\s*0\b/i`) → `{ failure: 'network-failure', status: null }`; then `/HTTP (401|403)\b/` → `{ failure: 'permission-refused', status: Number(match[1]) }`. Placing both after 409 means only text that today falls through to `network-failure` can change. Extend the header comment with one paragraph: a 401/403 that is neither rate limit is a permission refusal (`_shared/github-rate-limit.md`'s plain-403 row: not transient), primary exhaustion stays `network-failure` (transient), #4756.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: PASS. Then run the consumer suites to confirm no exit behaviour moved: `node --test tests/bin-lib/release-claim/ tests/bin-lib/reconcile/preflight.test.js tests/bin-lib/reconcile/pr-state.test.js tests/bin-lib/claim-targets/` — Expected: PASS except the bootstrap tests Task 3 owns (none should fail yet: their fakes do not go through the classifier).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Split permission-refused out of network-failure in classifyGhApiError — primary rate limit stays transient (refs #4756)"
```

---

### Task 2: `ensureClaimsBranch` reports a transport-class failure as transient

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js:536-591` (`apiRefusal`, `createClaimsBranchContentsApi`, `ensureClaimsBranch` and their comments)
- Test: `tests/bin-lib/issues/claim-store.test.js` (ensureClaimsBranch block, :1135-1235)

**Interfaces:**
- Consumes: Task 1's `permission-refused` outcome (a refusal, not transient).
- Produces: `ensureClaimsBranch(deps, repoSlug) -> { ok: true, created, via } | { ok: false, reason } | { ok: false, reason, transient: true, failure: 'secondary-rate-limit' | 'network-failure' }`. A refusal carries neither `transient` nor `failure` (as today). Return-shape widening: the transient shape gains `failure`; the only `deepEqual` on it is the test at :1226, rewritten below.

- [ ] **Step 1: Write the failing tests** (rewrite three existing tests that pin the old exit-6 shape, add three):

```js
// rewrite of :1178 (spec Deliverable 6)
test('AC7.1: ensureClaimsBranch: POST git/refs 422 with an unreadable branches endpoint is transient network-failure, never a refusal or a guessed lost race', () => {
  const ghApi = bootstrapGhApi([], {
    post: { stdout: null, failure: null, status: 422, error: 'HTTP 422: Reference already exists' },
    branches: { stdout: null, failure: 'network-failure', status: null },
  });
  const r = ensureClaimsBranch({ ghApi }, 'acme/w');
  assert.equal(r.ok, false);
  assert.equal(r.transient, true);
  assert.equal(r.failure, 'network-failure');
  assert.match(r.reason, /Reference already exists/);
});

// rewrite of :1226
test('ensureClaimsBranch: a secondary-rate-limit POST and a network-failure POST are transient with their kind; a permission-refused POST is a refusal', () => {
  const rateLimited = ensureClaimsBranch({ ghApi: bootstrapGhApi([], { post: { stdout: null, failure: 'secondary-rate-limit', status: 403, error: 'HTTP 403: secondary rate limit' } }) }, 'acme/w');
  assert.deepEqual(rateLimited, { ok: false, reason: 'contents-api: HTTP 403: secondary rate limit', transient: true, failure: 'secondary-rate-limit' });
  const blip = ensureClaimsBranch({ ghApi: bootstrapGhApi([], { post: { stdout: null, failure: 'network-failure', status: null, error: 'connection reset by peer' } }) }, 'acme/w');
  assert.deepEqual(blip, { ok: false, reason: 'contents-api: connection reset by peer', transient: true, failure: 'network-failure' });
  const refused = ensureClaimsBranch({ ghApi: bootstrapGhApi([], { post: { stdout: null, failure: 'permission-refused', status: 403, error: 'HTTP 403: Forbidden' } }) }, 'acme/w');
  assert.deepEqual(refused, { ok: false, reason: 'contents-api: HTTP 403: Forbidden' });
});

// rewrite of :1204 (Review Focus 1)
test('ensureClaimsBranch: an unreachable default-branch read is transient, no POST', () => {
  const calls = [];
  const ghApi = (args) => { calls.push(args); return { stdout: null, failure: 'network-failure', status: null, error: 'HTTP 502: Bad Gateway' }; };
  const r = ensureClaimsBranch({ ghApi }, 'acme/w');
  assert.deepEqual([r.ok, r.transient, r.failure], [false, true, 'network-failure']);
  assert.match(r.reason, /HTTP 502/);
  assert.equal(calls.length, 1);
});

// new (Review Focus 2)
test('ensureClaimsBranch: git leg network failure + contents-API permission 403 is a refusal, never transient', () => {
  const gitRunner = (args) => { if (args[0] === 'push') throw gitError('fatal: unable to access the remote'); return args[0] === 'rev-parse' ? 'abc\n' : ''; };
  const ghApi = bootstrapGhApi([], { post: { stdout: null, failure: 'permission-refused', status: 403, error: 'HTTP 403: Resource not accessible by integration' } });
  const r = ensureClaimsBranch({ ghApi, gitRunner }, 'acme/w');
  assert.equal(r.ok, false);
  assert.equal('transient' in r, false);
  assert.match(r.reason, /^git: .*; contents-api: HTTP 403/s);
});

// new: a 401 on the tip read is a refusal
test('ensureClaimsBranch: a permission-refused tip read is a refusal, no POST', () => {
  const calls = [];
  const ghApi = (args) => { calls.push(args); return sameArgs(args, DEFAULT_BRANCH_ARGS) ? { stdout: 'main\n', failure: null, status: null } : { stdout: null, failure: 'permission-refused', status: 401, error: 'HTTP 401: Bad credentials' }; };
  const r = ensureClaimsBranch({ ghApi }, 'acme/w');
  assert.equal(r.ok, false);
  assert.equal('transient' in r, false);
  assert.equal(calls.length, 2);
});
```

Also update the fake in `both legs refused` (:1213) from `failure: 'network-failure'` to `failure: 'permission-refused', status: 403` (a real `defaultGhApi` classifies that text so after Task 1); its assertions stay.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL after Step 1 — AC7.1, the rewritten :1226 (`blip` has no `transient`, `rateLimited` has no `failure`) and the default-branch test (no `transient`).

- [ ] **Step 3: Implement**
  - `apiRefusal(r)`: add `transient: true, failure: r.failure` when `r.failure` is `'secondary-rate-limit'` or `'network-failure'`; otherwise the plain `{ ok: false, reason }`.
  - `createClaimsBranchContentsApi`: after the POST, a `status === 422` whose `claimsBranchExists` is `true` stays the lost-race success; `null` returns `{ ok: false, reason: <apiRefusal(r).reason>, transient: true, failure: 'network-failure' }`; `false` stays `apiRefusal(r)`. Call `claimsBranchExists` once.
  - `ensureClaimsBranch`: on the contents-API leg's failure, spread `{ transient: true, failure: a.failure }` when `a.transient`. Update the three functions' comments (`apiRefusal`'s "the one failure the classifier already knows is transient", `createClaimsBranchContentsApi`'s 422 note, `ensureClaimsBranch`'s return-shape line) to the new contract, #4756.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Report a transport-class claims-branch bootstrap failure as transient in ensureClaimsBranch (refs #4756)"
```

---

### Task 3: `handleBranchMissing` routes a network-failure bootstrap to exit 4

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js:40-56` (USAGE exit 4/6 lines), `:467-497` (`handleBranchMissing` and its comment)
- Modify: `plugin/bin/claim-targets.js:6-15` (header exit list)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js` (bootstrap block :2180-2420)

**Interfaces:**
- Consumes: Task 2's `{ ok: false, transient: true, failure }`.
- Produces: transient entry `{ issue, error: 'claims-branch-bootstrap-network-failure' }` (exit 4) or, under `--keep-going`, skip `{ issue, reason: 'transient', error: 'claims-branch-bootstrap-network-failure' }` (exit 0).

- [ ] **Step 1: Write the failing tests.** Import `classifyGhApiError` from `../../../plugin/bin/lib/issues/claim-store` (or the path the file already uses for claim-store) and build every bootstrap POST fake from the real classifier, so the fakes stay what `defaultGhApi` would return: `const ghFail = (text) => ({ stdout: null, ...classifyGhApiError(new Error(text)), error: text });`.

```js
test('AC2.1: write site, bootstrap POST fails on a transport error (no HTTP status): transient exit 4 claims-branch-bootstrap-network-failure, never exit 6', () => {
  const { ghApi, state } = makeBranchlessGhApi({ postResponse: ghFail('connection reset by peer') });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  const code = run(['--run-id', 'r1', '--targets', '720'], deps);
  assert.equal(code, 4, io.err.join(''));
  assert.equal(JSON.parse(io.out[0]).transient[0].error, 'claims-branch-bootstrap-network-failure');
  assert.ok(!io.err.join('').includes(REFUSAL_PREFIX));
  assert.equal(state.refPosts, 1);
});

test('AC2.1: --keep-going with a transport-error bootstrap skips the target, exit 0', () => {
  const { ghApi } = makeBranchlessGhApi({ postResponse: ghFail('connection reset by peer') });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  const code = run(['--run-id', 'r1', '--targets', '720', '--keep-going'], deps);
  assert.equal(code, 0, io.err.join(''));
  assert.deepEqual(JSON.parse(io.out[0]).skipped, [{ issue: 720, reason: 'transient', error: 'claims-branch-bootstrap-network-failure' }]);
});

test('AC6.1: a primary-rate-limit bootstrap POST exits 4 claims-branch-bootstrap-network-failure, never 6', () => {
  const { ghApi } = makeBranchlessGhApi({ postResponse: ghFail('gh: API rate limit exceeded for user ID 1. (HTTP 403)') });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  assert.equal(run(['--run-id', 'r1', '--targets', '720'], deps), 4, io.err.join(''));
  assert.equal(JSON.parse(io.out[0]).transient[0].error, 'claims-branch-bootstrap-network-failure');
});

test('AC7.1: bootstrap POST 422 whose branch re-read fails exits 4 claims-branch-bootstrap-network-failure', () => {
  // makeBranchlessGhApi's branches endpoint answers 404 while the branch is absent;
  // wrap it so the re-read AFTER the POST fails on the network.
  const inner = makeBranchlessGhApi({ postResponse: ghFail('HTTP 422: Reference already exists') });
  let posted = false;
  const ghApi = (args) => {
    if (args[0] === '--method' && args[2] === `repos/${REPO}/git/refs`) posted = true;
    if (posted && args[0] === `repos/${REPO}/branches/claims-registry`) return ghFail('connection reset by peer');
    return inner.ghApi(args);
  };
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  assert.equal(run(['--run-id', 'r1', '--targets', '720'], deps), 4, io.err.join(''));
  assert.equal(JSON.parse(io.out[0]).transient[0].error, 'claims-branch-bootstrap-network-failure');
});

test('a permission-refused claim read keeps exit 4 (only the error name changed)', () => {
  // a contents-API-only run (no gitRunner) whose claim read answers a plain 403
  const ghApi = () => ghFail('gh: Resource not accessible by integration (HTTP 403)');
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  assert.equal(run(['--run-id', 'r1', '--targets', '720'], deps), 4, io.err.join(''));
  assert.equal(JSON.parse(io.out[0]).transient[0].error, 'permission-refused');
});
```

Change the POST fakes of `(bm4)`, `(bm4c)`, `(bm5)` and `(bm7)` from `{ stdout: null, failure: 'network-failure', status: null, error: ... }` to `ghFail('HTTP 403: Resource not accessible by integration')` (`(bm4c)`: `{ ...ghFail('HTTP 403: denied'), error: hostile }`), so they pin the permission refusal a real 403 now classifies as. Rename `(bm4)` to start `AC3.1:` — it is the "permission 403 still exits 6 and prints the one-line reason" criterion. Prefix `(bm8b)` with `AC4.1:` — it is the unchanged secondary-rate-limit case. `(bm4b)` (ruleset 422, branch re-read 404) stays exit 6 untouched.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL after Step 1 — the AC2.1/AC6.1/AC7.1 tests exit 4 with `claims-branch-bootstrap-rate-limited` (Task 2 already made the result transient; the name is still the rate-limit one).

AC2.2 proof (the new tests exit 6 against the pre-change code) — never `git stash`; use a detached scratch worktree at the plan's base commit `770624963`, each command its own call:
`git worktree add --detach "{scratchpad}/base-4756" 770624963`, then copy the edited test file over `{scratchpad}/base-4756/tests/bin-lib/claim-targets/claim-targets.test.js`, then `node --test --test-name-pattern "AC2.1" "{scratchpad}/base-4756/tests/bin-lib/claim-targets/claim-targets.test.js"` — Expected: FAIL with `6 !== 4` (and the keep-going case `6 !== 0`). Quote that output in the task report, then `git worktree remove --force "{scratchpad}/base-4756"`.

- [ ] **Step 3: Implement** in `handleBranchMissing`: on `!b.ok && b.transient`, error name `b.failure === 'secondary-rate-limit' ? 'claims-branch-bootstrap-rate-limited' : 'claims-branch-bootstrap-network-failure'`. Update its comment block ("A refused bootstrap is run-level…" stays; add that a network failure or rate limit on the create is transient, #4756). USAGE line for exit 4 → `exit 4 = transient gh failure (incl. a claims-registry bootstrap that hit a network failure or a rate limit)`; exit 6 → `exit 6 = the claims-registry branch is missing on origin and creating it was refused (permission, ruleset, or 404) —`. Mirror both into `plugin/bin/claim-targets.js`'s header (`4 = transient gh failure, incl. a bootstrap network failure or rate limit`; `6 = … and creating it was refused`).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/claim-targets/ tests/bin-lib/issues/claim-store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "Route a network-failure claims-branch bootstrap to transient exit 4 in claim-targets (refs #4756)"
```

---

### Task 4: Exit-code prose sweep

**Role:** transcription

**Files:**
- Modify: `plugin/skills/flow/claim-targets.md:322-324` (exit 4 bullet), `:341-342` (exit 6 bullet)
- Modify: `plugin/skills/_shared/issue-claims.md:47` ("a refused creation exits `6`…")
- Modify: `plugin/skills/dispatch/settle-and-merge.md:45-46` (the "Claims branch missing" parenthetical)
- Modify: `docs/plugin-structure.md:216` (claim-targets CLI line, exit 4 and 6), `:29` (`ensureClaimsBranch` description)
- Modify: `docs/journeys/act-on-a-contested-claim.md:63` ("…or a rate-limited creation, is instead a transient retry")

**Interfaces:**
- Consumes: the error name `claims-branch-bootstrap-network-failure` (Task 3).

- [ ] **Step 1: Edit each site** — one clause each, no restructuring:
  - `claim-targets.md` exit 4 bullet: after `` `error: 'claims-branch-bootstrap-rate-limited'` `` add `, or one that hit a network failure (including a 422 whose branch re-read failed), `` `error: 'claims-branch-bootstrap-network-failure'` `` (#4756)` and make "both rendered" → "all three rendered". Exit 6 bullet: "could not be created" → "could not be created because creation was refused (permission 401/403, a ruleset 422, or 404 — a network failure is exit 4)".
  - `issue-claims.md`: "a refused creation exits `6`" → "a refused creation (permission, ruleset, 404) exits `6`; a network failure or rate limit during it is transient (exit `4`, #4756)".
  - `settle-and-merge.md`: "could not be created)" → "creating it was refused; a network failure during creation is exit 4, a transient failure, not this stop)".
  - `plugin-structure.md:216`: "4 transient gh failure" → "4 transient gh failure (incl. a claims-registry bootstrap network failure or rate limit, #4756)"; "6 … could not be created" → "6 … creating it was refused (permission, ruleset, or 404)". `:29`: after "counting as success)" add "; a transport failure or rate limit on the contents-API leg is reported `transient` with its `failure` kind, #4756".
  - Journey `:63`: "or a rate-limited creation" → "or a creation that was rate-limited or hit a network failure".

- [ ] **Step 2: Verify no remaining prose says a network failure during bootstrap exits 6 (AC5.1)**

Run: `git grep -n -i -e "could not be created" -e "refused creation" -e "rate-limited creation" -e "bootstrap rate-limited" -- plugin docs ':!docs/superpowers/plans' ':!CHANGELOG.md'`
Expected: every hit either names a refusal (permission/ruleset/404) or is the unchanged exit-6 stderr literal in `claim-targets.js:493` / the test's `REFUSAL_PREFIX`; none implies a network failure exits 6. Then `git grep -n -e "network-failure" -- plugin/skills` — expected: only `dispatch/close-out.md:48` (pr-state vocabulary, unrelated).

- [ ] **Step 3: Size check**

Run: `wc -c plugin/skills/_shared/issue-claims.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/claim-targets.md`
Expected: each below 52,500. The composed `claims` bundle (built from `issue-claims.md`) measured 48,987 B at plan time; the one added clause keeps it well under the rail — `plan-audit.js` headroom re-checks it.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/flow/claim-targets.md plugin/skills/_shared/issue-claims.md plugin/skills/dispatch/settle-and-merge.md docs/plugin-structure.md docs/journeys/act-on-a-contested-claim.md
git commit -m "Document that a network failure during the claims-branch bootstrap is transient exit 4, not exit 6 (refs #4756)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1, AC1.1, AC1.2, AC6.1 | Task 1 |
| Deliverable 2, 3, 6, AC7.1 (claim-store half) | Task 2 |
| Deliverable 2 (exit 4 + keep-going), AC2.1, AC2.2, AC3.1, AC4.1, AC7.1 (claim-targets half) | Task 3 |
| Deliverable 4, AC5.1 | Task 4 |
| Deliverable 5 | Tasks 1 + 3 (AC6.1) |
