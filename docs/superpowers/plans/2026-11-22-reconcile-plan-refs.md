# Reconcile plan-refs Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A background reconcile check, `plan-refs`, that deletes `refs/claude-tweaks/plans/{n}` on `origin` for every record `n` whose issue state reads `CLOSED`.

**Architecture:** One new module `plugin/bin/lib/reconcile/plan-refs.js` in the family's shape — pure decision functions (ref listing parser, GraphQL query builder and response parser, per-ref decision) with I/O (`git ls-remote`, `gh api graphql`, `git push`) at injectable edges — dispatched by `reconcile()` between `ledger-residue` and `reap`, on the background tier, deferred from the unscoped CLI like the other remote-writing janitorial checks.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI, gh CLI (`gh api graphql`).

**Spec:** `.claude-tweaks/pipelines/2026-11-22T163748-spec-6055/work/6055-spec.md`

## Global Constraints

- Only refs matching `^refs/claude-tweaks/plans/[0-9]+$` on `origin` are considered; the prefix and parser come from `plugin/bin/lib/plan-store/ref.js` (`PLAN_REF_PREFIX`, `parsePlanRefName`, `DEFAULT_REMOTE`) — never re-typed.
- A record is closed only on a positive match: its issue `state` reads `CLOSED` from one aliased GraphQL batch (pattern: `plugin/bin/lib/reconcile/pr-state-batch.js`). Open, a null alias, a NOT_FOUND (deleted/transferred) issue and a partial or poisoned response all keep the ref.
- One `git push` per ref: `git push --force-with-lease=<ref>:<sha> origin :<ref>` (probed 2026-11-22: a stale lease is rejected `(stale info)` and the ref survives; the observed sha deletes).
- Skipped with a reported reason under `work-backend: local-files`; `no-remote` is already reported for the whole pass by `reconcile()`'s own gate, and under pr-first so is `gh`-absent (`preflight-gh-absent`). Under `integration-model: local-merge` the check still runs (spec `## Plan Review Clarifications`), dispatched beside `reap`'s fallback before the local-merge early return; that path runs no gh preflight, so the check itself reports a `gh` spawn `ENOENT` as `failure: 'gh-absent'`.
- Under `--dry-run` the planned deletions are the check's own `would-delete` entries in `result.planRefs`, rendered as their own summary row; nothing goes into `residuePlan` (spec `## Plan Review Clarifications`).
- `ls-remote` failure aborts the check with a reported row (`failure: 'ls-remote-failed'`).
- Under `--dry-run`: report planned deletions, push nothing.
- Never throws: every failure is a reported entry or `failure` string (never-break-a-session).
- Commit style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01X7gPFCW9Kmc1vBYtWjUWjp`.

## Review Focus

- **A plan re-written between listing and delete** — the lease must make the push fail and the entry read `delete-failed`, never `delete`. (Task 1 test `planRefs: a rejected lease push reports delete-failed and keeps going`.)
- **A GraphQL response carrying an `errors` entry that is not a NOT_FOUND on one of this query's own aliases** — the whole chunk is unreadable; every ref in it is kept `state-unreadable`. (Task 1 test `parseIssueStateResponse: a foreign error poisons the chunk`.)
- **An alias whose node `number` differs from the asked record, or a lowercase/unknown `state`** — keep. (Task 1 test `parseIssueStateResponse: keeps only exact-number CLOSED/OPEN nodes`.)
- **More than 50 plan refs** — the batch chunks at 50 aliases; a failed second chunk keeps only its own refs. (Task 1 test `planRefs: chunks of 50, a failed chunk keeps only its refs`.)
- **`ls-remote` output with `refs/claude-tweaks/plans/0`, `.../007`, `.../12abc`, `.../5/x` or a peeled `^{}` line** — never touched. (Task 1 test `listPlanRefs: keeps exact-integer refs only`.)

---

### Task 1: The `plan-refs` check module

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/reconcile/plan-refs.js`
- Test: `tests/bin-lib/reconcile/plan-refs.test.js`

