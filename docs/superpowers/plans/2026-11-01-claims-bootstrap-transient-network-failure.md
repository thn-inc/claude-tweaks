# Claims-branch bootstrap: transient network failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A network blip while `claim-targets.js` bootstraps a missing `claims-registry` branch exits 4 (transient, retried later) instead of exit 6 (permanent refusal), because `classifyGhApiError` can now tell a permission refusal apart from a transport failure.

**Architecture:** `classifyGhApiError` gains a `permission-denied` outcome (HTTP 401/403 that is not a rate limit); primary rate limits and every other transport failure stay `network-failure`. The bootstrap (`ensureClaimsBranch`) marks a `network-failure` or `secondary-rate-limit` contents-API result as transient and names which, including the 422-then-branch-re-read case, which needs a new `readClaimsBranch` that returns the re-read's failure kind. `claim-targets`' `handleBranchMissing` maps the kind to an error name and remembers it, so later `--keep-going` targets that find the branch missing are skipped with the same name.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T200106-record-4756/work/4756-spec.md` (record #4756)

Scope keywords: classifyGhApiError, ensureClaimsBranch, claims-branch-bootstrap, claimsBranchExists

## Global Constraints

- New error name for a transport-class bootstrap failure: `claims-branch-bootstrap-network-failure` (exit 4; `--keep-going` skip with `reason: 'transient'`).
- Existing name kept: `claims-branch-bootstrap-rate-limited` (secondary rate limit, exit 4).
- Exit 6 stays for: permission 401/403, a ruleset 422 whose branch re-read shows no branch, a 422 whose re-read fails with `permission-denied` or `gh-absent`, a 404, `gh-absent`, a repository with no default branch, a default branch with no tip sha.
- Primary rate limit (`API rate limit exceeded`, `X-RateLimit-Remaining: 0`, HTTP 429) is never `permission-denied`.
- Every existing caller of `classifyGhApiError`/`defaultGhApi` keeps its exit code for a 401/403 (see Task 1's caller audit); only the failure string some of them print changes from `network-failure` to `permission-denied`. The PR description names this.
- Commit messages: `{Verb} {what} — {detail}` with `refs #4756`, never `closes`/`fixes`.
- Governing skill `gh-api-module-pattern` (verbatim): "`deps.ghApi` — the `plugin/bin/lib/issues/claim-store.js` contract, which *never throws* and returns `{stdout, failure, status}` so a 404/409/422 arrives as data". "Over the contents API, `POST repos/{slug}/git/refs` answers 422 for both "reference already exists" and a ruleset refusal, so the 422 is settled by a branch re-read (`claimsBranchExists` in `plugin/bin/lib/issues/claim-store.js`): present is the lost race, absent is a refusal, and a `null` read (the lookup itself failed) is neither." (Task 4 updates this sentence: the failed re-read is now split by kind.) From its `batching-failure-posture.md`: "Classify a `gh api` rate-limit failure per `plugin/skills/_shared/github-rate-limit.md`'s taxonomy before deciding whether to retry — a plain 403 under that file's rules is not transient and must not be retried."
- `_shared/github-rate-limit.md` (verbatim rows): "Primary exhaustion | HTTP 403 or 429 whose body/headers show `X-RateLimit-Remaining: 0` … | Transient"; "Plain 403 (catchall) | Carries neither the secondary-limit message nor exhaustion evidence … | Not transient — never retry".

## Review Focus

1. A 403 whose text carries both `HTTP 403` and a rate-limit phrase (primary limit, no `Retry-After`) must be `network-failure`, not `permission-denied` — Task 1's primary-rate-limit test pins it.
2. A 422 POST whose branch re-read hits a *secondary* rate limit must exit 4 with the rate-limited name, not the network-failure name — Task 2's `secondary-rate-limit` re-read test plus Task 3's name mapping pin it.
3. A network failure on the default-branch or tip-sha read (before any POST) is transport-class too: transient, no POST — Task 2's rewritten default-branch test pins it.
4. A successful bootstrap followed by a second missing-branch sighting must still say `claims-branch-missing` (not a stale transient name) — existing (bm6)/(bm8)/(bm9) stay green unchanged.
5. A claim *read/write* (not bootstrap) refused with 403 keeps exit 4 — its `error` becomes `permission-denied`; existing (f) and the write-network-failure test stay green, and Task 1's caller audit records the change.

