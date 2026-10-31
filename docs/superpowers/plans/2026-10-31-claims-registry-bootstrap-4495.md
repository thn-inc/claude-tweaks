# claims-registry Branch Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repository whose remote has no `claims-registry` branch gets the branch created on its first claim (then the claim proceeds), or a dedicated exit 6 naming the missing branch when creation is refused — never a false "contested, holder null" exit 3.

**Architecture:** Detect "branch missing" as its own outcome on both claim transports (git: the fetch error `couldn't find remote ref`; contents API: a rejected create-only PUT whose re-read is absent and whose `GET repos/{slug}/branches/claims-registry` is 404). One shared helper, `claimStore.ensureClaimsBranch`, bootstraps the branch from the default branch tip — git leg first (`push --force-with-lease=refs/heads/claims-registry:` = create-only), contents-API leg (`POST repos/{slug}/git/refs`) on git failure — and treats "already exists" as a lost race, i.e. success. `claim-targets` calls it once per run and re-processes the same target; `release-claim` never bootstraps and reports "nothing to release".

**Tech Stack:** Node 18+ CommonJS, `node --test`, injectable `runner`/`ghApi` seams (gh-api-module-pattern skill). No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T133106-record-4495/work/4495-spec.md` (re-run of attempt `2026-10-31T093835-record-4495`, whose plan review stopped needs-human on Settle's handling of exit 6; the record's `## Decisions` now picks Reading A, carried out by Task 6)

## Global Constraints

- Branch name is the existing constant `CLAIMS_BRANCH` from `plugin/bin/lib/issues/claims.js` (`claims-registry`) — never a new literal in code.
- The bootstrap base is the default branch's tip — never an orphan commit (spec Technical Approach).
- New exit code is `6` — exits 0, 2, 3, 4, 5 are taken (`plugin/bin/lib/claim-targets/claim-targets.js` USAGE).
- Exit-6 stderr message, exactly: `claim-targets: claims-registry branch missing on origin and could not be created: {reason} — create it from the default branch`.
- A bootstrap refusal reason is surfaced verbatim, never retried (spec Gotchas).
- Every `execFileSync` call keeps `windowsHide: true`; tests never touch real `git`/`gh` — fake runners only.
- Commit messages: `{Verb} {what} — {detail} (refs #4495)`, never "closes"/"fixes".

## Review Focus

1. A git fetch failure that is NOT a missing ref (network, auth) must stay `transport-failure` and fall back to the contents API — never trigger a bootstrap. Pinned in Task 1.
2. A normal first claim of an issue on an EXISTING `claims-registry` (file absent, branch present) must never bootstrap: a rejected PUT whose `branches/claims-registry` read succeeds stays `conflict: true`. Pinned in Task 2.
3. `release-claim.js` against a branchless remote must perform no write at all — no push, no `git/refs` POST, no PUT. Pinned in Task 4.
4. The created branch's base is the default branch tip fetched in the same call — the push argument's sha equals the fetched `HEAD` sha. Pinned in Task 1.
5. A branch still missing after a successful bootstrap (replication lag) must not loop: one bootstrap per run, then transient exit 4. Pinned in Task 3.
6. Exit 6 is a Settle pre-flight stop (record `## Decisions`, Reading A): no attempt counted against `dispatch-retry-ceiling`, no failure comment, its own failing-check name `flow-step-2.8-claims-branch-missing` for the headless self-report. Carried by Task 6.

---

### Task 1: git transport — classify a missing branch and bootstrap it

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claims-git-cas.js` (`classifyGitError` :72-84, `readClaimBlobGit` :120-146, new `bootstrapClaimsBranchGit`, `module.exports`)
- Test: `tests/bin-lib/issues/claims-git-cas.test.js`

**Interfaces:**
- Produces: `classifyGitError(err)` may now return `{ kind: 'missing-branch' }`.
- Produces: `readClaimBlobGit(...)` on a missing remote branch returns `{ content: null, tipSha: null, absent: true, branchMissing: true, failure: null }`.
- Produces: `bootstrapClaimsBranchGit({ remote = 'origin', branch = CLAIMS_BRANCH, runner = defaultRunner }) -> { ok: true, created: true } | { ok: true, created: false } | { ok: false, failure: 'transport-failure', reason: string }`.

- [ ] **Step 1: Write the failing tests** (covers AC5.1 for `claims-git-cas.js`; append to `tests/bin-lib/issues/claims-git-cas.test.js`; import `bootstrapClaimsBranchGit` alongside the existing imports)

```js
test('classifyGitError: a missing remote ref is missing-branch, not transport-failure', () => {
  const err = new Error('Command failed: git fetch');
  err.stderr = "fatal: couldn't find remote ref claims-registry";
  assert.deepEqual(classifyGitError(err), { kind: 'missing-branch' });
});