**Interfaces:**
- Consumes: `plugin/bin/lib/plan-store/ref.js` — `PLAN_REF_PREFIX` (`'refs/claude-tweaks/plans/'`), `parsePlanRefName(ref) -> number|null`, `DEFAULT_REMOTE` (`'origin'`); `plugin/bin/lib/work-backend.js` — `readWorkBackend(root) -> string|null`; `plugin/bin/lib/repo-resolve.js` — `parseRepo(url) -> {host, owner, repo}|null`, `ghOptions(args, opts)`; `plugin/bin/lib/reconcile/timing.js` — `execFileSyncTimed(file, args, opts)`; `plugin/bin/lib/shared-primitives.js` — `GIT_TIMEOUT_MS`, `GH_TIMEOUT_MS` (read lazily).
- Produces (exported):
  - `PLAN_REFS_BATCH_CHUNK = 50`
  - `listPlanRefs(lsRemoteStdout: string) -> Array<{ ref: string, record: number, sha: string }>` — pure; one entry per distinct exact-integer plan ref, sorted by record.
  - `buildIssueStateQuery(records: number[]) -> string` — pure; aliases `i{index}: issue(number:{n}){ number state }` under `repository(owner:$owner,name:$name)`, variables typed `String!`; a non-positive-integer record is omitted.
  - `parseIssueStateResponse(stdout: string, records: number[]) -> Map<number, 'OPEN'|'CLOSED'>` — pure; only proven answers present.
  - `decidePlanRef({ record: number, state: 'OPEN'|'CLOSED'|undefined }) -> { action: 'delete'|'skip', reason: 'record-closed'|'record-open'|'state-unreadable' }` — pure.
  - `planRefs({ cwd, dryRun, git, gh, readBackend } = {}) -> { entries: Array<{ ref, record, action: 'delete'|'would-delete'|'skip', reason, detail? }>, failure: string|null }` — never throws. `git(args) -> stdout` and `gh(args) -> stdout` are injectable runners that throw on non-zero exit (the error may carry `.stdout`/`.stderr`); defaults run `git -C root …` / `gh …` via `execFileSyncTimed` with `windowsHide: true`. `readBackend(root)` defaults to `readWorkBackend`. `failure` values: `local-files-backend`, `ls-remote-failed`, `origin-unresolvable`, `gh-absent` (a gh runner throw whose `code` is `'ENOENT'`), `unexpected-error`.

