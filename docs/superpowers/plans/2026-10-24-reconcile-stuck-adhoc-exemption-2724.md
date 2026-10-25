# Reconcile Stuck-Paths In-Place Edit and Ad-Hoc Exemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reconcile's consolidated structurally-stuck record from erasing its own body on every pass, and stop it from escalating ad-hoc session dirs whose missing branch/worktree/PR is by construction.

**Architecture:** `escalate-residue.js` gains one body-editing helper that replaces only a line-anchored stuck-paths block, used by both the escalate and resolve paths, and the resolve path takes an optional reason text. `archive-merged.js` gains one predicate for an ad-hoc dir skipped at an intrinsic reason; `classifyRunDir` consults it, and `trackStuckSkip` uses it to clear (and, if escalated, resolve) an existing cache entry through a new `cache.js` helper.

**Tech Stack:** Node 18+, `node:test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T153132-spec-3997-2724/spec-2724/work/2724-spec.md`

Scope keywords: parseStuckPaths, structurallyStuckBody, trackStuckSkip, isAdHocStandaloneMint

## Global Constraints

- `STRUCTURALLY_STUCK_REASONS` stays unchanged — non-ad-hoc dirs still need `no-branch` tracked (spec Technical Approach).
- Ad-hoc-intrinsic reasons are exactly `no-branch`, `no-worktree`, `no-pr` (spec Deliverables). Any other tracked reason on an ad-hoc dir (`merged-partial`, `pr-not-found`, …) keeps escalating.
- The exemption applies only when `isAdHocStandaloneMint(dir)` holds AND the dir's `run-state.json` `worktree` is not the repository root that holds the run dir (`path.resolve(dir, '..', '..', '..')`). A main-checkout-stamped ad-hoc dir (`hooks/context.js`'s `stampAdHocRunDirForDenial` mints these on purpose) can never be claimed by `adhoc-superseded`, because the main checkout is always registered, so exempting it would turn a visible escalation into permanent silent residue. This is the `docs/donts.md:185` rule (#1604): never exempt a class on the strength of a successor cleanup path without tracing that the class can reach it. That sweep gap is filed separately, not fixed here.
- Scope-keyword sweep (plan-audit Check B), files needing no change:
  - `docs/journeys/learn-a-merged-run-needs-you-3297.md`, `docs/journeys/recover-a-run-stranded-by-a-stale-pr-number-3543.md`: non-ad-hoc reasons only;
  - `plugin/bin/lib/hooks/context.js:927`, `plugin/skills/reflect/full-mode.md:178`: cite `isAdHocStandaloneMint`, which is unchanged;
  - `tests/reconcile.test.js`: pins `isAdHocStandaloneMint` itself, unchanged;
  - `docs/donts.md:185`: the rule this plan follows.
- Every `gh` write stays best-effort and never throws out of reconcile (the module family's never-break-a-session contract).
- Commit messages: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01K8JunuuUfG8EwkbhUSun6n`.

## Deviation from the spec (logged)

The spec says a hit body with no stuck-paths block "keeps today's full `structurallyStuckBody` render". This plan instead **appends** the rendered block to a non-empty body that lacks one, and uses the full render only for an empty body. Rationale: the defect being fixed is the escalator overwriting human-written text, and a body that lost its block (a human rewrite) is exactly that case. Recorded as an Architecture Alignment "Beneficial" deviation.

## Review Focus

1. **CRLF bodies.** A body saved from the GitHub web editor carries `\r\n`, and a `$` under the `m` flag does not match before `\r`. The block must still be found. Pinned in Task 1 (`CRLF body`).
2. **`$` in a path.** `String.prototype.replace` with a string replacement expands `$&`/`$1`, which would corrupt a path containing `$`. Use a function replacer. Pinned in Task 1 (`dollar sign`).
3. **The marker named in prose above the block.** Today's unanchored regex starts its match at the prose mention, so an in-place replace would delete everything between the prose and the real block. Pinned in Task 1 (AC3.3 case plus the replace-survival assertion).
4. **A main-checkout-stamped ad-hoc dir.** It must keep classifying `structurally-stuck` (see Global Constraints). Pinned in Task 2.
5. **An exempted dir with no cache entry.** `trackStuckSkip` runs on every pass. With no entry, the clear must be a no-op that writes nothing and resolves nothing. Pinned in Task 2.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (ad-hoc exemption; existing cache entry resolves) | Task 2 |
| New Deliverable (in-place stuck-paths edit, line-anchored regex) | Task 1 |
| Deliverable 4 (explain under-listing) | Not code: explained in `decisions.md` and on the record. All 19 escalated-but-unlisted cache entries were first recorded on or before 2026-09-12, before the consolidated record existed (2026-09-21, #1811). They escalated as per-path issues #1718–#2359, all closed, and `escalated: true` is sticky, so none re-escalated into #2724. No new entry can fall into that gap, and the triage drains the 19 |
| Deliverables 2–3 (operational triage) | Not in this plan: build stages the triage table for the Review Console |
| AC1.1, AC1.2 | Task 2 |
| AC2.1, AC2.2 | Task 2 |
| AC3.1–AC3.4 | Task 1 |
| Waived AC4.1, AC4.2: operational, needs the human triage dispositions and a real post-merge reconcile pass; checked at the Review Console / after merge, not by a unit test |
| Waived AC5.1: operational, a record comment written when the triage dispositions run |
| AC6.1 | Build Common Step 5 (`verify.js`), not a plan task |

---

### Task 1: In-place stuck-paths block edit in `escalate-residue.js`

**Files:**
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js:73-87` (regex, new helper), `:268-298` (`escalateStructurallyStuck`), `:344-374` (`resolveStructurallyStuck`), `:376-398` (`resolveResidue`), `:399-401` (exports)
- Modify: `docs/reconcile-checks.md` — the "Consolidated `structurally-stuck` escalation" bullet's "edited in place via `gh issue edit --body`" sentence
- Test: `tests/bin-lib/reconcile/escalate-residue.test.js` (append after the last `resolveResidue: structurally-stuck` test)

**Interfaces:**
- Produces: `withStuckPaths(body: string, paths: string[]) -> string`, exported.
- Produces: `resolveResidue({ repo, reason, targetPath, runner, why })`. `why` is an optional string passed through to `resolveStructurallyStuck` and ignored for other reasons. When `why` is given, the two comment texts become `` `${targetPath}` ${why} — removed from the stuck-paths list (${n} path(s) still stuck).`` and `` `${targetPath}` ${why} — the last remaining stuck path. Closing.``. When `why` is omitted, both texts stay byte-identical to today's.
- Consumers (Consumer-enumeration check): `parseStuckPaths` is read at `escalateStructurallyStuck` and `resolveStructurallyStuck`, both pick-one (one block per body). `structurallyStuckBody` stays the create-path and empty-body render. `resolveResidue` is called by `cache.js`'s `pruneResidueFailures`, which passes no `why`, so it keeps today's text, and by Task 2's `clearResidue`.

- [ ] **Step 1: Append the failing tests to the existing, already-passing `tests/bin-lib/reconcile/escalate-residue.test.js`**

Every new test name starts with `#2724` (no existing test in either file carries that tag). Add a shared runner helper in the test file: it records calls, serves `issue list` with one hit `{ number, body, state }`, and captures the `--body` of the `issue edit` call. Tests:

```js
const SHAPED = (block) => `Surface: infra\n\n## Current State\n\nThe record names \`<!-- stuck-paths -->\` in prose.\n- \`/x/decoy\`\n\n${block}\n\n## Gotchas\n\n- keep me\n`;

test('#2724 AC3.1 AC3.2: escalate appends into the block and keeps the text around it byte-for-byte', () => {
  // hit body = SHAPED(renderStuckPathsBlock(['/x/run-a'])), OPEN; escalate '/x/run-b'
  // assert status 'appended'; edited === SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b']))
});
test('#2724 AC3.1 AC3.2: resolve removes its path from the block and keeps the text around it byte-for-byte', () => {
  // hit body = SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b'])); resolve '/x/run-a'
  // assert status 'path-removed'; edited === SHAPED(renderStuckPathsBlock(['/x/run-b']))
});
test('#2724 AC3.3: parseStuckPaths ignores a marker named in prose above the block', () => {
  assert.deepEqual(parseStuckPaths(SHAPED(renderStuckPathsBlock(['/x/run-a']))), ['/x/run-a']);
});
test('#2724 stuck-paths block: a CRLF body is still found and edited in place', () => {
  // SHAPED(...) with every \n -> \r\n; parseStuckPaths returns ['/x/run-a']; escalate '/x/run-b' edits only the block:
  // edited.startsWith('Surface: infra\r\n') and edited.endsWith('- keep me\r\n') and parseStuckPaths(edited) deep-equals ['/x/run-a','/x/run-b']
});
test('#2724 stuck-paths block: a path containing a dollar sign survives the in-place edit', () => {
  // escalate '/x/run-$&-b' into SHAPED(renderStuckPathsBlock(['/x/run-a'])); parseStuckPaths(edited) deep-equals ['/x/run-a', '/x/run-$&-b']
});
test('#2724 withStuckPaths: a non-empty body with no block gets the block appended, an empty body gets the full render', () => {
  assert.equal(withStuckPaths('Human text.\n', ['/x/a']), `Human text.\n\n${renderStuckPathsBlock(['/x/a'])}\n`);
  assert.equal(withStuckPaths('', ['/x/a']), structurallyStuckBody(['/x/a']));
});
test('#2724 resolveResidue: structurally-stuck with a why text uses it in place of the on-disk wording', () => {
  // two-path body; resolve '/x/run-a' with why: 'is exempt here'
  // the comment call's --body === '`/x/run-a` is exempt here — removed from the stuck-paths list (1 path(s) still stuck).'
});
```

AC3.4 (go-red): the AC3.1–AC3.3 tests above are the positive pins. Step 2 is their go-red run against today's code.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "#2724" tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: FAIL. `withStuckPaths` is not exported (TypeError). The AC3.1/AC3.2 edited bodies equal the bare `structurallyStuckBody(...)`, not `SHAPED(...)`. AC3.3 returns `['/x/decoy', '/x/run-a']`.

- [ ] **Step 3: Implement**

- `STUCK_PATHS_RE = /^<!-- stuck-paths -->\r?$([\s\S]*?)^<!-- \/stuck-paths -->\r?$/m`. `parseStuckPaths` is unchanged otherwise (it already trims each line, which handles `\r`).
- `withStuckPaths(body, paths)`:
  - when `STUCK_PATHS_RE` matches, return `body.replace(STUCK_PATHS_RE, () => renderStuckPathsBlock(paths))` (function replacer, Review Focus 2);
  - else when `!String(body || '').trim()`, return `structurallyStuckBody(paths)`;
  - else return `` `${body.replace(/\s+$/, '')}\n\n${renderStuckPathsBlock(paths)}\n` ``.
- In `escalateStructurallyStuck` and `resolveStructurallyStuck`, replace each `structurallyStuckBody(updatedPaths|remaining)` in the `issue edit` args with `withStuckPaths(hit.body, …)`.
- Thread `why` through `resolveResidue` into `resolveStructurallyStuck`, and pick the comment texts per the Interfaces block.
- Add a two-line `// #2724:` comment above `STUCK_PATHS_RE` saying why the markers are line-anchored. Export `withStuckPaths`.
- `docs/reconcile-checks.md`: change the bullet's in-place sentence to say the edit replaces only the line-anchored block (markers on their own lines, CRLF tolerated), keeps every other byte of the body, and appends the block to a non-empty body that lost it (#2724).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: PASS, every test (old and new), fail 0.

- [ ] **Step 5: Real-input probe**

Run: `node -e "const {parseStuckPaths}=require('./plugin/bin/lib/reconcile/escalate-residue.js');const fs=require('fs');for(const f of process.argv.slice(1))console.log(parseStuckPaths(fs.readFileSync(f,'utf8')).length)" "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/041fa783-aed7-44aa-a86a-0dd3eda45461/scratchpad/2724-shaped-body.md" "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/041fa783-aed7-44aa-a86a-0dd3eda45461/scratchpad/2724-restored-body.md"`
Expected: `15` then `25`. These are #2724's real 2026-10-24T12:11Z shaped body (marker named in its AC prose) and the restored body. Both counts were measured with today's regex, and the new one must match them.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/escalate-residue.js tests/bin-lib/reconcile/escalate-residue.test.js docs/reconcile-checks.md
git commit -m "Edit the stuck-paths block in place — reconcile no longer erases the consolidated record's body (#2724)"
```

---

### Task 2: Ad-hoc exemption from structurally-stuck, with entry clearing

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — new predicate beside `isAdHocStandaloneMint` (`:83`); `classifyRunDir`'s `structurally-stuck` branch (`:1699-1702`); `trackStuckSkip` (`:1719-1722`); exports (`:2298-2304`)
- Modify: `plugin/bin/lib/reconcile/cache.js` — new `clearResidue` beside `recordResidueSuccess` (`:199`), exported
- Modify: `docs/reconcile-checks.md` (the `#1732` classifier section): one sentence on the exemption and its linked-worktree condition
- Modify: `docs/hooks.md` (the Lifecycle (#1117) sentence about `isAdHocStandaloneSuperseded`): the same sentence
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (append after `trackStuckSkip: never escalates an ordinary in-flight dir…`)

**Interfaces:**
- Consumes: `resolveResidue({ repo, reason, targetPath, runner, why })` from Task 1.
- Produces: `ADHOC_INTRINSIC_STUCK_REASONS: Set<'no-branch'|'no-worktree'|'no-pr'>` and `isAdHocIntrinsicSkip(dir: string, reason: string) -> boolean`, both exported from `archive-merged.js`.
- Produces: `clearResidue(target, repoSlug, reason, targetPath, { resolve = resolveResidue, runner, why } = {}) -> { cleared: boolean, resolved: object|null }` in `cache.js`. When an entry exists it calls `recordResidueSuccess(target, reason, targetPath)`. If that entry was `escalated`, it then calls `resolve({ repo: repoSlug, reason, targetPath, runner, why })` inside try/catch. With no entry it returns `{ cleared: false, resolved: null }` and writes nothing.
- Produces: `trackStuckSkip(cacheTarget, repoSlug, dir, reason, { escalate, resolve, runner })`. The new `resolve` option is injectable for tests.
- Consumers: `classifyRunDir` is called with `kinds: ['structurally-stuck']` only via `isStructurallyStuck` (← `trackStuckSkip`, 5 call sites in `archiveMerged`, all pick-one per dir), and with the full order from `archiveMerged`'s main loop, where the branch is unreachable without a `skipReason`.

- [ ] **Step 1: Append the failing tests to the existing, already-passing `tests/bin-lib/reconcile/archive-merged.test.js`**

Every new test name starts with `#2724`. Fixture helper `mkAdHocRunDir({ ageMs, worktree })`:
- creates `{root}/.claude-tweaks/pipelines/2026-10-17T081451-adhoc-standalone` under a `mkdtemp` root;
- writes `run-state.json` `{ status: 'interrupted', worktree }`, where `worktree` defaults to `path.join(root, '.claude/worktrees/gone')` (never registered anywhere);
- backdates the dir by `ageMs` with `utimesSync`;
- returns `{ root, dir }`.

```js
test('#2724 AC1.1 AC1.2: an ad-hoc dir past 7 days at no-branch with an unregistered worktree classifies none', () => {
  const { dir } = mkAdHocRunDir({ ageMs: STRUCTURALLY_STUCK_TTL_MS * 2 });
  assert.equal(classifyRunDir({ dir, skipReason: 'no-branch', kinds: ['structurally-stuck'] }).kind, 'none');
  for (const r of ['no-worktree', 'no-pr']) assert.equal(isStructurallyStuck(dir, r), false);
});
test('#2724 AC2.1 AC2.2: an ad-hoc dir at a non-intrinsic tracked reason still classifies structurally-stuck', () => {
  // same fixture; 'merged-partial' and 'pr-not-found' each -> 'structurally-stuck'
});
test('#2724 ad-hoc exemption: a dir stamped with the main checkout as its worktree still classifies structurally-stuck', () => {
  // mkAdHocRunDir({ ageMs, worktree: root }) -> isStructurallyStuck(dir, 'no-branch') === true
});
test('#2724 ad-hoc exemption: a non-ad-hoc dir at no-branch still classifies structurally-stuck', () => {
  // same layout, basename '2026-10-17T081451-record-1' -> true
});
test('#2724 trackStuckSkip: an exempted ad-hoc dir clears its escalated entry and resolves it with the ad-hoc reason text', () => {
  // seed: recordResidueFailure x RESIDUE_ESCALATE_THRESHOLD on (root, 'structurally-stuck', dir) so escalated === true
  // trackStuckSkip(root, 'o/r', dir, 'no-branch', { escalate, resolve })
  // escalate never called; resolve called once with { reason: 'structurally-stuck', targetPath: dir } and why matching /ad-hoc/
  // listResidueFailures(root) deep-equals []
});
test('#2724 trackStuckSkip: an exempted ad-hoc dir with no entry writes nothing and resolves nothing', () => {
  // three calls; resolve and escalate never called; listResidueFailures(root) deep-equals []; no reconcile-cache.json under root
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "#2724" tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL. AC1.1 returns `'structurally-stuck'`. The clear test sees `resolve` never called and one entry left. AC2 and the two "still classifies" controls pass already, since they pin unchanged behavior (append-shaped, not a finding).

- [ ] **Step 3: Implement**

- `isAdHocIntrinsicSkip(dir, reason)` is true iff all of these hold:
  - `ADHOC_INTRINSIC_STUCK_REASONS.has(reason)`;
  - `isAdHocStandaloneMint(dir)`;
  - `path.resolve(readRunState(dir).worktree) !== path.resolve(dir, '..', '..', '..')`.
- Precede it with a `// #2724:` comment covering:
  - why these three reasons are intrinsic: an ad-hoc dir is "not a pipeline run", per `docs/hooks.md`;
  - why main-checkout ones are excluded: `adhoc-superseded` can never claim them.
- `classifyRunDir`: the `structurally-stuck` branch adds `&& !isAdHocIntrinsicSkip(dir, skipReason)`.
- `trackStuckSkip`: first line becomes:

  ```js
  if (isAdHocIntrinsicSkip(dir, reason)) {
    clearResidue(cacheTarget, repoSlug, 'structurally-stuck', dir, { resolve, runner, why: ADHOC_EXEMPT_WHY });
    return;
  }
  ```

  where `ADHOC_EXEMPT_WHY = 'is an ad-hoc session directory: no branch, worktree or PR is its normal state, and the adhoc-superseded sweep archives it once its session has ended'`.
- `clearResidue` follows the Interfaces block. It reads the entry from `target.cache` when `isCacheBatch(target)`, else from `readCache(target)`.
- Docs: one sentence each, as listed under Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: PASS, fail 0.

- [ ] **Step 5: Real-input probe**

Run: `node -e "const a=require('./plugin/bin/lib/reconcile/archive-merged.js');const root='/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/';for(const [d,r] of [['2026-10-17T081451-adhoc-standalone','no-branch'],['2026-10-17T100505-adhoc-standalone','no-branch'],['2026-10-17T111314-adhoc-standalone','no-branch'],['2026-10-17T093357-adhoc-standalone','no-pr'],['2026-10-17T150551-adhoc-standalone','no-pr']])console.log(d,a.isAdHocIntrinsicSkip(root+d,r))"`
Expected (read-only against the main checkout's real stuck ad-hoc dirs; a dir already archived prints `false`): `081451`, `100505` and `111314` print `true` (linked worktrees). `093357` and `150551` print `false` (stamped with the main checkout, so they keep escalating).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/archive-merged.test.js docs/reconcile-checks.md docs/hooks.md
git commit -m "Exempt linked-worktree ad-hoc dirs from structurally-stuck at no-branch/no-worktree/no-pr — and clear their escalated entries (#2724)"
```
