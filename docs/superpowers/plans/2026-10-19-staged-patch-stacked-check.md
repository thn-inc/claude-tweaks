# Staged-Patch Stacked Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch, at staging time, a staged `.patch` that applies alone but fails on top of the same run's earlier staged patches in console apply order — and re-derive it onto them when a 3-way merge can.

**Architecture:** A pure-ish lib module (`plugin/bin/lib/staged-patch/stack-check.js`) copies every file the run's patches touch from the worktree into a throwaway scratch git repo, applies the staged patches there one by one in *apply order* (byte-wise sort of `staged/` filenames — the order `bin/lib/console/resolve.js`'s `readSnapshot` already reads them), and names the earlier patch a failing one conflicts with. A thin CLI (`plugin/bin/check-staged-stack.js`) wraps it for staging sites. `_shared/staged-patch.md`'s Staging-time gate gains a "Stacked check" step citing the CLI, and defines "apply order" once — the Console apply section cites the same definition.

**Tech Stack:** Node 18+ CommonJS, `child_process.spawnSync('git', …)`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T205809-record-3290/work/3290-spec.md` (record #3290)

## Global Constraints

- Never touch the worktree or `staged/` from the check: all applies run in a `fs.mkdtempSync(path.join(os.tmpdir(), 'staged-stack-'))` scratch repo (`git init -q`), removed in a `finally`.
- Apply order = `names.filter((n) => n.endsWith('.patch')).sort()` (default JS sort, byte-wise — identical to `resolve.js` line 231's `.sort()`).
- CLI exit codes: 0 no conflict involving `--patch`; 1 a conflict involving `--patch` (JSON on stdout, one stderr line naming both `staged/` paths); 2 malformed invocation, or `--patch` does not apply at its position nor alone; 3 run dir (parent of `staged/`) missing or not anchored under the main checkout (`lib/stage-item/write.js`'s `resolveTarget`); 4 the check could not run (scratch/git failure). `require.main === module` guard sets `process.exitCode` (never `process.exit`).
- A copied path from a patch that is absolute or has a `..` segment is never read: that patch lands in `skipped` with `error: 'unsafe path {p}'`.
- Commit messages: `{Verb} {what} — {detail}` plus `refs #3290`; never `closes`/`fixes`.

## Review Focus

1. A new patch whose name sorts *before* an existing one (`review-10.patch` < `review-2.patch`) — the existing patch failing on top of it must still be reported as a conflict involving the new patch (Task 1 test `AC1.1: order — a new patch sorting first is still caught`).
2. A run's first staged patch (no siblings) — must exit 0 with no conflict (Task 3 test `AC2.1: single patch`).
3. The worktree must be byte-identical and `git status --porcelain` empty after a check (Task 1 test `worktree untouched`).
4. A re-derived patch that depends on an earlier one fails *alone* by design — the check must accept it at its position rather than reject it as broken (Task 2 test `re-derived patch passes the stacked check`).
5. A patch that creates, deletes, or renames a file is never re-derived (`rederive` returns `{ok:false, reason:'non-modification hunk'}`) (Task 2 test `create-mode patch is not re-derived`).

---

### Task 1: `checkStack` — apply-order stacking with conflict attribution

**Files:**
- Create: `plugin/bin/lib/staged-patch/stack-check.js`
- Test: `tests/bin-lib/staged-patch/stack-check.test.js`

**Interfaces:**
- Produces: `stagedApplyOrder(names: string[]) -> string[]`; `checkStack({ worktree: string, patches: string[] /* absolute paths, apply order */, target: string /* absolute path, one of patches */, git? }) -> { ok: boolean, order: string[] /* basenames */, skipped: {patch, error}[], conflicts: {patch, conflictsWith, error}[], targetConflict: {patch, conflictsWith, error} | null, targetUnapplicable: boolean }`. `git(args, {cwd}) -> {status, stdout, stderr}` defaults to a `spawnSync('git', …, {encoding:'utf8'})` wrapper. Basenames in results, never absolute paths. Throws only on scratch/git spawn failure (`status === null`).

