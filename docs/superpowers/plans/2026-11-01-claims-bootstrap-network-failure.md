# Claims-branch bootstrap: transient network failure exits 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A network blip while `claim-targets.js` bootstraps the missing `claims-registry` branch exits 4 (transient) instead of 6 (refusal), by splitting a permission outcome out of `classifyGhApiError` and classifying every bootstrap failure by one rule.

**Architecture:** `classifyGhApiError` (`plugin/bin/lib/issues/claim-store.js`) gains a `permission-denied` outcome for HTTP 401/403 that is neither a secondary nor a primary rate limit. The bootstrap's contents-API leg marks a result `transient` exactly when its failure is `network-failure` or `secondary-rate-limit`, and carries that failure kind out of `ensureClaimsBranch`; the 422 re-read keeps its own failure kind. `handleBranchMissing` (`plugin/bin/lib/claim-targets/claim-targets.js`) maps the kind to an error name, and remembers it so later `--keep-going` targets report the same name.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T202425-record-4756/work/4756-spec.md` (record #4756)

Scope keywords: classifyGhApiError, ensureClaimsBranch, claims-branch-bootstrap, claimsBranchExists

## Global Constraints

- New classifier outcome name: `permission-denied`, returned as `{ failure: 'permission-denied', status: 401 }` or `{ failure: 'permission-denied', status: 403 }`.
- Transient bootstrap failures: exactly `network-failure` and `secondary-rate-limit`. Everything else is a refusal (exit 6).
- Error names: a `secondary-rate-limit` reports `claims-branch-bootstrap-rate-limited`; a `network-failure` reports `claims-branch-bootstrap-network-failure`, primary rate limit included.
- A primary rate-limit 403 or 429 (`API rate limit exceeded`, or `X-RateLimit-Remaining: 0`) is `network-failure`, never `permission-denied` (`plugin/skills/_shared/github-rate-limit.md` treats it as transient).
- Treating an unrecognised 4xx as transient is accepted; add no patterns for other statuses.
- Every existing caller of `classifyGhApiError` / `defaultGhApi` keeps its exit behaviour for a 401/403 (audit below); the only deliberate exit change is the bootstrap path.
- Governing project skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/SKILL.md`), quoted verbatim: "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently." and (its `batching-failure-posture.md`) "Classify a `gh api` rate-limit failure per `plugin/skills/_shared/github-rate-limit.md`'s taxonomy before deciding whether to retry — a plain 403 under that file's rules is not transient and must not be retried."
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #4756` (never `closes`/`fixes`), end with the line `Claude-Session: https://claude.ai/code/session_016yg3zqdPwxEVZPAhLXNVtm`.
- Run tests from the worktree root: `node --test tests/bin-lib/issues/claim-store.test.js` and `node --test tests/bin-lib/claim-targets/claim-targets.test.js`. The full suite runs centrally, not per task.

### Caller audit (Deliverable 1)

`git grep -n -e classifyGhApiError -e defaultGhApi -- plugin/bin` (run at plan time) lists every consumer. For an HTTP 401/403 each one's exit is unchanged; only the failure text changes from `network-failure` to `permission-denied`:

| Caller | 401/403 behaviour after the split |
|---|---|
| `reconcile/preflight.js` `buildFailure` | ternary on `gh-absent` → still `github-unreachable` |
| `reconcile/pr-state.js:33`, `reconcile/release-merged.js:156` | ternary on `gh-absent` → still `network-failure` |
| `release-claim/release.js` `writeTombstone` | `writeClaimBlob` returns `{ok:false, failure:'permission-denied'}` → same throw, message text names the new failure |
| `claim-targets.js` claim read / claim write | still `stopOrSkip(... 4 ...)`, envelope `error: 'permission-denied'` instead of `'network-failure'` |
| `list-claims.js` | still exit 3, stderr `list-claims.js: permission-denied` |
| `dispatch-resume.js:503` | still `Exit(4, 'claim read: permission-denied')` |
| `dispatch/first-call-artifact-check.js:133` | still `claim-read-failed`, reason text names the new failure |
| `claimsBranchExists` | any failure → `null`, unchanged |