test('readClaimBlobGit: a fetch failing with "couldn\'t find remote ref" reports branchMissing, absent, no failure', () => {
  const runner = (args) => {
    if (args[0] === 'fetch') { const e = new Error('git fetch failed'); e.stderr = "fatal: couldn't find remote ref claims-registry"; throw e; }
    return '';
  };
  assert.deepEqual(readClaimBlobGit({ issueNumber: 42, runner }), {
    content: null, tipSha: null, absent: true, branchMissing: true, failure: null,
  });
});

test('readClaimBlobGit: a non-missing-ref fetch failure is still transport-failure (no branchMissing key)', () => {
  const runner = (args) => { if (args[0] === 'fetch') throw new Error('fatal: unable to access: Could not resolve host'); return ''; };
  const r = readClaimBlobGit({ issueNumber: 42, runner });
  assert.equal(r.failure, 'transport-failure');
  assert.equal('branchMissing' in r, false);
});

test('bootstrapClaimsBranchGit: creates the branch from the fetched default-branch tip with a create-only lease', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return 'abc123\n';
    return '';
  };
  assert.deepEqual(bootstrapClaimsBranchGit({ runner }), { ok: true, created: true });
  const fetch = calls.find((a) => a[0] === 'fetch');
  assert.match(fetch[fetch.length - 1], /^HEAD:refs\//);
  const push = calls.find((a) => a[0] === 'push');
  assert.deepEqual(push, ['push', 'origin', 'abc123:refs/heads/claims-registry', '--force-with-lease=refs/heads/claims-registry:']);
});

test('bootstrapClaimsBranchGit: a rejected create whose ls-remote shows the branch is a lost race — ok, created:false', () => {
  const runner = (args) => {
    if (args[0] === 'rev-parse') return 'abc123\n';
    if (args[0] === 'push') { const e = new Error('push failed'); e.stderr = '! [rejected] abc123 -> claims-registry (stale info)'; throw e; }
    if (args[0] === 'ls-remote') return 'def456\trefs/heads/claims-registry\n';
    return '';
  };
  assert.deepEqual(bootstrapClaimsBranchGit({ runner }), { ok: true, created: false });
});