- [ ] **Step 1: Write the failing tests.** A `gitFixture(t)` like `tests/staged-patch-contract.test.js`'s (hardened `FIXTURE_ENV`, `FIXTURE_TIMEOUT_MS`), file `f.txt` = `l1..l4, anchor, a1..a3`. Patches are produced by editing `f.txt`, capturing `git diff`, then `git checkout -- f.txt` — never hand-typed — and written under a separate tmp `staged/` dir with the preamble `Target: f.txt\nInvariant: x\n\n`. Tests:
  - `AC1.1: two patches inserting above the same anchor are reported naming both` — review-1 inserts `new1a,new1b` above `anchor`, review-2 inserts `new2a,new2b` above it. `checkStack({target: review-2})` → `ok === false`, `targetConflict.patch === 'review-2.patch'`, `targetConflict.conflictsWith === 'review-1.patch'`, `targetConflict.error` matches `/patch failed|does not apply/`.
  - `AC2.1: patches on separate regions stack cleanly` — review-1 edits `l1`, review-2 edits `a3` → `ok === true`, `conflicts` deep-equals `[]`, `skipped` deep-equals `[]`.
  - `AC1.1: order — a new patch sorting first is still caught` — same two same-anchor edits staged as `review-2.patch` (existing) and `review-10.patch` (target) → `order` deep-equals `['review-10.patch','review-2.patch']`, `targetConflict` deep-includes `{patch:'review-2.patch', conflictsWith:'review-10.patch'}`.
  - `a patch that fails alone is skipped, not a conflict` — a third patch staged against a since-changed line → in `skipped`, absent from `conflicts`.
  - `worktree untouched` — after the AC1.1 check, `git status --porcelain` is `''` and `f.txt` bytes equal the base.
  - `stagedApplyOrder sorts byte-wise and drops non-patches` — `['review-2.patch','x.md','review-10.patch']` → `['review-10.patch','review-2.patch']`.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js` — Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/staged-patch/stack-check'`).