No caller compares a claim-store failure to the literal `'network-failure'` (`git grep -n "=== 'network-failure'" -- plugin/bin` hits only PR-state strings from `pr-state.js`, a different producer). The PR description names this envelope/stderr text change.

## Review Focus

1. A 403 claim **read or write** (not the bootstrap) — a reasonable person expects the pre-existing exit 4, now with `error: 'permission-denied'`; pinned in Task 3 (`perm-read`).
2. A primary rate-limit body that also carries `HTTP 403` — must never read as `permission-denied`; pinned in Task 1 with a discriminating fixture.
3. The secondary-rate-limit text `API rate limit exceeded ... Retry-After: 60` keeps classifying as `secondary-rate-limit` (secondary checked first); the existing test at `claim-store.test.js` "Retry-After signature also reads as secondary rate limit" keeps it.
4. A 422 whose re-read itself fails — the reason must keep the POST's verbatim text so a human can still read why; pinned in Task 2.
5. `--keep-going` after a transient bootstrap failure — no later target may report `claims-branch-missing`; pinned in Task 3 (`bm16`).

---

### Task 1: Split a permission outcome out of `classifyGhApiError`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`classifyGhApiError` and its header comment, lines ~109-159; the failure-vocabulary comment at line ~179)
- Modify: `plugin/bin/list-claims.js` (header comment line ~22 naming the failure values)
- Modify: `docs/plugin-structure.md` (the `list-claims.js` row, line ~221: its exit-3 list `` `gh-absent`/`network-failure`/`secondary-rate-limit`/`truncated` `` gains `` `permission-denied` ``)
- Test: `tests/bin-lib/issues/claim-store.test.js`

**Interfaces:**
- Produces: `classifyGhApiError(e) -> { failure: null|'gh-absent'|'secondary-rate-limit'|'network-failure'|'permission-denied', status: null|401|403|404|409|422 }`. Tasks 2-3 rely on the literal `'permission-denied'`.

- [ ] **Step 1: Write the failing tests** — replace the existing test `classifyGhApiError: a plain 403 with no rate-limit text still falls to network-failure` and add the rest beside it:

```js
test('AC1.1: classifyGhApiError: a plain HTTP 403 (no rate-limit text) -> permission-denied, never network-failure', () => {
  const err = new Error('gh: Resource not accessible by integration (HTTP 403)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'permission-denied', status: 403 });
});

test('AC1.1: classifyGhApiError: HTTP 401 -> permission-denied', () => {
  const err = new Error('gh: Bad credentials (HTTP 401)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'permission-denied', status: 401 });
});

test('AC6.1: classifyGhApiError: a primary rate-limit 403 ("API rate limit exceeded", no Retry-After) is network-failure, never permission-denied', () => {
  const err = new Error('gh: API rate limit exceeded for installation ID 4242. (HTTP 403)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'network-failure', status: null });
});

test('AC6.1: classifyGhApiError: a 403/429 carrying X-RateLimit-Remaining: 0 is network-failure', () => {
  const e403 = new Error('gh: HTTP 403'); e403.stderr = 'HTTP 403\nX-RateLimit-Remaining: 0';
  const e429 = new Error('gh: HTTP 429'); e429.stderr = 'HTTP 429\nX-RateLimit-Remaining: 0';
  assert.deepEqual(classifyGhApiError(e403), { failure: 'network-failure', status: null });
  assert.deepEqual(classifyGhApiError(e429), { failure: 'network-failure', status: null });
});

test('classifyGhApiError: a transport error with no HTTP status stays network-failure', () => {
  assert.deepEqual(classifyGhApiError(new Error('connect ETIMEDOUT 140.82.112.6:443')), { failure: 'network-failure', status: null });
});
```