---

### Task 1: Split a permission refusal out of `classifyGhApiError`

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`classifyGhApiError` and its header comment, ~:109-159)
- Modify: `plugin/bin/list-claims.js` (header comment's failure vocabulary, ~:22)
- Test: `tests/bin-lib/issues/claim-store.test.js`

**Interfaces:**
- Produces: `classifyGhApiError(e) -> { failure: null | 'gh-absent' | 'secondary-rate-limit' | 'network-failure' | 'permission-denied', status: number | null }`. `permission-denied` carries `status: 401` or `403` (parsed from the text). `defaultGhApi` passes it through unchanged.

**Classifier order (exact):** ENOENT → `gh-absent`; secondary rate limit (unchanged regex) → `secondary-rate-limit`/403; 404, 422, 409 branches unchanged; then NEW primary rate limit `/API rate limit exceeded|X-RateLimit-Remaining:\s*0\b|HTTP 429/i` → `{failure: 'network-failure', status: null}`; then NEW `/HTTP (401|403)\b/` → `{failure: 'permission-denied', status: Number(match[1])}`; else `network-failure`. Inserting both new branches after 409 leaves every text that classifies as 404/422/409 today unchanged.

**Caller audit (no code change beyond this task's files; also classifies plan-audit Check B's unplanned hits — `docs/donts.md`, `claims-git-cas.js`, the #4495 plan and `release-merged.test.js` only mention the classifier in prose/comments and need no change):** `pr-state.js:33`, `release-merged.js:156`, `preflight.js:37` compare only to `'gh-absent'` → unchanged. `release.js` `writeTombstone` → its thrown message becomes `permission-denied`; `isAlreadyReleasedError` matches only HTTP 404/409/422 → unchanged behavior. `claim-targets.js` read/write failure → still exit 4, `error: 'permission-denied'`. `list-claims.js` → still exit 3, prints the new word. `dispatch-resume.js` → still exit 4. `first-call-artifact-check.js` → still `claim-read-failed`. `writeClaimBlob` PUT 403 → `{ok:false, failure:'permission-denied'}`, still a failure, never a conflict. `claimsBranchExists` → still `null` for any failure.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/claim-store.test.js`
  - Replace `classifyGhApiError: a plain 403 with no rate-limit text still falls to network-failure` with `AC1.1 AC1.2: classifyGhApiError: a plain 403 (no rate-limit text) is permission-denied, status 403` — `classifyGhApiError(new Error('gh: Resource not accessible by integration (HTTP 403)'))` deepEquals `{ failure: 'permission-denied', status: 403 }`.
  - Add `AC1.1: classifyGhApiError: HTTP 401 is permission-denied, status 401` — `new Error('gh: Bad credentials (HTTP 401)')` → `{ failure: 'permission-denied', status: 401 }`.
  - Add `AC6.1: classifyGhApiError: a primary rate limit (403 text, no Retry-After) or a 429 stays network-failure, never permission-denied` — three inputs, each deepEquals `{ failure: 'network-failure', status: null }`: `new Error('gh: API rate limit exceeded for user ID 1. (HTTP 403)')`; an error with message `Command failed` and `stderr` `'HTTP 403\nX-RateLimit-Remaining: 0'`; `new Error('gh: HTTP 429')`.
  - Add `classifyGhApiError: a 5xx stays network-failure` — `new Error('gh: HTTP 502: Bad Gateway')` → `{ failure: 'network-failure', status: null }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="classifyGhApiError" tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL (the 403 and 401 cases return `network-failure`)

- [ ] **Step 3: Implement** the two new branches in `classifyGhApiError` per the order above, and extend its header comment with one paragraph: a permission 401/403 is a refusal, its own `permission-denied` outcome (#4756), checked after the primary-rate-limit test because a primary limit also answers 403. In `plugin/bin/list-claims.js`'s header comment, add `permission-denied` to the failure list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/list-claims.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Classify a permission 401/403 as permission-denied, not network-failure — primary rate limits stay transient (refs #4756)"
```

### Task 2: Make the contents-API bootstrap report transport failures as transient

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`claimsBranchExists`, `apiRefusal`, `createClaimsBranchContentsApi`, `ensureClaimsBranch` and their comments, ~:526-591; `module.exports`)
- Test: `tests/bin-lib/issues/claim-store.test.js`

**Interfaces:**
- Consumes: Task 1's `permission-denied` failure value.
- Produces:
  - `readClaimsBranch(ghApi, repoSlug) -> { exists: true | false | null, failure: string | null, error?: string }` — exported. 404 → `{exists:false, failure:null}`; any `failure` → `{exists:null, failure, error}` (`error` only when the ghApi result had one); else `{exists:true, failure:null}`. `claimsBranchExists(ghApi, repoSlug)` returns `readClaimsBranch(...).exists` (behavior unchanged).
  - `ensureClaimsBranch(deps, repoSlug) -> { ok: true, created, via } | { ok: false, reason, transient?: true, failure?: 'network-failure' | 'secondary-rate-limit' }` — `transient` and `failure` appear together, only for a transport-class contents-API leg.
  - Transport-class set: `'network-failure'`, `'secondary-rate-limit'`. `apiRefusal(r)` adds `transient: true, failure: r.failure` when `r.failure` is in the set; otherwise returns `{ok:false, reason}` as today.
  - `createClaimsBranchContentsApi` 422 path: re-read with `readClaimsBranch`; `exists === true` → `{ok:true, created:false}`; `exists === null` with a transport-class failure → `{ok:false, reason: `${r.error || 'HTTP 422'}; branch re-read: ${b.error || b.failure}`, transient:true, failure: b.failure}`; anything else (`exists === false`, `permission-denied`, `gh-absent`, any other failure) → `apiRefusal(r)` (a refusal: the 422 itself has `failure: null`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/claim-store.test.js`
  - Add `readClaimsBranch: 404 → exists false; a failure → exists null with its kind and error; a name → exists true` — 404 → `{exists:false, failure:null}`; `{stdout:null, failure:'network-failure', status:null, error:'boom'}` → `{exists:null, failure:'network-failure', error:'boom'}`; `{stdout:'claims-registry\n', failure:null, status:null}` (called with `BRANCHES_ARGS`) → `{exists:true, failure:null}`.
  - Replace `ensureClaimsBranch: a secondary-rate-limit POST is transient (reason verbatim); a 403 network-failure POST is not` with `ensureClaimsBranch: a secondary-rate-limit or network-failure POST is transient with its failure named; a permission-denied POST is not` — secondary: deepEqual `{ ok:false, reason:'contents-api: HTTP 403: secondary rate limit', transient:true, failure:'secondary-rate-limit' }`; network (post `{stdout:null, failure:'network-failure', status:null, error:'error connecting to api.github.com'}`): deepEqual `{ ok:false, reason:'contents-api: error connecting to api.github.com', transient:true, failure:'network-failure' }`; refused (post `{stdout:null, failure:'permission-denied', status:403, error:'HTTP 403: Forbidden'}`): deepEqual `{ ok:false, reason:'contents-api: HTTP 403: Forbidden' }`.
  - In `ensureClaimsBranch: both legs refused → ok:false with both reasons verbatim`, change the POST fixture to `{ stdout:null, failure:'permission-denied', status:403, error:'HTTP 403: Resource not accessible by integration' }` (the classifier's output for that text after Task 1); assertions unchanged.
  - Replace `ensureClaimsBranch: an unresolvable default branch is a refusal, no POST` with `ensureClaimsBranch: a network failure reading the default branch is transient, no POST` — same ghApi (every call `network-failure`, error `HTTP 502: Bad Gateway`); assert `ok:false`, `reason` matches `/HTTP 502/`, `transient === true`, `failure === 'network-failure'`, `calls.length === 1`.
  - Add `AC9.1: ensureClaimsBranch: gh-absent, an empty default branch and an empty tip sha stay refusals (no transient key)` — (a) `bootstrapGhApi` with post `{stdout:null, failure:'gh-absent', status:null, error:'spawn gh ENOENT'}`; (b) a ghApi answering `DEFAULT_BRANCH_ARGS` with `{stdout:'\n', failure:null, status:null}`; (c) one answering `DEFAULT_BRANCH_ARGS` with `main\n` and `MAIN_TIP_ARGS` with `\n`. Each: `ok === false`, `'transient' in r === false`.
  - Replace `ensureClaimsBranch: POST git/refs 422 with an unreadable branches endpoint is a refusal, never a guessed lost race` with `AC7.1: ensureClaimsBranch: POST git/refs 422 whose branch re-read fails on transport is transient, never a guessed lost race` — post 422 `Reference already exists`, branches `{stdout:null, failure:'network-failure', status:null, error:'error connecting to api.github.com'}`; assert `ok:false`, `transient === true`, `failure === 'network-failure'`, `reason` matches `/Reference already exists/` and `/error connecting/`.
  - Add `ensureClaimsBranch: POST git/refs 422 whose branch re-read hits a secondary rate limit is transient, failure secondary-rate-limit` — branches `{stdout:null, failure:'secondary-rate-limit', status:403, error:'HTTP 403: secondary rate limit'}`; assert `transient === true`, `failure === 'secondary-rate-limit'`.
  - Add `AC8.1: ensureClaimsBranch: POST git/refs 422 whose branch re-read is refused (permission-denied or gh-absent) is a refusal` — branches `{failure:'permission-denied', status:403, error:'HTTP 403: Forbidden'}` and `{failure:'gh-absent', status:null}`; each: `ok === false`, `'transient' in r === false`, `reason` matches `/Reference already exists/`.
  - Import `readClaimsBranch` alongside `claimsBranchExists`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="readClaimsBranch|ensureClaimsBranch" tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL (`readClaimsBranch` is not exported; the network-failure cases carry no `transient`)

- [ ] **Step 3: Implement** `readClaimsBranch`, the transport-class `apiRefusal`, the 422 re-read branch, and `ensureClaimsBranch` propagating `transient: true, failure: a.failure` (in place of today's bare `transient: true`). Update the `apiRefusal`/`createClaimsBranchContentsApi`/`ensureClaimsBranch` comments: a transport-class contents-API failure (network failure, either rate limit) is transient and named; a refusal (permission, ruleset, 404, gh absent, no default branch, no tip sha) is not (#4756). Export `readClaimsBranch`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Report a transport-class claims-branch bootstrap failure as transient — 422 re-read keeps its failure kind (refs #4756)"
```

### Task 3: Route a transient bootstrap to exit 4 in `claim-targets`, and reuse its name for later targets

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`handleBranchMissing` and its comment, ~:467-497)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Consumes: Task 2's `ensureClaimsBranch` result (`transient: true` with `failure`).
- Produces: transient envelope/skip `error` values `claims-branch-bootstrap-network-failure` (any transient `failure` other than `secondary-rate-limit`) and `claims-branch-bootstrap-rate-limited` (`failure === 'secondary-rate-limit'`). A run-scoped `bootstrapTransientError` (initially `null`) holds the name a transient bootstrap produced; the `bootstrapAttempted` branch uses `bootstrapTransientError || 'claims-branch-missing'`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/claim-targets/claim-targets.test.js` (#4495 section)
  - Change the POST fixture in (bm4), (bm4c), (bm5) and (bm7) from `failure: 'network-failure', status: null` to `failure: 'permission-denied', status: 403` (the classifier's output for those texts after Task 1); assertions unchanged — (bm4) covers AC3.1 (a permission 403 still exits 6 with the one-line reason). Existing (bm8b) stays unchanged and covers AC4.1 (secondary rate limit still exits 4, `claims-branch-bootstrap-rate-limited`).
  - Add helper `withBranchesRead(ghApi, response)` → a ghApi returning `response` for `repos/${REPO}/branches/claims-registry` and delegating everything else.
  - Add `AC2.1 AC2.2: (bm10) write site, bootstrap POST fails with a transport error (no HTTP status): exit 4 claims-branch-bootstrap-network-failure, never exit 6` — `makeBranchlessGhApi({ postResponse: { stdout:null, failure:'network-failure', status:null, error:'error connecting to api.github.com' } })`, no gitRunner, targets `720`; assert code `4`, `transient[0].error === 'claims-branch-bootstrap-network-failure'`, stderr lacks `REFUSAL_PREFIX`, `state.refPosts === 1`.
  - Add `AC2.1: (bm10b) the same transport failure under --keep-going: skipped as transient, exit 0` — assert code `0`, `skipped` deepEquals `[{ issue: 720, reason: 'transient', error: 'claims-branch-bootstrap-network-failure' }]`.
  - Add `AC10.1: (bm11) two targets, --keep-going, first bootstrap fails on transport: both skipped with claims-branch-bootstrap-network-failure, never claims-branch-missing` — `makeBranchlessGitRunner(remote, { refuseBootstrapWith: 'fatal: unable to access https://github.com/acme/w.git/: Could not resolve host: github.com' })` plus the (bm10) network-failure ghApi; targets `720,721`; assert code `0`, `claimed` `[]`, `skipped` deepEquals both issues with `reason: 'transient', error: 'claims-branch-bootstrap-network-failure'`, `bootstrapPushes(remote).length === 1`, `state.refPosts === 1`.
  - Add `AC7.1: (bm12) POST git/refs 422 whose branch re-read fails on transport: exit 4 claims-branch-bootstrap-network-failure` — git runner with `refuseBootstrapWith: '! [remote rejected] HEAD -> claims-registry (push declined due to repository rule violations)'`; ghApi `withBranchesRead(makeBranchlessGhApi({ postResponse: { stdout:null, failure:null, status:422, error:'HTTP 422: Reference already exists' } }).ghApi, { stdout:null, failure:'network-failure', status:null, error:'error connecting to api.github.com' })`; assert code `4`, `transient[0].error === 'claims-branch-bootstrap-network-failure'`.
  - Add `AC8.1: (bm12b) POST git/refs 422 whose branch re-read is refused with a permission 403: exit 6` — same, re-read `{ stdout:null, failure:'permission-denied', status:403, error:'HTTP 403: Resource not accessible by integration' }`; assert code `6`, `branchMissing.reason` matches `/Reference already exists/`.
  - Add `AC9.1: (bm13) gh-absent, no default branch and no tip sha during the bootstrap still exit 6` — three runs (no gitRunner, target `720`), each over `makeBranchlessGhApi()` wrapped to answer: (a) the POST with `{stdout:null, failure:'gh-absent', status:null, error:'spawn gh ENOENT'}`; (b) `repos/${REPO}` `.default_branch` with `{stdout:'\n', failure:null, status:null}`; (c) `repos/${REPO}/git/ref/heads/main` with `{stdout:'\n', failure:null, status:null}`; each: code `6`, stderr includes `REFUSAL_PREFIX`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="bm10|bm11|bm12" tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL ((bm10)/(bm11)/(bm12) exit 6; (bm10b) exits 6 instead of skipping)

- [ ] **Step 3: Implement** in `handleBranchMissing`: on `!b.ok && b.transient`, set `bootstrapTransientError` from `b.failure` per the mapping above and `stopOrSkip(issue, 'transient', 'transient', 4, { error: bootstrapTransientError })`; in the `bootstrapAttempted` branch use `bootstrapTransientError || 'claims-branch-missing'`. Update the comment block above it: a transport-class bootstrap failure (network or rate limit) is transient and later sightings reuse its name; only a refusal exits 6.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/issues/claim-store.test.js`
Expected: PASS (all tests, including unchanged (bm6), (bm8), (bm8b), (bm9))

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "Exit 4 on a transport-class claims-branch bootstrap failure — later --keep-going targets reuse its error name (refs #4756)"
```

### Task 4: State in every exit-code description that a bootstrap network failure is transient

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`USAGE` exit 4 and exit 6 lines, :52-56)
- Modify: `plugin/bin/claim-targets.js` (header exit list, :6-15)
- Modify: `plugin/skills/flow/claim-targets.md` (exit 4 bullet :322-324, exit 6 bullet :341-343)
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (Claim-contest special case parenthetical, :45-46)
- Modify: `plugin/skills/_shared/issue-claims.md` (Missing branch paragraph, :44-47)
- Modify: `docs/plugin-structure.md` (claim-targets CLI line, :216)
- Modify: `docs/journeys/act-on-a-contested-claim.md` (step 3d "Should understand", :63)
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (the "Creating a ref race-safely" bullet, :44 — its "a `null` read … is neither" clause)

**Interfaces:**
- Consumes: Task 3's error names `claims-branch-bootstrap-network-failure`, `claims-branch-bootstrap-rate-limited`.

- [ ] **Step 1: Write the check** (scratch only, not committed): every file above, after the edit, names a network failure during the bootstrap as transient/exit 4, and the four exit-4 surfaces (`USAGE`, `bin/claim-targets.js`, `flow/claim-targets.md`, `docs/plugin-structure.md`) mention a bootstrap network failure next to exit 4.

- [ ] **Step 2: Run the check to verify it fails**

Run: `node -e "const t=require('fs').readFileSync('plugin/skills/flow/claim-targets.md','utf8');process.exit(t.includes('claims-branch-bootstrap-network-failure')?0:1)"`
Expected: FAIL (exit 1 — the name is not documented yet)

- [ ] **Step 3: Edit the prose**
  - `USAGE`: exit 4 → `transient gh failure (incl. a claims-registry bootstrap that hit a network failure or a rate limit)`; exit 6 → keep the line, adding that it is a refusal (permission, ruleset, 404, gh absent), never a network failure.
  - `bin/claim-targets.js` header: after the exit-6 clause add that a network failure or rate limit during the bootstrap is transient (exit 4).
  - `flow/claim-targets.md` exit 4: name `error: 'claims-branch-bootstrap-network-failure'` beside the rate-limited name ("a bootstrap that hit a network failure … or a secondary rate limit …", all on the same transient-failure card); exit 6: "could not be created — refused (permission, ruleset); a network failure during the creation is exit 4, not this stop".
  - `settle-and-merge.md`: in the "Claims branch missing" parenthetical, add "— refused; a network failure during the bootstrap is a transient exit 4, not this stop". Keep the phrases `Claims branch missing`, `flow-step-2.8-claims-branch-missing`, `claims-branch-missing stop, skip steps 3-7`, `dispatch-retry-ceiling`, `no failure comment` (pinned by `tests/flow-claim-preflight.test.js`).
  - `issue-claims.md`: "a refused creation exits `6` …; a network failure or rate limit during the creation is transient (exit `4`)".
  - `docs/plugin-structure.md`: exit 4 → "transient gh failure (including a network failure or rate limit while creating the claims-registry branch)"; exit 6 → "…could not be created — a refusal, never a network failure".
  - Journey step 3d: "or a creation that hit a rate limit or a network failure, is instead a transient retry".
  - `gh-api-module-pattern` SKILL.md: replace "and a `null` read (the lookup itself failed) is neither" with "and a failed re-read is split by kind (`readClaimsBranch`, #4756): a transport failure or rate limit is transient, a permission refusal or `gh` absent is a refusal".

- [ ] **Step 4: Run the checks to verify they pass**

Run: `node -e "const t=require('fs').readFileSync('plugin/skills/flow/claim-targets.md','utf8');process.exit(t.includes('claims-branch-bootstrap-network-failure')?0:1)"`
Expected: PASS (exit 0)

Run: `node --test tests/flow-claim-preflight.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS

Run: `grep -rn -i "network" plugin/skills/flow/claim-targets.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/_shared/issue-claims.md docs/plugin-structure.md`
Expected: every bootstrap-related hit says transient / exit 4; none says a network failure exits 6 (AC5.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js plugin/skills/flow/claim-targets.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/_shared/issue-claims.md docs/plugin-structure.md docs/journeys/act-on-a-contested-claim.md .claude/skills/gh-api-module-pattern/SKILL.md
git commit -m "Document that a claims-branch bootstrap network failure is transient exit 4 — exit 6 is refusals only (refs #4756)"
```
