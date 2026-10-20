# resolveLedgerPath ownership attribution (#3566) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `resolveLedgerPath` returns a `docs/plans` ledger only when this branch owns it, using the ownership rule `ledgerProbe` already applies. Wrap-up's post-sweep re-count reads a re-run ledger probe instead of a bare glob.

**Architecture:** Move `ledgerProbe`'s ownership computation (the merge-base diff plus untracked files under `docs/plans/`) into a new shared module, `plugin/bin/lib/wrap-up/ledger-ownership.js`, and have `pack.js` and `ledger-write.js` both call it. `resolveLedgerPath` needs a merge base its callers (`hooks.js delete-ledger`, `wrap-up-engine.js finish-console`) do not hold, so `pack.js` exports `resolveWorktreeBase(worktree, deps?)`: the same integration-branch ladder plus merge-base computation `resolveInputs` performs. `ledger-write.js` requires `pack.js` lazily, inside its default `resolveBase`, so there is no load-time cycle.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T001914-record-3566/work/3566-spec.md`

## Global Constraints

- An inherited ledger is never returned. `ambiguous` is returned only when two or more owned candidates remain.
- One ownership helper, shared by `ledgerProbe` and `resolveLedgerPath`. It must not be re-implemented.
- `npm test` passes in full.
- Commit messages: `{Verb} {what} — {detail}`, with `refs #3566` (never `closes`/`fixes`).

## Review Focus