test('bootstrapClaimsBranchGit: a refused push (permission) is transport-failure carrying the git text verbatim', () => {
  const runner = (args) => {
    if (args[0] === 'rev-parse') return 'abc123\n';
    if (args[0] === 'push') { const e = new Error('push failed'); e.stderr = 'remote: Permission to acme/w.git denied to bot.'; throw e; }
    return '';
  };
  const r = bootstrapClaimsBranchGit({ runner });
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'transport-failure');
  assert.match(r.reason, /Permission to acme\/w\.git denied/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/claims-git-cas.test.js`
Expected: FAIL (`bootstrapClaimsBranchGit is not a function`; `missing-branch` assertion fails)

- [ ] **Step 3: Implement in `plugin/bin/lib/issues/claims-git-cas.js`**

- `classifyGitError`: add `if (/couldn't find remote ref/i.test(text)) return { kind: 'missing-branch' };` after the secondary-rate-limit check, before `missing-path` (same detection regex `bin/lib/health-core/durable-state.js:237` uses for `health-state`).
- `readClaimBlobGit`'s fetch `catch`: when `classifyGitError(err).kind === 'missing-branch'` return `{ content: null, tipSha: null, absent: true, branchMissing: true, failure: null }`; every other error keeps today's `transport-failure` return unchanged.
- `bootstrapClaimsBranchGit`: `fetch -q {remote} HEAD:{scratchRef}` (scratch ref `refs/claims-cas-bootstrap/{pid}-{Date.now()}-{random}`, deleted in a `finally` like `readClaimBlobGit`'s), `rev-parse {scratchRef}` for the base sha, then `push {remote} {sha}:refs/heads/{branch} --force-with-lease=refs/heads/{branch}:` (empty expect = the ref must not exist). On a push error classified `contested`, run `ls-remote --heads {remote} refs/heads/{branch}`: non-empty → `{ ok: true, created: false }`; empty → `{ ok: false, failure: 'transport-failure', reason: errText(err) }`. Any other error from any step → `{ ok: false, failure: 'transport-failure', reason: errText(err) }`. Export it. Extend the header comment's failure-vocabulary list with `missing-branch`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/claims-git-cas.test.js`
Expected: PASS (all tests, existing ones included)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claims-git-cas.js tests/bin-lib/issues/claims-git-cas.test.js
git commit -m "Classify a missing claims-registry branch on the git transport — add create-only bootstrap (refs #4495)"
```

### Task 2: claim store — contents-API detection and the shared bootstrap helper

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`defaultGhApi` :149-160, `readClaimBlob` :241-252, `writeClaimBlob` :482-491, new `claimsBranchExists`, new `ensureClaimsBranch`, `module.exports`)
- Test: `tests/bin-lib/issues/claim-store.test.js`

**Interfaces:**
- Consumes: Task 1's `readClaimBlobGit` `branchMissing` field and `bootstrapClaimsBranchGit`.
- Produces: `defaultGhApi(args)` failure returns gain `error: string` (the thrown error's message + stderr text); success returns are unchanged.
- Produces: `readClaimBlob(...)` passes through `branchMissing: true` (with `absent: true`, `failure: null`, `sha: null`, `via: 'git'`) when the git read reported it.
- Produces: `writeClaimBlob(...)` may return `{ ok: false, branchMissing: true, failure: null }`.
- Produces: `claimsBranchExists(ghApi, repoSlug) -> true | false | null` (`null` = could not tell).
- Produces: `ensureClaimsBranch(deps: {ghApi, gitRunner?}, repoSlug) -> { ok: true, created: boolean, via: 'git' | 'contents-api' } | { ok: false, reason: string }`.

- [ ] **Step 1: Write the failing tests** (covers AC5.1 for `claim-store.js`; append to `tests/bin-lib/issues/claim-store.test.js`, adding `ensureClaimsBranch` to its existing destructured `require`; fake `ghApi` per the file's existing convention — never throws, returns `{stdout, failure, status}`)

```js
test('readClaimBlob: a git read reporting branchMissing passes it through as absent, no contents-API call', () => {
  const ghCalls = [];
  const gitRunner = (args) => { if (args[0] === 'fetch') { const e = new Error('x'); e.stderr = "fatal: couldn't find remote ref claims-registry"; throw e; } return ''; };
  const r = readClaimBlob({ ghApi: (a) => { ghCalls.push(a); return { stdout: null, failure: null, status: 404 }; }, gitRunner }, 'acme/w', 7);
  assert.equal(r.absent, true);
  assert.equal(r.branchMissing, true);
  assert.equal(r.failure, null);
  assert.equal(ghCalls.length, 0);
});

test('writeClaimBlob: create-only PUT 404 + absent re-read + branches 404 → branchMissing, not conflict', () => {
  const ghApi = (args) => {
    if (args[0] === '--method') return { stdout: null, failure: null, status: 404 };
    if (String(args[0]).startsWith('repos/acme/w/branches/claims-registry')) return { stdout: null, failure: null, status: 404 };
    return { stdout: null, failure: null, status: 404 }; // contents re-read: absent
  };
  const w = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', sha: null, createOnly: true, message: 'm' });
  assert.deepEqual(w, { ok: false, branchMissing: true, failure: null });
});

test('writeClaimBlob: create-only PUT 422 + absent re-read on an EXISTING branch stays a conflict (no bootstrap signal)', () => {
  const ghApi = (args) => {
    if (args[0] === '--method') return { stdout: null, failure: null, status: 422 };
    if (String(args[0]).startsWith('repos/acme/w/branches/claims-registry')) return { stdout: 'claims-registry\n', failure: null, status: null };
    return { stdout: null, failure: null, status: 404 };
  };
  const w = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', sha: null, createOnly: true, message: 'm' });
  assert.deepEqual(w, { ok: false, conflict: true, failure: null });
});

test('ensureClaimsBranch: git leg succeeds → ok via git, no gh call', () => { /* gitRunner: rev-parse → 'abc\n', others '' ; ghApi records calls; assert {ok:true, created:true, via:'git'} and zero ghApi calls */ });

test('ensureClaimsBranch: git leg fails → contents-API leg reads default_branch, its tip sha, POSTs git/refs → ok via contents-api', () => {
  /* ghApi: ['repos/acme/w','-q','.default_branch'] → 'main\n';
     ['repos/acme/w/git/ref/heads/main','-q','.object.sha'] → 'abc123\n';
     POST args deepEqual ['--method','POST','repos/acme/w/git/refs','-f','ref=refs/heads/claims-registry','-f','sha=abc123'] → {stdout:'{}',failure:null,status:null}
     assert result deepEqual {ok:true, created:true, via:'contents-api'} */
});

test('ensureClaimsBranch: POST git/refs 422 whose branches/claims-registry read now succeeds is a lost race → ok, created:false', () => { /* POST → {stdout:null, failure:null, status:422, error:'HTTP 422: Reference already exists'}; ['repos/acme/w/branches/claims-registry','-q','.name'] → {stdout:'claims-registry\n', failure:null, status:null}; assert {ok:true, created:false, via:'contents-api'} */ });

test('ensureClaimsBranch: POST git/refs 422 from a ruleset while the branch is still absent is a refusal, reason verbatim', () => { /* POST → {stdout:null, failure:null, status:422, error:'HTTP 422: Repository rule violations found\n\nCannot create ref due to creations being restricted.'}; branches GET → {stdout:null, failure:null, status:404}; assert r.ok === false; assert.match(r.reason, /Repository rule violations found/); assert.match(r.reason, /Cannot create ref/) */ });

test('ensureClaimsBranch: POST git/refs 404 (no access) is a refusal, never success', () => { /* POST → {stdout:null, failure:null, status:404, error:'gh: Not Found (HTTP 404)'}; assert r.ok === false; assert.match(r.reason, /HTTP 404/) */ });

test('writeClaimBlob: create-only PUT rejected + absent re-read + branches read fails (cannot tell) → network-failure, never conflict', () => {
  /* PUT → status 404; contents re-read → status 404 (absent); ['repos/acme/w/branches/claims-registry','-q','.name'] → {stdout:null, failure:'network-failure', status:null};
     assert deepEqual {ok:false, failure:'network-failure'} — the transient path (claim-targets exit 4), not the false-contest exit 3 this record removes */
});

test('ensureClaimsBranch: both legs refused → ok:false with both reasons verbatim', () => {
  /* git push stderr 'remote: Permission to acme/w.git denied'; POST → {failure:'network-failure', status:null, error:'HTTP 403: Resource not accessible by integration'}
     assert r.ok === false; assert.match(r.reason, /Permission to acme\/w\.git denied/); assert.match(r.reason, /HTTP 403: Resource not accessible/) */
});
```

(The `/* … */` bodies are fully specified by their comments: the fake's argv-keyed responses and the exact assertion.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL (`ensureClaimsBranch is not a function`; the branchMissing write assertion fails)

- [ ] **Step 3: Implement in `plugin/bin/lib/issues/claim-store.js`**

- `defaultGhApi` catch: also return `error` = the joined message/stderr/stdout text (same join `classifyGhApiError` builds).
- `readClaimBlob`: when `gitResult.branchMissing`, add `branchMissing: true` to the returned object.
- `claimsBranchExists`: `ghApi([`repos/${repoSlug}/branches/${CLAIMS_BRANCH}`, '-q', '.name'])` — `status === 404` → `false`; any `failure` → `null`; otherwise `true`.
- `writeClaimBlob`'s 422/409/404 block: after the existing self-write check, when the fresh re-read succeeded and is `absent`, consult `claimsBranchExists(deps.ghApi, repoSlug)`: `false` → return `{ ok: false, branchMissing: true, failure: null }`; `null` (could not tell) → return `{ ok: false, failure: 'network-failure' }` (transient, never the false contest this record removes); `true` → keep the existing `conflict: true` return. Any other re-read outcome keeps today's behavior unchanged.
- `ensureClaimsBranch`: git leg via `bootstrapClaimsBranchGit({ runner: deps.gitRunner })` when `deps.gitRunner` is set; its `ok` → `{ ok: true, created, via: 'git' }`. Otherwise the contents-API leg — the three `ghApi` calls in the Step 1 test (default branch name trimmed, tip sha trimmed, then the POST). POST success is `failure === null && status === null` only → `created: true`. POST `status === 422` → `claimsBranchExists(deps.ghApi, repoSlug) === true` → `created: false` (a lost race, the same settle-by-re-read the git leg's `ls-remote` does); anything else on a 422 (`false` or `null`) is a refusal — a ruleset blocking ref creation also answers 422. Every other POST result (404 included) is a refusal. A refusal returns `{ ok: false, reason }`, where `reason` joins the legs that ran as `git: {gitReason}; contents-api: {apiReason}` and `apiReason` is `r.error || r.failure || `HTTP ${r.status}`` — the response text verbatim, which is why `defaultGhApi`'s catch keeps `error` on every thrown result, 4xx statuses included. Export `claimsBranchExists` and `ensureClaimsBranch`. Header comment: one sentence naming the bootstrap.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/claims-single-write-path.test.js tests/bin-lib/issues/claims-git-cas.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Detect a missing claims-registry branch on the contents API — add the shared ensureClaimsBranch bootstrap (refs #4495)"
```

### Task 3: claim-targets — bootstrap once, retry, exit 6 on refusal

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (USAGE :39-50, the target loop :439-627)
- Modify: `plugin/bin/claim-targets.js` (header exit list :5-11)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Consumes: `read.branchMissing` / `write.branchMissing` (Task 2), `claimStore.ensureClaimsBranch(deps, repoSlug)` (Task 2), `CLAIMS_BRANCH` from `../issues/claims`.
- Produces: exit `6` with stdout `{ branchMissing: { branch: 'claims-registry', reason }, released, releaseFailed }` — with or without `--keep-going` (the failure is run-level: every target would hit it).

- [ ] **Step 1: Write the failing tests** (covers AC1.1, AC2.1, AC2.2, AC3.1, AC3.2, AC4.1, AC5.1; append to `tests/bin-lib/claim-targets/claim-targets.test.js`; build the fakes on the file's existing `readPath`/`isRead`/`isWrite` helpers and fake `gh`)

- [AC1.1] `(bm1) branchless remote, git transport: bootstraps claims-registry from the default-branch tip, retries the target, exit 0, claim recorded` — stateful fake `gitRunner` with a `branchExists` flag: `fetch … claims-registry:…` throws `couldn't find remote ref` while false; the bootstrap push sets it true; afterwards fetch/rev-parse return a tip, `show` throws `does not exist in` until the claim push stores the blob, then returns it. Assert exit `0`, stdout `claimed` deep-equals `[N]`, `transportByIssue[N] === 'git'`, exactly one push whose refspec ends `:refs/heads/claims-registry` with `--force-with-lease=refs/heads/claims-registry:`.
- [AC1.1] `(bm2) branchless remote, contents-API transport (no gitRunner): PUT 404 + branches 404 → POST git/refs, retry, exit 0` — stateful fake `ghApi`: contents GET 404 until the claim PUT lands; PUT returns 404 while the branch is absent; `branches/claims-registry` 404 while absent; the `git/refs` POST flips it. Assert exit `0`, `claimed` `[N]`, exactly one `git/refs` POST.
- [AC2.1, AC2.2] `(bm3) two first claims (different records) against one branchless remote: both exit 0, exactly one branch creation wins, neither contested` — one shared fake remote (branch flag + blob map); run A (`--targets 11`) bootstraps; run B (`--targets 12`) starts from a stale view (its first fetch still fails `couldn't find remote ref`) and its bootstrap push is rejected `(stale info)` with `ls-remote` showing the branch. Assert both exit `0`, the remote's created-count is `1`, neither stdout contains `contested`.
- [AC3.1, AC3.2] `(bm4) bootstrap refused on both legs: exit 6, stderr names the missing branch and the remedy, stdout branchMissing.reason is verbatim, never exit 3` — git push stderr `remote: Permission to acme/w.git denied to bot.`, POST `{ failure: 'network-failure', status: null, error: 'HTTP 403: Resource not accessible by integration' }`. Assert exit `6`; stderr includes `claim-targets: claims-registry branch missing on origin and could not be created:` and ends with `— create it from the default branch\n`; `JSON.parse(stdout).branchMissing.branch === 'claims-registry'`; `branchMissing.reason` matches both refusal texts.
- [AC3.1] `(bm4b) ruleset refusal: git push rejected "[remote rejected] … (push declined due to repository rule violations)", POST git/refs answers 422 "Repository rule violations found … Cannot create ref", branch still absent: exit 6, never a lost-race success and never exit 4` — assert exit `6` and `branchMissing.reason` matches `/Repository rule violations found/`.
- `(bm5) --keep-going with a refused bootstrap still exits 6` — same fakes, `--keep-going`; assert exit `6`.
- `(bm6) branch still missing after a successful bootstrap: one bootstrap only, transient exit 4` — bootstrap reports success but the fetch keeps failing `couldn't find remote ref`; assert exit `4`, `transient[0].error === 'claims-branch-missing'`, exactly one bootstrap push.
- [AC4.1] The existing `(d)` test (live holder → exit 3, holder named) stays green unchanged — it is this record's "genuine contest" acceptance case.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL ((bm1)/(bm2)/(bm3) exit 3 contested; (bm4)/(bm5) not exit 6)

- [ ] **Step 3: Implement in `plugin/bin/lib/claim-targets/claim-targets.js`**

Switch the target loop to an index loop so a target can be re-processed. Add `let bootstrapAttempted = false;` beside `knownTip`, and handle `read.branchMissing` (right after the `read.failure` check) and `write.branchMissing` (before the `!write.ok` contested branch) identically:
- `bootstrapAttempted` already true → `stopOrSkip(issue, 'transient', 'transient', 4, { error: 'claims-branch-missing' })`.
- Otherwise set it, call `claimStore.ensureClaimsBranch(deps, repoSlug)`; `!ok` → write the Global Constraints stderr line with `b.reason`, then `return abort({ branchMissing: { branch: CLAIMS_BRANCH, reason: b.reason } }, 6)` (bypasses `stopOrSkip`, so `--keep-going` exits 6 too); `ok` → `knownTip = null`, step the index back one, `continue`.
USAGE gains: `exit 6 = the claims-registry branch is missing on origin and could not be created — {branchMissing:{branch,reason}, released, releaseFailed}; with or without --keep-going`. Mirror that line into `plugin/bin/claim-targets.js`'s header exit list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/claim-targets/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "Bootstrap a missing claims-registry branch in claim-targets — dedicated exit 6 when creation is refused (refs #4495)"
```

### Task 4: release-claim — a branchless remote is nothing to release

**Files:**
- Modify: `plugin/bin/lib/release-claim/release.js` (`readClaimBlob` :43-64, `releaseClaim`'s not-held branch :245-250)
- Test: `tests/bin-lib/release-claim/release.test.js`
- Test: `tests/bin-lib/release-claim/cli.test.js`

Waived plugin/bin/release-claim.js: no code change — the CLI already prints the library's `note` and maps `already-released` to exit 3; Task 4's CLI test verifies it end to end.

**Interfaces:**
- Consumes: `claimStore.readClaimBlob`'s `branchMissing` passthrough (Task 2).
- Produces: `release.readClaimBlob` returns `{ content: null, sha: null, absent: true, branchMissing: true }` on a branchless remote; `releaseClaim` returns `outcome: 'already-released'` with `note: 'nothing to release — the claims-registry branch does not exist on origin'` (CLI exit 3, unchanged meaning "already released").

- [ ] **Step 1: Write the failing tests** (covers AC5.2; append to `tests/bin-lib/release-claim/release.test.js`, plus one CLI test appended to `tests/bin-lib/release-claim/cli.test.js` using that file's existing injected-deps fixture: `run(['7', '--run', {tmp run dir}, '--reason', 'done', '--repo', 'acme/w'], deps)` with the branchless `gitRunner` below and a recording `runner` → exit `3`, parsed stdout `note` matches `/nothing to release/`, `error` is `null`)

```js
test('releaseClaim against a branchless remote: nothing to release, no write of any kind', () => {
  const ghCalls = [];
  const gitCalls = [];
  const gitRunner = (args) => { gitCalls.push(args); if (args[0] === 'fetch') { const e = new Error('x'); e.stderr = "fatal: couldn't find remote ref claims-registry"; throw e; } return ''; };
  const runner = (args) => { ghCalls.push(args); return ''; };
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 7, runId: 'run-a', reason: 'done', runner, gitRunner, now: 0 });
  assert.equal(r.outcome, 'already-released');
  assert.match(r.note, /nothing to release/);
  assert.equal(r.error, undefined);
  assert.equal(gitCalls.some((a) => a[0] === 'push'), false);
  assert.equal(ghCalls.some((a) => a.includes('PUT') || a.includes('POST')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/release-claim/release.test.js`
Expected: FAIL (`r.note` is null)

- [ ] **Step 3: Implement** — `readClaimBlob` adds `branchMissing: true` to its absent return when `result.branchMissing`; `releaseClaim`'s not-held `else` branch sets `result.note` to the Interfaces text when `blob.branchMissing`. `release-claim.js` itself needs no change (its JSON already carries `note`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/release-claim/release.test.js tests/bin-lib/release-claim/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/release-claim/release.js tests/bin-lib/release-claim/release.test.js tests/bin-lib/release-claim/cli.test.js
git commit -m "Report nothing to release on a branchless claims remote (refs #4495)"
```

### Task 5: Document the bootstrap and exit 6

**Files:**
- Modify: `plugin/skills/_shared/issue-claims.md` (The lock section; release exit table line ~223) — 47,323 bytes against the 52,500-byte rail: add at most ~900 bytes
- Modify: `plugin/skills/flow/claim-targets.md` ("Branch on exit code" list ~:232-321, "On exit 3, 4, or 5" :323, `--keep-going` paragraph :391)
- Modify: `plugin/skills/flow/SKILL.md` (Step 2.8 exit sentence :145) — 50,366 bytes against the rail: add under ~60 bytes

- [ ] **Step 1: Edit `issue-claims.md`** — one paragraph after the paragraph ending "…git-CAS requires a git push credential the MCP-only case doesn't have.": **Missing branch (#4495).** A remote with no `claims-registry` branch is its own outcome on both transports — git: the fetch fails `couldn't find remote ref`; contents API: a rejected create-only PUT whose re-read is absent and whose `GET repos/{owner}/{repo}/branches/claims-registry` is 404 — never contested, never a generic transport failure. `claim-targets.js` bootstraps it once per run from the default branch tip (`claim-store.js`'s `ensureClaimsBranch`: a create-only git push, else `POST repos/{owner}/{repo}/git/refs`; "already exists" is a lost race and counts as success), then retries; a refused creation exits `6` naming the branch and the reason verbatim. The MCP transport does the same with the MCP create-branch tool before its first write. `release-claim.js` never creates it: a branchless remote is exit `3` with note "nothing to release". Also append "; a branchless remote is `3` with a nothing-to-release note" to the release exit-code sentence (~:223).
- [ ] **Step 2: Edit `flow/claim-targets.md`** — add a `- **6** (#4495)` bullet after the `**5**` bullet: the `claims-registry` branch was missing and could not be created; stdout `{branchMissing: {branch, reason}, released, releaseFailed}`, stderr carries the remedy; render a `## Flow: Claims branch missing` card quoting `reason` with "Next: create `claims-registry` on origin from the default branch, then re-run." — no `AskUserQuestion`. Change "On exit 3, 4, or 5" to "On exit 3, 4, 5, or 6"; in the `--keep-going` paragraph add after "never exits 3, 4, or 5": "(it still exits 6 — a missing, uncreatable claims branch fails every target alike)".
- [ ] **Step 3: Edit `flow/SKILL.md` Step 2.8** — "Exit 3/4/5 (contested or in-flight / transient / unverified)" → "Exit 3/4/5/6 (contested or in-flight / transient / unverified / claims branch uncreatable)".
- [ ] **Step 4: Run the prose and size suites**

Run: `node --test tests/skill-size-single-source.test.js tests/flow-claim-preflight.test.js tests/claim-mcp-projection-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/issue-claims-pr-scan-composition.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/issue-claims.md plugin/skills/flow/claim-targets.md plugin/skills/flow/SKILL.md
git commit -m "Document the claims-registry bootstrap and claim-targets exit 6 (refs #4495)"
```

### Task 6: Settle — exit 6 is a pre-flight stop (record Decisions, Reading A)

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (the `**Claim-contest special case (before the numbered steps below).**` paragraph, ~:37-58) — 47,575 bytes against the 52,500-byte rail: add at most ~500 bytes
- Modify: `plugin/skills/dispatch/firing-exclusion.md` (its first terminal-shape bullet, :7-8 — the mirror surface naming the stops the Claim-contest special case covers; per the spec's Plan Review Clarifications, exit 6 is excluded per record for the rest of the firing exactly like a contest)
- Test: `tests/flow-claim-preflight.test.js`

**Interfaces:**
- Consumes: Task 5's `## Flow: Claims branch missing` stop card in `flow/claim-targets.md` (the stop shape Settle names).
- Produces: failing-check name `flow-step-2.8-claims-branch-missing` for `_shared/headless-self-report.md`'s dedup (distinct from `flow-step-2.8-claim-contest` / `flow-step-2.8-claim-in-flight`).

- [ ] **Step 1: Write the failing test** (append to `tests/flow-claim-preflight.test.js`, next to the existing `settle-and-merge.md Claim-contest special case also covers the Claim in-flight stop` test, reusing its section slice)

```js
test('settle-and-merge.md Claim-contest special case covers the exit-6 Claims branch missing stop as a pre-flight stop (#4495)', () => {
  const content = read('plugin/skills/dispatch/settle-and-merge.md');
  const sectionStart = content.indexOf('**Claim-contest special case');
  assert.ok(sectionStart !== -1, 'Claim-contest special case section should exist');
  const sectionEnd = content.indexOf('\n1. The CLI in step 2', sectionStart);
  assert.ok(sectionEnd !== -1, 'special-case section should end before the numbered steps');
  const section = content.slice(sectionStart, sectionEnd);
  assert.match(section, /Claims branch missing/);
  assert.match(section, /flow-step-2\.8-claims-branch-missing/);
  assert.match(section, /dispatch-retry-ceiling/);
  assert.match(section, /no failure comment/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-claim-preflight.test.js`
Expected: FAIL (`Claims branch missing` not found in the section)

- [ ] **Step 3: Edit the paragraph** — in its opening sentence, after the "Claim in-flight" stop's parenthetical, add: `, or its "Claims branch missing" stop (\`claim-targets.js\` exit 6, #4495: the \`claims-registry\` branch is missing on origin and could not be created)`. In the failing-check-name sentence, add `, or \`flow-step-2.8-claims-branch-missing\` for the claims-branch-missing stop` and change "the two are different stop shapes" to "the three are different stop shapes". After the sentence ending "…it is a pre-flight stop, not a build/test failure.", add: `For the claims-branch-missing stop, skip steps 3-7 below: no \`failure-check\` classification, no attempt counted against \`dispatch-retry-ceiling\`, and no failure comment — a repository whose claims branch cannot be created would otherwise exhaust the ceiling on a record that was never at fault.` (Scoped to exit 6 only — the contested and in-flight stops keep today's wording unchanged.) In `firing-exclusion.md`'s first bullet, change "A claim-contest/in-flight pre-flight stop" to "A claim-contest/in-flight/claims-branch-missing pre-flight stop" — no other change there; its rule already excludes that record for the rest of the firing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-claim-preflight.test.js tests/dispatch-firing-exclusion.test.js tests/worktree-headless-ahead-of-origin.test.js tests/skill-size-single-source.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/settle-and-merge.md plugin/skills/dispatch/firing-exclusion.md tests/flow-claim-preflight.test.js
git commit -m "Treat claim-targets exit 6 as a Settle pre-flight stop — no retry attempt, no failure comment (refs #4495)"
```