- [ ] **Step 3: Implement `stagedApplyOrder` and `checkStack` in `plugin/bin/lib/staged-patch/stack-check.js`.** Header comment: purpose, `refs #3290`, the apply-order identity with `resolve.js`'s `readSnapshot`. Algorithm:
  1. Files: for each patch, `git apply --numstat -z <patch>` with `cwd: worktree`; split on `\0`; a record `a\td\tpath` gives `path`, a record `a\td\t` followed by two tokens gives `src`, `dst` (rename). Unsafe path → `skipped`. Union of paths that exist under `worktree` (`fs.existsSync`).
  2. `buildScratch(files)` → mkdtemp, `git init -q`, copy each file (mkdir -p its dir) from `worktree`.
  3. Walk `patches` in order in one scratch: `git apply --check p`; ok → `git apply p`, push to `applied`. On failure → `attribute(p, applied)`: fresh scratch, check `p` on it (empty prefix) — fails → `skipped`; else apply `applied[0..]` one at a time, re-checking `p` after each; the first after which `p` fails is `conflictsWith`; push `{patch, conflictsWith, error: first stderr line}` to `conflicts`. A failing patch is never applied (mirrors the console's description fallback).
  4. `targetConflict` = first conflict with `patch === target || conflictsWith === target`; `targetUnapplicable` = target ended in `skipped`; `ok = !targetConflict && !targetUnapplicable`.

- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit.** `git add plugin/bin/lib/staged-patch/stack-check.js tests/bin-lib/staged-patch/stack-check.test.js` then `git commit -m "Add staged-patch stacking check — apply-order conflict attribution, refs #3290"`.

### Task 2: `rederive` — 3-way re-derivation onto the stacked state

**Files:**
- Modify: `plugin/bin/lib/staged-patch/stack-check.js`
- Test: `tests/bin-lib/staged-patch/stack-check.test.js`

**Interfaces:**
- Consumes: Task 1's `checkStack`, its numstat file collection and scratch builder.
- Produces: `rederive({ worktree, patches, target, git? }) -> { ok: true, patch: string } | { ok: false, reason: string }`. `patch` = target's preamble (text before its first `diff --git` line, verbatim) + the re-derived unified diff.

- [ ] **Step 1: Write the failing tests** (append to the Task 1 file; nine-line `f.txt` = `l1..l9` for the first two):
  - `AC1.1: overlapping-context edits re-derive onto the earlier patch` — review-1 changes `l2`→`L2`, review-2 changes `l5`→`L5` (its 3-line context covers `l2`). `checkStack` reports `targetConflict.conflictsWith === 'review-1.patch'`; `rederive` → `ok === true`, `patch` starts with the preamble, contains `+L5` and ` L2` (context now the stacked line).
  - `re-derived patch passes the stacked check` — write `rederive(...).patch` over `review-2.patch`, re-run `checkStack` → `ok === true`, `conflicts` deep-equals `[]`.
  - `AC1.1: same-anchor insertions are not re-derived` — Task 1's same-anchor pair → `rederive` → `{ok:false}`, `reason` matches `/conflict/`.
  - `create-mode patch is not re-derived` — target creates `g.txt` → `{ok:false, reason:'non-modification hunk'}`.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js` — Expected: FAIL (`rederive is not a function`).

- [ ] **Step 3: Implement `rederive`.** Refuse (`reason: 'non-modification hunk'`) when `git apply --summary <target>` (cwd worktree) prints any `create mode`/`delete mode`/`rename ` line. Stacked state = scratch with every patch before `target` in apply order that `checkStack`'s walk applied; `git add -A` there (the index becomes the diff base). Theirs = second scratch with only `target` applied. Per target file: write ours/base/theirs to the scratch, `git merge-file -p ours base theirs` — status `> 0` → `{ok:false, reason:'conflict in {path}'}`; `0` → write stdout over the stacked file. Then `git diff --no-color --no-ext-diff` in the stacked scratch; empty → `{ok:false, reason:'already satisfied by an earlier patch'}`. Both scratches removed in `finally`.

- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js` — Expected: PASS (10 tests).

- [ ] **Step 5: Commit.** `git add` the two files, `git commit -m "Re-derive a conflicting staged patch onto the stacked state — 3-way merge, refs #3290"`.

### Task 3: `check-staged-stack.js` CLI + structure docs

**Files:**
- Create: `plugin/bin/check-staged-stack.js`
- Create: `tests/bin-lib/staged-patch/cli.test.js`
- Modify: `docs/plugin-structure.md` (lib-dir table near the `plugin/bin/lib/stage-item/` line; CLI list near the `stage-item.js` line)

**Interfaces:**
- Consumes: `stagedApplyOrder`, `checkStack`, `rederive`; `resolveTarget` from `plugin/bin/lib/stage-item/write.js`.
- Produces: `node plugin/bin/check-staged-stack.js --worktree <dir> --patch <run-dir>/staged/<name>.patch [--rederive-out <file>] [--help]`; exported `run(argv, deps) -> number`, `deps = {cwd, mainRoot?, stdout, stderr, writeFile, git?}`. Stdout: one JSON line `{ok, order, skipped, conflicts, targetConflict, rederived, rederiveReason}` (`rederived`/`rederiveReason` `null` unless `--rederive-out` was passed and `targetConflict.patch` is the target). Exit codes per Global Constraints.

- [ ] **Step 1: Write the failing tests.** Fixture: a fake main checkout (`main/.git` dir, run dir `main/.claude-tweaks/pipelines/2026-10-19T000000-spec-1/staged/`) plus a worktree shadow, as `tests/bin-lib/stage-item/cli.test.js` builds; a real git repo as `--worktree`; patches captured from `git diff`. Tests:
  - `AC1.1: exit 1 and stderr names both staged paths` — same-anchor pair, `--patch …/review-2.patch` → `1`; stderr includes `staged/review-2.patch` and `staged/review-1.patch`; stdout JSON `targetConflict.conflictsWith === 'review-1.patch'`.
  - `AC2.1: single patch` and `AC2.1: clean stack` → `0`, stderr `''`.
  - `--rederive-out writes the re-derived patch` — overlapping-context pair → `1`, the out file exists, JSON `rederived` equals its path.
  - `--patch outside staged/ is malformed (exit 2)`; `missing --worktree (exit 2)`; `trailing bare --patch (exit 2)`; `--help exits 0`.
  - `worktree-shadow run dir is refused (exit 3)` — `--patch` under the shadow's `staged/`.
  - `a target that does not apply alone exits 2`.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/bin-lib/staged-patch/cli.test.js` — Expected: FAIL (`Cannot find module '../../../plugin/bin/check-staged-stack'`).

- [ ] **Step 3: Implement `plugin/bin/check-staged-stack.js`** on the `stage-item.js` CLI shape (header comment stating the exit vocabulary and that it reads, never writes, the run dir; `parseArgs` rejecting a missing/`--`-prefixed value). `--patch`: absolute-resolve; `path.basename(path.dirname(p)) === 'staged'` and `.patch` suffix else 2; run dir = `path.dirname(path.dirname(p))` through `resolveTarget` (3 on refusal). List `staged/` via `stagedApplyOrder`. `checkStack` throw → 4. stderr line on exit 1: `check-staged-stack.js: staged/{patch} does not apply on top of staged/{conflictsWith} in apply order ({error})`. Then add the two `docs/plugin-structure.md` lines.

- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/bin-lib/staged-patch/cli.test.js tests/bin-lib/exit-code-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add plugin/bin/check-staged-stack.js tests/bin-lib/staged-patch/cli.test.js docs/plugin-structure.md` then `git commit -m "Add check-staged-stack CLI — staging-time stacked check for staged patches, refs #3290"`.

### Task 4: Contract prose — Stacked check and one apply order

**Files:**
- Modify: `plugin/skills/_shared/staged-patch.md` (Staging-time gate section, lines 70-105; Console apply section opening, lines 107-110). 14,551 B now, rail 52,500 B — ~2 KB added leaves ~35 KB headroom.
- Test: `tests/staged-patch-contract.test.js`

**Interfaces:**
- Consumes: Task 3's CLI invocation and exit codes.

- [ ] **Step 1: Write the failing tests** (append):
  - `AC3.1: apply order is defined once and both the gate and the console apply section use it` — exactly one line in the contract matches `/^\*\*Apply order\.\*\*/`; that paragraph names `byte-wise` and `bin/lib/console/resolve.js`; the `## Staging-time gate` slice and the `## Console apply with description fallback` slice each contain `apply order`; the Console slice no longer contains `in the order the console lists them`.
  - `AC1.1: staging gate runs the stacked check and names both patches on a conflict` — the gate slice contains `### Stacked check`, `bin/check-staged-stack.js`, `--rederive-out`, and a STAGED line template containing both `staged/{slug}-{n}.patch` and `staged/{earlier}.patch`.
  - `AC2.1: a clean stack writes only the normal STAGED entry` — the gate slice's exit-0 bullet contains `normal` and `nothing else`.
  - Factor the three into one `assertStackedGate(text)` and add a go-red control calling it on the contract text with the `### Stacked check` subsection removed, expecting a throw.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/staged-patch-contract.test.js` — Expected: FAIL (new tests only).

- [ ] **Step 3: Edit `staged-patch.md`.**
  - After the gate's solo branches, add `### Stacked check` with: one sentence of why (the 2026-10-16T181217-spec-2882 review-1/review-2 incident); the `**Apply order.**` paragraph (byte-wise `staged/` filename sort, `review-1.patch` < `review-10.patch` < `review-2.patch`, the order `bin/lib/console/resolve.js` reads them, independent of any console table's display order; a multi-spec console walks spec dirs in manifest order, each in apply order); the invocation `node "${CLAUDE_PLUGIN_ROOT}/bin/check-staged-stack.js" --worktree "$WORKTREE" --patch "$STAGE_PATH" --rederive-out "{session tmp}/rederive-{slug}-{n}.patch"`, run after the solo check exits 0; and branches: **exit 0** — write the site's normal `STAGED` entry, nothing else; **exit 1 with `rederived`** — overwrite the staged file with it (same id, same writer the site used), re-run only the stacked check (the re-derived diff depends on the earlier patch and no longer applies alone), then the normal `STAGED` entry suffixed ` Re-derived onto staged/{earlier}.patch.`; **exit 1 without** — re-anchor once if the edit admits another anchor (recompose in the worktree, overwrite, re-run both checks), else keep the `.patch` and log `STAGED {time} — {step}: {finding} — stacked check: staged/{slug}-{n}.patch conflicts with staged/{earlier}.patch in apply order ({first stderr line}); kept — the console re-derives the later one from Invariant:. Stage path: staged/{slug}-{n}.patch. Reversibility: high.`; **exit 2/3/4** — keep the solo-validated `.patch`, log the gate-could-not-run line with `stacked check` and the exit code. Note under `auto` this is never a mid-flow stop.
  - Console apply opening: replace `in the order the console lists them` with `in apply order (the Stacked check's **Apply order** paragraph — the same order the staging gate stacked them in)`.

- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/staged-patch-contract.test.js tests/reverify-before-write-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.** `git add plugin/skills/_shared/staged-patch.md tests/staged-patch-contract.test.js` then `git commit -m "Stack-check staged patches at staging time — one apply order for gate and console, refs #3290"`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 — stacked check in console order | 1, 3, 4 |
| Deliverable 2 — re-derive / re-anchor, else log in STAGED line | 2, 4 |
| Deliverable 3 — test pinning same-anchor caught at staging | 1 (`AC1.1` same-anchor), 3 |
| AC1.1 | Tasks 1-4 tests named `AC1.1: …` |
| AC2.1 | Tasks 1, 3, 4 tests named `AC2.1: …` |
| AC3.1 | Task 4 test `AC3.1: …` |

## Verified premises (run 2026-10-19, git in this checkout)

- Same-anchor insertions: each `git apply --check` exit 0 alone; second fails stacked (`error: patch failed: f.txt:2`); `-C1` also fails; `-C0` "applies" at line 11 (wrong place) — so no context-reduction re-anchoring.
- Overlapping context (`l2`→`L2` then `l5`→`L5`): second fails stacked; `git merge-file -p ours base theirs` exits 0 with both edits.
- Same-anchor `git merge-file` exits 1 with conflict markers.
- `git apply --numstat -z` prints `1\t1\tf.txt\0` for a one-line modification; `--summary` prints nothing for a pure modification.

## As-built deviations (Common Step 4.5 — both Beneficial)

1. **The console judges staged patches by the same stacked walk.** The spec scoped the change to the staging gate; a re-derived patch only applies on top of its earlier patch, so `bin/lib/console/resolve.js`'s `readSnapshot` now takes a stacked verdict (`checkPatchStack`, from `stack-check.js`'s `stackVerdicts`) when supplied, and `staged-patch.md`'s post-Step-5 re-check runs the Stacked check (commit 2ce922000). Without it the Release Note's "no longer silently falls back to the description path" would not hold for a re-derived patch.
2. **The staging sites name the Stacked check.** `review/step3-routing.md`, `test/fix-mode.md`, `test/SKILL.md`, `_shared/multi-agent-coordination.md`, `deepen/SKILL.md` now say the patch is validated per the Staging-time gate — `git apply --check`, then its Stacked check — so AC1's "reported at staging time" is reachable from each site's own wording (commit 3e7be524c).