- [ ] **Step 1: Write the failing tests (AC1.1, AC2.1, AC3.1, AC5.1, AC5.2, AC5.3)** in `tests/bin-lib/reconcile/plan-refs.test.js`, every runner a fake (no network, no real remote). Required tests and assertions:
  - `listPlanRefs: keeps exact-integer refs only` — input lines `aaa\trefs/claude-tweaks/plans/12`, `bbb\trefs/claude-tweaks/plans/0`, `ccc\trefs/claude-tweaks/plans/007`, `ddd\trefs/claude-tweaks/plans/12abc`, `eee\trefs/claude-tweaks/plans/5/x`, `fff\trefs/claude-tweaks/plans/3^{}`, `ggg\trefs/heads/main`, a CRLF line `hhh\trefs/claude-tweaks/plans/4\r`, blank lines → `[{ref:'refs/claude-tweaks/plans/4', record:4, sha:'hhh'}, {ref:'refs/claude-tweaks/plans/12', record:12, sha:'aaa'}]`.
  - `buildIssueStateQuery: aliases each record, omits invalid ones` — `[7, 0, 'x', 9]` → contains `i0: issue(number:7){ number state }` and `i3: issue(number:9){ number state }`, no `i1`/`i2`, and `query($owner:String!,$name:String!)`.
  - `parseIssueStateResponse: keeps only exact-number CLOSED/OPEN nodes` — records `[1,2,3,4,5]`, data `{i0:{number:1,state:'CLOSED'}, i1:{number:2,state:'OPEN'}, i2:{number:99,state:'CLOSED'}, i3:null, i4:{number:5,state:'closed'}}` → Map `{1:'CLOSED', 2:'OPEN'}` only.
  - `parseIssueStateResponse: an own-alias NOT_FOUND is absent, others still read` — errors `[{type:'NOT_FOUND', path:['repository','i1']}]`, data i0 CLOSED → Map `{1:'CLOSED'}` (2 absent).
  - `parseIssueStateResponse: a foreign error poisons the chunk` — errors `[{type:'FORBIDDEN', path:['repository','i0']}]` with i0 CLOSED → empty Map; non-JSON stdout → empty Map; non-array `errors` → empty Map.
  - `decidePlanRef` — CLOSED → `{action:'delete', reason:'record-closed'}`; OPEN → `{action:'skip', reason:'record-open'}`; undefined → `{action:'skip', reason:'state-unreadable'}`.
  - `planRefs: closed deleted, open kept, unreadable kept` — refs 1 (closed), 2 (open), 3 (absent from response) → entries `delete/record-closed` for 1, `skip/record-open` for 2, `skip/state-unreadable` for 3; the git fake saw exactly one push, `['push', '--force-with-lease=refs/claude-tweaks/plans/1:{sha1}', 'origin', ':refs/claude-tweaks/plans/1']`.
  - `planRefs: a rejected lease push reports delete-failed and keeps going` — refs 1 and 4 both closed, the push for 1 throws with stderr `! [rejected] (stale info)` → entry 1 `skip/delete-failed` with `detail` containing `stale info`; entry 4 `delete/record-closed`; returns, never throws.
  - `planRefs: chunks of 50, a failed chunk keeps only its refs` — 51 closed refs, the gh fake throws (no stdout) on the second call → refs 1-50 `delete`, ref 51 `skip/state-unreadable`; gh called twice.
  - `planRefs: gh rejection stdout is still parsed` — the gh fake throws an error whose `.stdout` holds a NOT_FOUND-only response with i0 CLOSED → ref deleted (mirrors pr-state-batch's exit-1-with-body rule).
  - `planRefs: dry run deletes nothing` — `dryRun: true`, ref 1 closed → entry `would-delete/record-closed`, zero push calls.
  - `planRefs: ls-remote failure aborts with a reported failure` — the git fake throws on `ls-remote` → `{entries: [], failure: 'ls-remote-failed'}`, no gh call.
  - `planRefs: local-files backend skips` — `readBackend: () => 'local-files'` → `{entries: [], failure: 'local-files-backend'}`, no git or gh call.
  - `planRefs: no plan refs makes no gh call` — empty ls-remote → `{entries: [], failure: null}`, gh never called.
  - `planRefs: an origin that does not parse is a reported failure` — the git fake returns `not a url` for `remote get-url origin` → `failure: 'origin-unresolvable'`, no push.
  - `planRefs: an unexpected throw is a reported failure` — `readBackend` throws → `failure: 'unexpected-error'`, never throws.
  - `planRefs: an absent gh is a reported failure` — ref 1 listed, the gh fake throws an error with `code: 'ENOENT'` → `{entries: [], failure: 'gh-absent'}`, zero push calls.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/plan-refs.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/reconcile/plan-refs'`

- [ ] **Step 3: Implement `plugin/bin/lib/reconcile/plan-refs.js`** with the Interfaces above. Header comment in the family's style naming #6055, the evidence bar and the lease. Order inside `planRefs`: backend gate → `git ls-remote origin 'refs/claude-tweaks/plans/*'` (built from `PLAN_REF_PREFIX` + `*`, remote `DEFAULT_REMOTE`) → nothing listed ends → `git remote get-url origin` + `parseRepo` (unparseable → `origin-unresolvable`) → state batch, `gh api graphql --hostname {host} -f owner={owner} -f name={repo} -f query={…}` per 50-record chunk (`-f`, never `-F`), a throw's `.stdout` parsed like success, but a throw whose `code` is `'ENOENT'` ends the check with `failure: 'gh-absent'` before any push → per ref `decidePlanRef` → `dryRun` turns `delete` into `would-delete` with no push → otherwise one push per ref, a throw → `skip/delete-failed` with `detail` = first stderr line. The state read is the batch made in this same call, immediately before the pushes.

Source-scan forms (they fail the suite, not review): the default `gh` runner spawns `execFileSyncTimed('gh', args, ghOptions(args, { cwd: root, encoding: 'utf8', timeout, windowsHide: true }))` (`tests/gh-host-seam-conformance.test.js`); every spawn passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`); the `ls-remote` argv line carries `// git-path-read: not a path list (ref names)` as `plugin/bin/lib/plan-store/git.js` does (`tests/git-path-read-conformance.test.js`); argv arrays only, never a shell string.

Live probes run at plan time (2026-11-22, this repo, origin resolved by `parseRepo` to `{host:'github.com', owner:'thn-inc', repo:'claude-tweaks'}`):
- `git ls-remote origin 'refs/claude-tweaks/plans/*'` → exit 0, no output (no plan refs exist on origin yet).
- `gh api graphql --hostname github.com -f owner=thn-inc -f name=claude-tweaks -f query=…` with aliases `i0: issue(number:6052)`, `i1: issue(number:6055)`, `i2: issue(number:6082)` (a PR, not an issue), `i3: issue(number:9999999)` → **exit 1** with body `{"data":{"repository":{"i0":{"number":6052,"state":"CLOSED"},"i1":{"number":6055,"state":"OPEN"},"i2":null,"i3":null}},"errors":[{"type":"NOT_FOUND","path":["repository","i2"],…},{"type":"NOT_FOUND","path":["repository","i3"],…}]}`. So a non-zero exit routinely carries a readable body (parse `err.stdout`), and a PR number or a missing issue arrives as an own-alias NOT_FOUND — kept, never deleted.
- `git push --force-with-lease=<ref>:<stale sha> <remote> :<ref>` on a scratch bare remote → exit 1 `! [rejected] (delete) -> <ref> (stale info)`, ref survives; with the observed sha → exit 0, ref gone.

Proof(irreversible-side-effect): the closed state is read from a fresh GraphQL batch inside the same `planRefs` call immediately before any push, only refs whose suffix `parsePlanRefName` accepts as an exact positive integer are ever pushed, and each delete leases on the sha `ls-remote` observed (`--force-with-lease=<ref>:<sha>`), so a plan re-written in between survives — tests `planRefs: a rejected lease push reports delete-failed and keeps going` and `listPlanRefs: keeps exact-integer refs only` pin both halves.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/plan-refs.test.js tests/gh-host-seam-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/git-path-read-conformance.test.js`
Expected: PASS, all files

- [ ] **Step 4b: Real-input probe** — run the finished check read-only against this checkout: `node -e 'require("./plugin/bin/lib/reconcile/plan-refs").planRefs({cwd: process.cwd(), dryRun: true})' -p` (or an equivalent one-liner printing the result). Expected: `{ entries: [], failure: null }`, reconciled against the independent count from `git ls-remote origin 'refs/claude-tweaks/plans/*'` (0 lines). Record both outputs in the task report. This is shape-only coverage of the live read path: no plan ref exists on origin yet, and none is created to test it (a pushed ref is shared state).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/plan-refs.js tests/bin-lib/reconcile/plan-refs.test.js
git commit -m "Add plan-refs reconcile check — delete a closed record's plan ref with a lease"
```

### Task 2: Register `plan-refs` in reconcile and document it

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (require; `ALL_CHECKS`; result literal `planRefs: null`; the local-merge fallback block and its comment; `DISPATCH_ORDER` between `ledger-residue` and `reap`; dispatch block; the `-> {…}` result-shape comment; ordering comment above `ALL_CHECKS`)
- Modify: `plugin/bin/hooks.js` (`BACKGROUND_CHECKS`, `CLI_DEFERRED_CHECKS`, the `reconcile-threw` fallback literal gains `planRefs: null`)
- Modify: `plugin/bin/lib/reconcile/format-summary.js` (`CATEGORIES`)
- Modify: `plugin/skills/tidy/scan-procedures.md` (the Reconcile-first `--checks` list)
- Modify: `docs/reconcile-checks.md`, `docs/hooks.md`, `docs/plugin-structure.md`
- Modify (shape tests whose pinned strings name the check set): `tests/reconcile-dispatch.test.js`, `tests/reconcile.test.js`, `tests/reconcile-preflight-fetch.test.js`, `tests/console-execute.test.js`, `tests/console-execution.test.js`, `tests/bin-lib/hooks/reconcile-background.test.js` — update every literal that lists the check set (find them with `git grep -n "ledger-residue" -- tests`)
- Test: `tests/bin-lib/reconcile/plan-refs.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `planRefs({ cwd, dryRun }) -> { entries, failure }`.
- Produces: `reconcile()` result key `planRefs: null | Array<entry>`; check name `'plan-refs'` in `ALL_CHECKS`, `DISPATCH_ORDER`, `BACKGROUND_CHECKS`, `CLI_DEFERRED_CHECKS`; under local-merge `plan-refs` runs as a fallback (as `reap` does), so the local-merge skip string stays exactly `'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console'` — `plan-refs` is never added to it. No `PREREQUISITES` entry (the check lists `origin` itself and reads no state another check produces).

Waived AC4.1: the whole suite is /build Common Step 5's verification run over the finished branch, not a per-task step.

- [ ] **Step 1: Append the failing tests (AC3.1, AC5.3)** to `tests/bin-lib/reconcile/plan-refs.test.js`:
  - `index: plan-refs is registered on the background tier, deferred from the unscoped CLI, dispatched between ledger-residue and reap` — `ALL_CHECKS.includes('plan-refs')`; `require('…/plugin/bin/hooks.js').BACKGROUND_CHECKS` and `.CLI_DEFERRED_CHECKS` include it (export `CLI_DEFERRED_CHECKS` from `hooks.js` if not already exported); in `index.js`'s source, `checks.includes('plan-refs')` sits after `checks.includes('ledger-residue')` and before `checks.includes('reap')`.
  - `index: requesting plan-refs under pr-first sets result.planRefs to an array; not requesting it leaves null` — same fixture shape as `ledger-residue.test.js`'s `index: requesting ledger-residue under pr-first…` test (a local bare origin, stubbed preflight), `checks: ['plan-refs']`.
  - `index: a plan-refs failure lands in skipped` — with `CLAUDE.md` declaring `work-backend: local-files` in the fixture, `skipped` contains `{ check: 'plan-refs', reason: 'local-files-backend' }`.
  - `index: under local-merge plan-refs still runs and stays out of the local-merge skip string` — same fixture, `resolveIntegrationModel: () => 'local-merge'`, `checks: ['plan-refs']` → `Array.isArray(result.planRefs)`; the `skipped` entry whose `reason` is `'local-merge-model'` has `check === 'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console'`. And with `checks: ['reap']` under the same stub, `result.planRefs === null` (not requested, not run).
  - `formatSummary renders plan-refs taken, planned and skipped lines` — `{ planRefs: [{action:'delete'}, {action:'would-delete'}, {action:'skip', reason:'record-open'}] }` → output contains `deleted: 1 plan ref`, `to delete (dry run): 1 plan ref` (the `${verb}: ${n} ${unit}` row shape, `format-summary.js`'s CATEGORIES loop) and a skip line counting `record-open`.
  - `hooks.js reconcile-threw fallback carries planRefs` — `hooks.js` source's fallback literal contains `planRefs: null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/plan-refs.test.js`
Expected: FAIL — the six new tests fail (`plan-refs` not in `ALL_CHECKS`)

- [ ] **Step 3: Register the check.** In `index.js`: dispatch block after `ledger-residue`'s, guarded by its own `overBudget(DISPATCH_ORDER.slice(9))` (reap's guard becomes `slice(10)`), `timePhaseSync('plan-refs', () => planRefs({ cwd: root, dryRun }))`, a `failure` → `result.skipped.push({ check: 'plan-refs', reason: r.failure })`, else `result.planRefs = r.entries`. In the `model !== 'pr-first'` branch, after `reap`'s legacy fallback and before the `local-merge-model` skip push, the same `if (checks.includes('plan-refs'))` block runs (same failure/entries handling); extend that branch's comment to name `plan-refs` beside `reap` as the two checks with a local-merge path, and leave the skip string unchanged. `format-summary.js` rows: `{ key: 'planRefs', unit: 'plan ref', verb: 'deleted', takenActions: ['delete'], skipActions: ['skip'] }` and `{ key: 'planRefs', unit: 'plan ref', verb: 'to delete (dry run)', takenActions: ['would-delete'], skipActions: [] }`. Then update the shape tests' literals listed under Files so the full set matches the new check order.

- [ ] **Step 4: Document it.** `docs/reconcile-checks.md`: add `plan-refs` to the dispatch-order arrow list (between `ledger-residue` and `reap`), the `BACKGROUND_CHECKS` list, the CLI-deferred mention, the gh-absent preflight example lists (lines ~459/462), and a new `## Plan refs (#6055)` section stating the evidence bar, the lease, the skip reasons (`local-files-backend`, `ls-remote-failed`, `origin-unresolvable`, `gh-absent`, `unexpected-error`; per-entry `record-open`, `state-unreadable`, `delete-failed`), dry-run's `would-delete`, and that it runs under local-merge too (a fallback beside `reap`'s) — and wherever that file says only `reap` has a local-merge path, name `plan-refs` too; `docs/hooks.md`'s Background convergence bullet: add "closed-record plan-ref deletion" to both check lists; `docs/plugin-structure.md`'s `plugin/bin/lib/reconcile/` inventory line: one clause for `plan-refs.js`; `plugin/skills/tidy/scan-procedures.md`: add `plan-refs` to its explicit `--checks` list in `ALL_CHECKS` order (`…,ledger-residue,plan-refs,console`) — and nothing else in that file: it is 52,480 B against the 52,500 B `RAIL_BYTES` rail (measured on the merge base), so the 10-byte `,plan-refs` insertion leaves 10 B of headroom; any further wording there must be paid for by a cut in the same file. In `ALL_CHECKS` itself, insert `'plan-refs'` after `'ledger-residue'`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/plan-refs.test.js tests/reconcile-dispatch.test.js tests/reconcile.test.js tests/reconcile-preflight-fetch.test.js tests/console-execute.test.js tests/console-execution.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js tests/bin-lib/reconcile/ledger-residue.test.js`
Expected: PASS, all files

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js plugin/bin/hooks.js plugin/bin/lib/reconcile/format-summary.js plugin/skills/tidy/scan-procedures.md docs/reconcile-checks.md docs/hooks.md docs/plugin-structure.md tests/bin-lib/reconcile/plan-refs.test.js tests/reconcile-dispatch.test.js tests/reconcile.test.js tests/reconcile-preflight-fetch.test.js tests/console-execute.test.js tests/console-execution.test.js tests/bin-lib/hooks/reconcile-background.test.js
git commit -m "Register plan-refs in reconcile — background tier, CLI-deferred, between ledger-residue and reap"
```