1. No merge base (not a git repo, or no integration branch reachable), with docs/plans candidates present: fail closed with a distinct `unattributable` reason, never return a candidate. Task 1 tests it.
2. A git subprocess throws during the ownership read: same `unattributable` outcome, never a crash. Task 1 tests it.
3. No docs/plans candidates at all: still `not-found` with `candidates: []`, without computing a base (finish-console's "no ledger anywhere" test depends on this). Task 1 tests it.
4. `{run-dir}/ledger.md` present: still wins before any git call. The existing test is kept.
5. An explicit `--ledger` path: unchanged. Its confinement checks run before ownership, and an explicit path is never ownership-filtered. The existing tests are kept.

---

### Task 1: Shared ownership helper; ownership-scoped `resolveLedgerPath`

**Files:**
- Create: `plugin/bin/lib/wrap-up/ledger-ownership.js`
- Modify: `plugin/bin/lib/wrap-up/pack.js` (`PLANS_PREFIX`/`plansFileNames` at ~455-462 move out; `ledgerProbe` ~504-509 calls the helper; add `resolveWorktreeBase` after `mergeBase` ~292; export it)
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js` (`resolveLedgerPath` and its header comment)
- Modify: `plugin/bin/hooks.js:1062-1091` (comment and an `unattributable` branch in `delete-ledger`)
- Modify: `plugin/bin/wrap-up-engine.js:653-660` (`unattributable` detail in `finish-console` step 3)
- Modify: `docs/plugin-structure.md` (lines 17 and 24: the `resolveLedgerPath` description and the module-family list gains `ledger-ownership.js`)
- Test: `tests/bin-lib/wrap-up/ledger-write.test.js`, `tests/delete-ledger-verb.test.js`

**Interfaces:**
- Produces: `ledger-ownership.js` exports `PLANS_PREFIX = 'docs/plans/'`, `plansFileNames(nulSeparatedPaths) -> string[]` (moved verbatim), and `ownedPlansFiles({ worktree, base, git }) -> Set<string>`. It returns the basenames named by `git diff --name-only -z --relative {base} -- docs/plans/` plus `git ls-files --others --exclude-standard -z -- docs/plans/` (both with `{ cwd: worktree }`, exactly today's argv). It throws when `base` is falsy or git throws.
- Produces: `pack.js` exports `resolveWorktreeBase(worktree, deps = defaultDeps(worktree)) -> string | null`, computed as `resolvePolicy(['integration-branch'], worktree)` → `resolveIntegrationBranch` → `mergeBase(...).base`.
- Produces: `resolveLedgerPath({ runDir, worktree, explicit, deps })`, where `deps` gains `git(args, { cwd })` (default: `execFileSync('git', …)`, utf8, stdio piped) and `resolveBase(worktree) -> string|null` (default: lazy `require('./pack').resolveWorktreeBase(worktree)`). There is one new failure shape, `{ ok: false, reason: 'unattributable', detail, candidates }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/wrap-up/ledger-write.test.js`. Fake `git` like `pack.test.js`'s `ownedGit` (return NUL-joined `docs/plans/…` paths for `diff`/`ls-files`) and `resolveBase: () => 'abc123'`:
  - `resolveLedgerPath returns not-found when the only docs/plans ledger is inherited from the merge base`: readdir `['2026-01-01-old-ledger.md']`, diff and ls-files return `''` → `deepStrictEqual(r, { ok: false, reason: 'not-found', candidates: [] })`.
  - `resolveLedgerPath returns the owned ledger beside inherited ones`: readdir `['a-old-ledger.md', 'b-mine-ledger.md', 'c-old-ledger.md']`, diff returns `docs/plans/b-mine-ledger.md` → `ok: true`, `path === path.join('/wt','docs','plans','b-mine-ledger.md')`.
  - `resolveLedgerPath counts an untracked ledger as owned`: ls-files returns `docs/plans/new-ledger.md` → that path.
  - `resolveLedgerPath reports ambiguous only among owned candidates`: readdir has 3, two owned → `reason: 'ambiguous'`, `candidates` are exactly those two paths.
  - `resolveLedgerPath fails closed as unattributable when no merge base resolves`: `resolveBase: () => null`, one candidate → `ok: false`, `reason: 'unattributable'`, the candidate is not returned as `path`.
  - `resolveLedgerPath fails closed as unattributable when git throws`: `git: () => { throw new Error('boom'); }` → `reason: 'unattributable'`, `detail` matches `/boom/`.
  - `resolveLedgerPath does not resolve a base when docs/plans holds no ledger`: `resolveBase` throws if called; readdir `[]` → `not-found`.
  - Update the two existing tests (`falls back to a single…`, `reports ambiguous…`) to inject owned-git fakes. Their assertions stay as they are.
  - In `tests/delete-ledger-verb.test.js`, add `delete-ledger: an inherited docs/plans ledger committed on main is not deleted`: commit `docs/plans/2026-08-14-old-ledger.md` on `main` in `gitRoot()`, `git checkout -q -b feature`, run `delete-ledger --run` → stdout matches `/not found/`, and the file still exists.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js tests/delete-ledger-verb.test.js`
Expected: FAIL. The inherited-only cases resolve the stray ledger, and the delete-ledger case deletes it.

- [ ] **Step 3: Implement.** Create `ledger-ownership.js` and repoint `ledgerProbe` to `ownedPlansFiles` (keep its own `if (!inputs.base) throw …` message). Add and export `resolveWorktreeBase`. In `resolveLedgerPath`, after the run-dir check and the candidate listing: zero candidates → `not-found` (no base computed). Otherwise `base = resolveBase(worktree)`. A falsy base, or a throw from `ownedPlansFiles`, gives `unattributable` with `detail` (`'merge base unavailable — cannot attribute docs/plans ledgers to this run'` or the error message) and `candidates`. Filter candidates by `owned.has(basename)`: zero → `not-found`, two or more → `ambiguous`, one → `ok`. In `hooks.js`, add an `unattributable` branch before the generic not-found branch: `claude-tweaks: delete-ledger: cannot attribute docs/plans ledgers to ${basename(runDir)} (${detail}) — pass --ledger <path> explicitly; ledger not deleted`. In `wrap-up-engine.js`, add a matching `detail` arm. Update the header comment in `ledger-write.js`, the comment in `hooks.js`, and both `docs/plugin-structure.md` descriptions to say "the one docs/plans ledger this branch owns (merge-base diff or untracked, shared with pack.js's ledger probe via ledger-ownership.js)".

- [ ] **Step 4: Run to verify they pass, plus the neighbors**

Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js tests/delete-ledger-verb.test.js tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/finish-console-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/ledger-ownership.js plugin/bin/lib/wrap-up/pack.js plugin/bin/lib/wrap-up/ledger-write.js plugin/bin/hooks.js plugin/bin/wrap-up-engine.js docs/plugin-structure.md tests/bin-lib/wrap-up/ledger-write.test.js tests/delete-ledger-verb.test.js
git commit -m "Scope resolveLedgerPath to owned docs/plans ledgers — shared ownership helper with ledgerProbe, refs #3566"
```

### Task 2: Wrap-up re-count reads the re-run ledger probe

**Files:**
- Modify: `plugin/skills/wrap-up/SKILL.md:208`
- Modify: `plugin/skills/wrap-up/residue-sweep.md` (~62-66, the "If no ledger file exists yet for this run" sentence)
- Test: `tests/bin-lib/wrap-up/ledger-write.test.js` (add a prose pin, matching the repo's skill-prose conformance style)

**Interfaces:**
- Consumes: `wrap-up-pack.js --run <dir> --print ledger --json <path>` (existing flags. `--json` keeps the full `wrap-up-pack.json` that later sub-steps read from being overwritten by a ledger-only pack).

- [ ] **Step 1: Write the failing test** `wrap-up prose re-counts the ledger via the ledger probe, not a glob (#3566)`. Read `SKILL.md`, then assert `/re-count after the sweep by re-running the ledger probe/` and `/wrap-up-pack\.js" --run "\$PIPELINE_RUN_DIR" --print ledger --json/`. Read `residue-sweep.md` and assert `/pack\.ledger.{0,80}files/s` and `/unattributedFiles/`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js`
Expected: FAIL on the new prose test.

- [ ] **Step 3: Edit the prose.** In SKILL.md:208, change "re-count after the sweep" to "re-count after the sweep by re-running the ledger probe — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger --json "$PIPELINE_RUN_DIR/wrap-up-pack-ledger.json"` (a separate file, so `wrap-up-pack.json`'s other probes stay intact) — never a bare `docs/plans/*-ledger.md` glob, which also matches ledgers inherited from the integration branch". The "still doesn't exist or holds zero items" clause reads that re-run probe's `files`/`total`. In residue-sweep.md, change "If no ledger file exists yet for this run" to key on `pack.ledger`'s `value.files` being empty: an inherited `docs/plans` ledger appears under `unattributedFiles` and is never this run's. `ok: false` (no merge base to attribute by) is the one case that falls back to `_shared/ledger-format.md`'s resolution rule.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/SKILL.md plugin/skills/wrap-up/residue-sweep.md tests/bin-lib/wrap-up/ledger-write.test.js
git commit -m "Re-count the wrap-up ledger via the ledger probe — no bare docs/plans glob after the residue sweep, refs #3566"
```

## Self-review

- Spec coverage: Deliverable 1 → Task 1. Deliverable 2 → Task 2. Deliverable 3 (three named cases) → Task 1 Step 1. AC1 (not-found, and delete-ledger deletes nothing) → Task 1's inherited-only unit test plus the delete-ledger CLI test. AC2 → the owned-plus-inherited test. AC3 → the full suite in /build Common Step 5.
- Placeholders: none.