The primary-rate-limit test is the guard-discriminating input: deleting the primary-rate-limit check makes `API rate limit exceeded ... (HTTP 403)` fall to the permission branch, turning it red.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL after Step 1 — the two `AC1.1` tests report `network-failure` (actual) vs `permission-denied` (expected); this red run is AC1.2 (it fails against the current classifier). (The `AC6.1` and transport tests pass already; they guard the new branch's ordering.)

- [ ] **Step 3: Implement in `classifyGhApiError`** — keep ENOENT and the secondary-rate-limit check first and the 404/422/409 checks unchanged, then add, in this order, before the final `network-failure` return: (a) primary rate limit — text matching `/API rate limit exceeded|X-RateLimit-Remaining:\s*0\b/i` returns `{ failure: 'network-failure', status: null }`; (b) permission — text matching `/HTTP (401|403)\b/` returns `{ failure: 'permission-denied', status: <401|403 as a number> }`. Extend the function's header comment with one paragraph naming the new outcome, why it is distinct (a refusal, not transport — #4756), and the primary-rate-limit exclusion with its `_shared/github-rate-limit.md` citation. Update the failure-vocabulary comment at `listClaimEntries` (line ~179), `list-claims.js`'s header list, and `docs/plugin-structure.md`'s `list-claims.js` row to include `permission-denied`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: PASS except the tests Task 2 rewrites — at this point `ensureClaimsBranch: both legs refused` and `ensureClaimsBranch: a secondary-rate-limit POST is transient ...` still pass (their fixtures bypass the classifier). If anything else fails, stop and report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/list-claims.js docs/plugin-structure.md tests/bin-lib/issues/claim-store.test.js
git commit -m "Split permission-denied out of classifyGhApiError — 401/403 no longer reads as network-failure, refs #4756" -m "Claude-Session: https://claude.ai/code/session_016yg3zqdPwxEVZPAhLXNVtm"
```

### Task 2: One transient-vs-refusal rule for the bootstrap's contents-API leg

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`claimsBranchExists` ~529, `apiRefusal` ~540, `createClaimsBranchContentsApi` ~552, `ensureClaimsBranch` ~580 and their comments)
- Test: `tests/bin-lib/issues/claim-store.test.js`
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js` (fixture fix only — `(bm4)`, `(bm4c)`, `(bm5)`, `(bm7)`; see Step 1's last bullet)

**Interfaces:**
- Consumes: Task 1's `'permission-denied'`.
- Produces: `ensureClaimsBranch(deps, repoSlug) -> { ok: true, created, via } | { ok: false, reason } | { ok: false, reason, transient: true, failure: 'network-failure'|'secondary-rate-limit' }`. A refusal carries neither `transient` nor `failure` keys. `claimsBranchExists(ghApi, repoSlug) -> true|false|null` unchanged.

- [ ] **Step 1: Write the failing tests** (in the `ensureClaimsBranch` block, reusing `bootstrapGhApi`, `BRANCHES_ARGS` etc.; import `classifyGhApiError` is already in scope):

  - **Rewrite** `ensureClaimsBranch: POST git/refs 422 with an unreadable branches endpoint is a refusal, never a guessed lost race` as `AC7.1: POST git/refs 422 + a network-failure branch re-read is transient, POST reason kept`: post `{stdout:null, failure:null, status:422, error:'HTTP 422: Reference already exists'}`, branches `{stdout:null, failure:'network-failure', status:null, error:'connect ETIMEDOUT'}` → `r.ok === false`, `r.transient === true`, `r.failure === 'network-failure'`, `r.reason` matches `/Reference already exists/` and `/ETIMEDOUT/`.
  - **New** `AC8.1: POST git/refs 422 + a permission-403 branch re-read is a refusal`: branches `{stdout:null, failure:'permission-denied', status:403, error:'HTTP 403: Resource not accessible by integration'}` → `r.ok === false`, `'transient' in r === false`, `'failure' in r === false`.
  - **New** `AC11.1: POST git/refs 422 + a primary-rate-limit branch re-read is transient network-failure`: build the branches answer through the real classifier, `const e = new Error('gh: API rate limit exceeded for user ID 1. (HTTP 403)'); branches = { stdout: null, ...classifyGhApiError(e), error: e.message }` → `r.transient === true`, `r.failure === 'network-failure'`.
  - **New** `ensureClaimsBranch: POST git/refs 422 + a secondary-rate-limit re-read is transient secondary-rate-limit` (Deliverable 6) → `r.failure === 'secondary-rate-limit'`.
  - **New** `ensureClaimsBranch: POST git/refs 422 + a gh-absent re-read is a refusal` → no `transient` key.
  - **New** `ensureClaimsBranch: POST git/refs 422 + a re-read answering 409 with failure null is a refusal, never a lost race` — branches `{stdout:null, failure:null, status:409, error:'HTTP 409: Conflict'}` → `r.ok === false`, no `transient` key, `r.reason` matches `/Reference already exists/`. (Against today's `claimsBranchExists`-based check this returns `{ok:true, created:false}`, so it is red before Step 3.)
  - **Rewrite** `ensureClaimsBranch: a secondary-rate-limit POST is transient (reason verbatim); a 403 network-failure POST is not` as `AC2.1/AC4.1: POST classified secondary-rate-limit / network-failure is transient with its kind; permission-denied is a refusal`:

```js
const run = (post) => ensureClaimsBranch({ ghApi: bootstrapGhApi([], { post }) }, 'acme/w');
assert.deepEqual(run({ stdout: null, failure: 'secondary-rate-limit', status: 403, error: 'HTTP 403: secondary rate limit' }),
  { ok: false, reason: 'contents-api: HTTP 403: secondary rate limit', transient: true, failure: 'secondary-rate-limit' });
assert.deepEqual(run({ stdout: null, failure: 'network-failure', status: null, error: 'connect ETIMEDOUT' }),
  { ok: false, reason: 'contents-api: connect ETIMEDOUT', transient: true, failure: 'network-failure' });
assert.deepEqual(run({ stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403: Forbidden' }),
  { ok: false, reason: 'contents-api: HTTP 403: Forbidden' });
```
  - **Fixture fix** in `ensureClaimsBranch: both legs refused → ok:false with both reasons verbatim`: post becomes `{ stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403: Resource not accessible by integration' }` (it modelled a permission refusal with the old `network-failure` label); its assertions stay.
  - **Extend** `ensureClaimsBranch: an unresolvable default branch is a refusal, no POST` (HTTP 502, `network-failure` on the default-branch read): rename to `... a network-failure default-branch read is transient, no POST` and add `assert.equal(r.transient, true); assert.equal(r.failure, 'network-failure');` (Deliverable 3: the rule covers the default-branch read).
  - **New** `ensureClaimsBranch: a network-failure tip-sha read is transient, no POST` — default branch answers `main`, `MAIN_TIP_ARGS` answers `{failure:'network-failure', status:null, error:'HTTP 503'}` → transient, `calls` has no `POST_REFS_ARGS`. Write it with an inline fake that throws `unexpected` on anything else.
  - **Extend** `claimsBranchExists: 404 → false, any failure → null, a name → true` with `permission-denied` → `null`.
  - **Fixture fix in `tests/bin-lib/claim-targets/claim-targets.test.js`** (keeps that suite green once this task makes `network-failure` transient): `(bm4)`, `(bm4c)`, `(bm5)`, `(bm7)` each model a permission refusal with the pre-split label — change each `postResponse.failure` from `'network-failure'` to `'permission-denied'` and its `status` from `null` to `403`. Prefix `(bm4)`'s title with `AC3.1:` (it is AC3's test: exit 6, one-line `REFUSAL_PREFIX`/`REFUSED_SUFFIX` stderr, reason verbatim — assertions unchanged).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL after Step 1 — `AC7.1` (no `transient`), `AC11.1`, the secondary re-read test, the rewritten `AC2.1/AC4.1` (missing `failure` key / network-failure not transient), the tip-sha and default-branch transient assertions.

- [ ] **Step 3: Implement**
  - `apiRefusal(r)`: unchanged `reason`; add `transient: true, failure: r.failure` exactly when `r.failure` is `'network-failure'` or `'secondary-rate-limit'` (one module-level `Set`, named for the rule). Rewrite its comment to state the one rule (Deliverable 3).
  - Split the branch read so its failure kind survives: a private `readClaimsBranch(ghApi, repoSlug) -> { exists: true|false|null, result }` (`result` is the raw ghApi answer), with `claimsBranchExists` returning `readClaimsBranch(...).exists` (behaviour unchanged).
  - `createClaimsBranchContentsApi`, POST answered 422: re-read with `readClaimsBranch`, then branch on the raw `result` (not on `exists`, whose rule counts any non-404, failure-free answer as `true`): `result.failure === null && result.status === null` → `{ ok: true, created: false }` (the branch exists: lost race, as today). `result.status === 404` → `apiRefusal(r)` (ruleset refusal, as today). `result.failure` set → the re-read's own class: `{ ...apiRefusal(result), reason: \`${apiRefusal(r).reason}; branch re-read: ${apiRefusal(result).reason}\` }`. Any other status with `failure: null` (a 409 or 422 on the GET) → a refusal, `apiRefusal(r)` with the same combined reason (Deliverable 3: a status answer with `failure: null` is a refusal). Every other POST outcome is `apiRefusal(r)` as today (so 409, 404, permission-denied, gh-absent refuse; network-failure and secondary are transient by the rule).
  - `ensureClaimsBranch`: on a failed contents-API leg return `{ ok: false, reason, ...(a.transient ? { transient: true, failure: a.failure } : {}) }`. Update its header comment (it currently says transient means "hit a secondary rate limit").

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "Classify claims-branch bootstrap failures by one rule — network-failure is transient, the 422 re-read keeps its kind, refs #4756" -m "Claude-Session: https://claude.ai/code/session_016yg3zqdPwxEVZPAhLXNVtm"
```

### Task 3: Route a transport-class bootstrap failure to exit 4 in `claim-targets`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`handleBranchMissing` ~467-497 and its comment)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js` (bootstrap block ~2203-2445: `makeBranchlessGhApi` and the `bm*` tests)

**Interfaces:**
- Consumes: Task 2's `ensureClaimsBranch` result shape (`transient`, `failure`).
- Produces: stdout envelope errors `'claims-branch-bootstrap-network-failure'` / `'claims-branch-bootstrap-rate-limited'`.

- [ ] **Step 1: Extend the test fake and write the failing tests**

  Extend `makeBranchlessGhApi({ postResponse, branchesAfterPost = null, defaultBranchResponse = null, tipResponse = null })`: `branchesAfterPost`, once `state.refPosts > 0`, answers the `branches/claims-registry` read (before the POST that read still answers 404 while the branch is absent); `defaultBranchResponse` / `tipResponse` override the `.default_branch` and `git/ref/heads/main` answers. Update the comment above it.

  (`(bm4)`, `(bm4c)`, `(bm5)`, `(bm7)`'s fixtures were already moved to `permission-denied` by Task 2.)

  New tests (contents-API only, no `gitRunner`, `{ gh } = makeGh({})`, `baseDeps({ ghApi, gh })`, same as `(bm7)`):

  - `(bm10) AC2.1: bootstrap POST fails with a transport error (no HTTP status): exit 4 claims-branch-bootstrap-network-failure, never the exit-6 refusal` — `postResponse: { stdout: null, failure: 'network-failure', status: null, error: 'connect ETIMEDOUT 140.82.112.6:443' }`, targets `720` → `code === 4`, `JSON.parse(io.out[0]).transient[0].error === 'claims-branch-bootstrap-network-failure'`, stderr does not include `REFUSAL_PREFIX`, `state.refPosts === 1`.
  - `(bm10b) AC2.1: the same transport failure under --keep-going skips the target` — `--keep-going` → `code === 0`, `body.claimed` `[]`, `body.skipped` deep-equals `[{ issue: 720, reason: 'transient', error: 'claims-branch-bootstrap-network-failure' }]`.
  - `(bm11) AC7.1: POST 422 + a network-failure re-read: exit 4 claims-branch-bootstrap-network-failure` — `postResponse: { stdout: null, failure: null, status: 422, error: 'HTTP 422: Reference already exists' }`, `branchesAfterPost: { stdout: null, failure: 'network-failure', status: null, error: 'connect ECONNRESET' }` → exit 4, that error name.
  - `(bm12) AC8.1: POST 422 + a permission-403 re-read: exit 6` — `branchesAfterPost: { stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403: Resource not accessible by integration' }` → exit 6, `body.branchMissing.reason` matches `/Reference already exists/`.
  - `(bm13) AC11.1: POST 422 + a primary-rate-limit re-read: exit 4 claims-branch-bootstrap-network-failure` — `branchesAfterPost` built through the real classifier: `const e = new Error('gh: API rate limit exceeded for installation ID 4242. (HTTP 403)'); ({ stdout: null, ...classifyGhApiError(e), error: e.message })` (require `classifyGhApiError` from `plugin/bin/lib/issues/claim-store` at the top of this block).
  - `(bm14) AC9.1: gh-absent, no-default-branch and no-tip-sha bootstraps still exit 6` — three runs: `defaultBranchResponse: { stdout: null, failure: 'gh-absent', status: null, error: 'spawn gh ENOENT' }`; `defaultBranchResponse: { stdout: '\n', failure: null, status: null }`; `tipResponse: { stdout: '\n', failure: null, status: null }` → each `code === 6`, stderr includes `REFUSAL_PREFIX`, `state.refPosts === 0`.
  - `(bm15) AC12.1: bootstrap POST answers 409: exit 6` — `postResponse: { stdout: null, failure: null, status: 409, error: 'HTTP 409: Git Repository is empty.' }` → exit 6, reason matches `/Git Repository is empty/`.
  - `(bm16) AC10.1: two targets under --keep-going, first bootstrap fails with a transport error: both skipped as claims-branch-bootstrap-network-failure, never claims-branch-missing` — postResponse as `(bm10)`, targets `720,721`, `--keep-going` → `code === 0`, `body.skipped` deep-equals `[{ issue: 720, reason: 'transient', error: 'claims-branch-bootstrap-network-failure' }, { issue: 721, reason: 'transient', error: 'claims-branch-bootstrap-network-failure' }]`, `state.refPosts === 1`.
  - `(perm-read) a permission-403 claim read keeps its pre-split exit 4, now naming permission-denied` (Review Focus 1, Deliverable 1) — a ghApi whose claim-blob read (`contents/claims/issue-720.json?ref=`) answers `{ stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403' }` and throws `unexpected` otherwise → `code === 4`, `transient[0].error === 'permission-denied'`.
  - `(bm8b)` (secondary rate limit, AC4.1) and `(bm6)`/`(bm8)` (`claims-branch-missing` after a bootstrap that reported success) stay unchanged — they guard the existing names; prefix `(bm8b)`'s title with `AC4.1:`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL after Step 1 — `(bm10)`, `(bm10b)`, `(bm11)`, `(bm13)` exit 6 / wrong name against the current `handleBranchMissing` (`(bm10)` exiting 6 here is AC2.2: it exits 6 against the current code); `(bm16)` reports `claims-branch-missing` (or exit 6) for 721. `(perm-read)`, `(bm12)`, `(bm14)`, `(bm15)` may already pass (they pin unchanged behaviour).

- [ ] **Step 3: Implement in `handleBranchMissing`** — on `!b.ok && b.transient`, the error name is `b.failure === 'secondary-rate-limit' ? 'claims-branch-bootstrap-rate-limited' : 'claims-branch-bootstrap-network-failure'`; record it in a run-scoped `let bootstrapTransientError = null` beside `bootstrapAttempted`, then `stopOrSkip(issue, 'transient', 'transient', 4, { error })`. On the `bootstrapAttempted` branch use `bootstrapTransientError || 'claims-branch-missing'`. Refusals (`!b.ok`, no `transient`) keep the exit-6 path unchanged. Rewrite the comments above `handleBranchMissing` and inside it to state the rule (transient = network-failure or secondary rate limit; a later sighting after a transient failure reports that same name).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "Route a transport-class claims-branch bootstrap failure to exit 4 — claims-branch-bootstrap-network-failure, sticky under --keep-going, refs #4756" -m "Claude-Session: https://claude.ai/code/session_016yg3zqdPwxEVZPAhLXNVtm"
```

### Task 4: Exit-code prose — a bootstrap network failure is exit 4

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`USAGE`, lines ~52 and ~55-56)
- Modify: `plugin/bin/claim-targets.js` (header comment, lines ~10-14)
- Modify: `plugin/skills/flow/claim-targets.md` (exit 4 bullet ~322-324; exit 6 bullet ~341-343) — 37,894 B, headroom ~14.6 KB to the 52,500 B rail
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (~45-46) — 47,046 B, headroom ~5.4 KB
- Modify: `plugin/skills/_shared/issue-claims.md` (~46, "a refused creation exits `6`") — 49,449 B, headroom ~3.0 KB; net growth must stay under ~200 B
- Modify: `docs/plugin-structure.md` (~216, the `claim-targets.js` row's exit list)
- Modify: `docs/journeys/act-on-a-contested-claim.md` (~63, "or a rate-limited creation")

Each edit is one clause; wording to land (adapt grammar to the sentence, keep every other word):

- `USAGE` exit 4: `'  exit 4 = transient gh failure (incl. a claims-registry bootstrap that hit a network failure or a rate limit)\n'`; exit 6: `'  exit 6 = the claims-registry branch is missing on origin and creating it was refused (permission, ruleset, gh absent) —\n'` (the following `{branchMissing:...}` line unchanged).
- `bin/claim-targets.js` header: `4 = transient gh failure (a claims-registry bootstrap network failure or rate limit included)`; `6 = the claims-registry branch is missing on origin and creating it was refused`.
- `flow/claim-targets.md` exit 4 bullet: `... or a bootstrap that hit a secondary rate limit, \`error: 'claims-branch-bootstrap-rate-limited'\`, or a network failure (a primary rate limit included), \`error: 'claims-branch-bootstrap-network-failure'\` — all rendered on the same transient-failure card.`; exit 6 bullet: `the \`claims-registry\` branch was missing on origin and creating it was refused (a permission error, a ruleset, \`gh\` absent — a network failure is exit 4 instead)`. Leave the `## Flow: Claims branch missing` card text unchanged.
- `settle-and-merge.md`: `(\`claim-targets.js\` exit 6, #4495: the \`claims-registry\` branch is missing on origin and creating it was refused — a network failure during the bootstrap is exit 4, never this stop)`. Keep the phrases `Claims branch missing`, `flow-step-2.8-claims-branch-missing`, `claims-branch-missing stop, skip steps 3-7`, `dispatch-retry-ceiling`, `no failure comment` intact (pinned by `tests/flow-claim-preflight.test.js`).
- `issue-claims.md`: `a refused creation exits \`6\` naming the branch and the reason verbatim; a network failure or rate limit during it is transient (exit \`4\`).`
- `plugin-structure.md` `claim-targets.js` row: replace `4 transient gh failure,` with `4 transient gh failure (incl. a claims-registry bootstrap network failure or rate limit, #4756),` and `6 the claims-registry branch is missing on origin and could not be created (` with `6 the claims-registry branch is missing on origin and creating it was refused (`; the rest of the row is unchanged.
- Journey `act-on-a-contested-claim.md` line ~63: replace `or a rate-limited creation, is instead a transient retry` with `or a creation that hit a network failure or a rate limit, is instead a transient retry`.

- [ ] **Step 1: Write the failing check** (scratch, not committed):

Run: `git grep -n -i -e "could not be created" -e "rate-limited by GitHub" -- plugin docs/plugin-structure.md docs/journeys/act-on-a-contested-claim.md`
Expected now: hits in the lib `USAGE`, `bin/claim-targets.js`, `flow/claim-targets.md` (twice), `settle-and-merge.md`, `plugin-structure.md` — the old wording that implies any bootstrap failure is exit 6. (The `claim-targets.js:493` stderr line `branch missing on origin and could not be created` is the runtime refusal message, pinned by `REFUSAL_PREFIX` — it stays: it only prints on a refusal.)

- [ ] **Step 2: Make the edits above.**

- [ ] **Step 3: Verify**

Run: `git grep -n -i -e "could not be created" -e "rate-limited by GitHub" -- plugin docs/plugin-structure.md docs/journeys/act-on-a-contested-claim.md`
Expected: only `plugin/bin/lib/claim-targets/claim-targets.js` (the stderr refusal message) and `flow/claim-targets.md`'s card line `The \`claims-registry\` branch is missing on origin and could not be created: {reason}.` remain.
Run: `git grep -n -e "claims-branch-bootstrap-network-failure" -- plugin docs`
Expected: hits in `claim-targets.js` (lib) and `flow/claim-targets.md`.
Run: `node --test tests/flow-claim-preflight.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS.
Run: `wc -c plugin/skills/_shared/issue-claims.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/claim-targets.md`
Expected: each under 52,500.

- [ ] **Step 4: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js plugin/skills/flow/claim-targets.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/_shared/issue-claims.md docs/plugin-structure.md docs/journeys/act-on-a-contested-claim.md
git commit -m "Document bootstrap network failure as exit 4 — exit-code prose across CLI usage, flow, dispatch, issue-claims, refs #4756" -m "Claude-Session: https://claude.ai/code/session_016yg3zqdPwxEVZPAhLXNVtm"
```

### Task 5: Caller-audit verification (read-only, scope-creep add-to-plan)

**Role:** transcription

Plan audit's Check B matched these files on the scope keywords. None needs a change; this task proves the Caller audit table above holds after Tasks 1-3. It changes no repository file, so it runs after the SDD tasks without an implementer dispatch: Steps 1-2 are read-only checks, Step 3 edits the PR body.

**Files:**
- Read: `plugin/bin/lib/reconcile/preflight.js`, `plugin/bin/lib/reconcile/pr-state.js`, `plugin/bin/lib/reconcile/release-merged.js` — each maps `classifyGhApiError(e).failure` through a `=== 'gh-absent'` ternary, so `permission-denied` lands where `network-failure` did.
- Read: `plugin/bin/lib/release-claim/release.js` — `writeTombstone`'s `ghApi` forwards the classifier's `{failure, status}`; a 403 still throws from `writeTombstone` (message text only changes); `isAlreadyReleasedError` matches `HTTP (404|409|422)` only.
- Read: `plugin/bin/lib/issues/claims-git-cas.js` — its comment calls itself the git-side counterpart of `classifyGhApiError`; git-side classification is untouched.
- Read: `tests/bin-lib/reconcile/release-merged.test.js` (line ~738 comment: an unrecognised exit is still `network-failure` — true after the split, its text names no 401/403).
- No change, `docs/donts.md`: its line 175 rule ("check `claim-store.js`'s `classifyGhApiError` first") is satisfied by extending that classifier.
- No change, `docs/superpowers/plans/2026-10-31-claims-registry-bootstrap-4495.md`: a shipped plan, historical record — not rewritten.

- [ ] **Step 1: Run the callers' suites after Task 3**

Run: `node --test tests/bin-lib/reconcile/preflight.test.js tests/bin-lib/reconcile/pr-state.test.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/release-claim/release.test.js tests/bin-lib/release-claim/cli.test.js tests/bin-lib/issues/claims-git-cas.test.js`
Expected: PASS. Any failure means a caller depended on `network-failure` for a 401/403 — stop and report it.

- [ ] **Step 2: Confirm no caller compares a claim-store failure to the literal**

Run: `git grep -n -F "=== 'network-failure'" -- plugin/bin`
Expected: only `pr-state.js`-sourced PR-state comparisons (`reconcile/*.js`, `pr-merge-state.js`) — none reads a `claim-store.js` result.

- [ ] **Step 3 (controller, after Step 1 passes): name the failure-string change in the PR**

The caller audit's Deliverable 1 obligation ("updated deliberately with the change named in the PR"). The controller — not an implementer — appends this sentence to the end of the `### Spec summary` paragraph of PR #4878's body (read with `gh pr view 4878 --json body --jq .body`, write the edited body with the Write tool to a session temp file, then `gh pr edit 4878 --body-file {file}`; every other line of the body unchanged):

`Caller-visible text change: a 401/403 on a claim read or write (claim-targets.js, list-claims.js, dispatch-resume.js, release-claim.js, the dispatch first-call artifact check) now reports \`permission-denied\` where it reported \`network-failure\`; each caller's exit code is unchanged.`

No commit (read-only).

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1 | Task 1 (+ caller audit above, `perm-read` in Task 3) |
| Deliverable 2 / AC2.1 | Task 2 (rule), Task 3 (`bm10`, `bm10b`) |
| Deliverable 3 | Task 2 (rule over default-branch read, tip read, POST, re-read) |
| AC3.1 | Task 2 (`bm4` fixture fix; the test lives in the claim-targets suite) |
| AC4.1 | Task 2, Task 3 (`bm8b`) |
| Deliverable 4 / AC5.1 | Task 4 |
| Deliverable 5 / AC6.1 | Task 1 |
| Deliverable 6 / AC7.1, AC8.1, AC11.1 | Task 2, Task 3 (`bm11`, `bm12`, `bm13`) |
| AC9.1 | Task 3 (`bm14`) |
| Deliverable 7 / AC10.1 | Task 3 (`bm16`) |
| AC12.1 | Task 3 (`bm15`) |
