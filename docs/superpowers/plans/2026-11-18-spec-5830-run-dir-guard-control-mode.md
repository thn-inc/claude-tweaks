# Run-dir guard and control-mode policyOnly Implementation Plan (#5830)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-run `config.yml` can no longer switch `control-mode` off, and the shared run-directory guard refuses any `--run` directory that is not under the main checkout's `.claude-tweaks/pipelines/`.

**Architecture:** `control-mode` gets `policyOnly: true`, so the resolver's `--run` overlay skips it for every consumer at once (accept-park, console-resolve, pre-tool-use). The run-dir guard lives in two near-identical `resolveTarget` functions (`plugin/bin/lib/log-decision/append.js` and `plugin/bin/lib/stage-item/write.js`); both call one new pure predicate in `plugin/bin/lib/run-dir-guard.js`, so the rule is written once.

**Tech Stack:** Node 18+, `node --test`, CommonJS.

**Spec:** `.claude-tweaks/pipelines/2026-11-18T072534-spec-5879-5863-5865-5830/spec-5830/work/5830-spec.md` (record #5830).

## Global Constraints

- Commit style: `{Verb} {what} — {detail} (refs #5830)`, imperative, no conventional-commit prefixes; end the message with the session trailer the dispatch prompt gives. Stage specific files only; one plain `git` command per Bash call; never `git reset`, force-push or stash.
- Decision recorded (Deliverable 1): `control-mode` belongs to the keys a run config may not loosen. It is the single human-in-control switch (#4608); every consumer reads it for a gate that must not be removable by a file the run's own agent writes. `autonomy` and `auto-merge-max-lines` stay overlay-able (out of scope; the spec notes they are not `policyOnly` either).
- New refusal reason is exactly `'not-a-run-dir'`. A directory is a run directory when its real path is strictly inside `<git root>/.claude-tweaks/pipelines/` (the `pipelines` directory itself is refused). `pipelines/archive/<id>` and `pipelines/<parent>/spec-<n>` stay accepted.
- The `.claude-tweaks/pipelines/` comparison uses `path.relative` on real paths, never a string prefix or `/` literal (Windows).
- Tests that build run dirs must put them at `<root>/.claude-tweaks/pipelines/<id>`; a fixture whose run dir sits elsewhere is wrong after this change and is moved, not special-cased.

## Review Focus

- A run dir under `pipelines/` that is a symlink to a directory outside it: refused (the guard sees the real path).
- `main/x.claude-tweaks/pipelines-copy/<id>` look-alike and a `..` spelling that lands on `main/docs`: refused (the old characterization test recorded both as accepted).
- `<main>/.claude-tweaks/pipelines` itself passed as `--run`: refused.
- Archived (`pipelines/archive/<id>`) and nested multi-spec (`pipelines/<parent>/spec-<n>`) run dirs: still accepted.
- Control mode on in `policy.yml` with `control-mode: off` in the run `config.yml`: stays on; control mode on only in the run `config.yml` with policy absent: stays off.

---

### Task 1: Shared run-dir predicate wired into both `resolveTarget` twins

**Files:**
- Create: `plugin/bin/lib/run-dir-guard.js`
- Modify: `plugin/bin/lib/log-decision/append.js` (`resolveTarget`, lines ~88-111, plus its header comment naming the guard)
- Modify: `plugin/bin/lib/stage-item/write.js` (`resolveTarget`, lines ~47-64)
- Test: `tests/bin-lib/log-decision/append.test.js`, `tests/bin-lib/stage-item/resolve-target-refusals.test.js`, `tests/bin-lib/stage-item/write.test.js` (only if a fixture breaks)

**Interfaces:**
- Produces: `isUnderPipelines(realRunDir: string, gitRoot: string): boolean` exported from `plugin/bin/lib/run-dir-guard.js`. True only when `path.relative(path.join(gitRoot, '.claude-tweaks', 'pipelines'), realRunDir)` is non-empty, not `..`, not starting with `..` plus `path.sep`, and not absolute. Both `resolveTarget`s return `{ ok: false, reason: 'not-a-run-dir' }` when the anchor checks pass but this is false; every existing result is unchanged.
- Consumes: the `real` and `gitRoot` locals each `resolveTarget` already computes.

- [ ] **Step 1: Write the failing tests.** In `tests/bin-lib/log-decision/append.test.js` add `resolveTarget: a run dir outside .claude-tweaks/pipelines/ is not-a-run-dir` building the existing fake-main fixture (`.git` directory) with: `main/plugin`, `main/docs`, `main/.claude-tweaks/pipelines` itself, `main/x.claude-tweaks/pipelines-copy/run-a`, a symlink `main/.claude-tweaks/pipelines/link -> main/docs`, plus the accepted controls `pipelines/run-a`, `pipelines/archive/run-a` and `pipelines/run-p/spec-1`. Assert each refused one deep-equals `{ ok: false, reason: 'not-a-run-dir' }` and each control `.ok === true`, with `mainRoot: main`. In `resolve-target-refusals.test.js` change the C3a/C3b/C4 expectations (currently documented as accepted, see the file header) to `assertRefused(r, 'not-a-run-dir')` and update the header comment to say the guard now refuses them.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/log-decision/append.test.js tests/bin-lib/stage-item/resolve-target-refusals.test.js`
Expected: FAIL — the new and flipped assertions see `ok: true`.
- [ ] **Step 3: Implement `isUnderPipelines` in `plugin/bin/lib/run-dir-guard.js`** (CommonJS, one export, a header comment naming both callers) and call it in both `resolveTarget`s as the last check before `ok: true`. Update each function's result-shape comment to list `'not-a-run-dir'`.
- [ ] **Step 4: Run to verify green**, same command — Expected: PASS.
- [ ] **Step 5: Find fixtures the guard breaks.** Run the impact-selected verification redirected to a file: `node plugin/bin/verify.js --local --default-suite-slots 1 > <scratchpad>/verify-task1.txt 2>&1`, read `failingFiles` from its `verify-report.json`, and move each failing fixture's run dir to `<root>/.claude-tweaks/pipelines/<id>` (do not touch assertions that are not about the path). Re-run until green. This is AC3.1: the existing run-directory resolution tests still pass.
- [ ] **Step 6: Commit** `plugin/bin/lib/run-dir-guard.js`, the two `resolveTarget` files and every touched test: `Refuse run dirs outside .claude-tweaks/pipelines in both resolveTarget guards — one shared predicate (refs #5830)`.

### Task 2: CLI messages and acceptance tests for `queue-pull.js` and `accept-park.js`

**Files:**
- Modify: `plugin/bin/queue-pull.js` (`resolveRunDir`, lines ~184-206)
- Modify: `plugin/bin/accept-park.js` (`anchoredRun`, lines ~254-269)
- Modify: `plugin/bin/release-claim.js` (~line 176) and `plugin/bin/repair-claim.js` (~line 131): the `not-anchored` / else branches
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` (Sanctioned-write CLIs bullet, ~line 238-246)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`, `tests/accept-park-cli.test.js`

**Interfaces:**
- Consumes: `resolveTarget` from Task 1 returning `reason: 'not-a-run-dir'`.
- Produces: stderr text for that reason: queue-pull `"<value>: <path> is not a pipeline run directory (it must sit under .claude-tweaks/pipelines)"`; accept-park `"accept-park.js: run dir is not a pipeline run directory (it must sit under .claude-tweaks/pipelines): <dir>"`; release-claim and repair-claim print the same sentence after their `decisions.md not written — ` prefix. Exit codes unchanged (queue-pull 1, accept-park 3).

- [ ] **Step 1: Write the failing tests.** `queue-pull.test.js`: next to the #5584 CLI `--named/--run` tests (`withMainCheckout`, ~line 3897), add `#5830: --run naming a directory outside .claude-tweaks/pipelines/ is refused` passing `path.join(root, 'plugin')` (create it) as `--run` with `--named 12`; assert exit 1, stderr matches `/not a pipeline run directory/`, and nothing written (no `decisions.md` in that dir). `accept-park-cli.test.js`: add `#5830: decide, park and parked refuse a --run outside .claude-tweaks/pipelines with exit 3`, building `path.join(w.state.root, 'plugin')` and asserting code 3, empty stdout, stderr `/not a pipeline run directory/`; also assert a `config.yml` containing `control-mode: off` placed in that directory is never read (stdout empty).
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js tests/accept-park-cli.test.js`
Expected: FAIL after Step 1 — the two new tests append to existing files and fail on the message match (Task 1 already makes them exit non-zero). This covers AC2.1.
- [ ] **Step 3: Implement the four message branches** exactly as listed in Interfaces; add one sentence to the Sanctioned-write CLIs bullet in `pipeline-run-dir.md` stating the guard also requires the directory to sit under `.claude-tweaks/pipelines/` and names the third refusal message.
- [ ] **Step 4: Run to verify green**, same command, plus `node --test tests/bin-lib/release-claim/cli.test.js tests/bin-lib/repair-claim/cli.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** the touched files: `Name the not-a-run-dir refusal in queue-pull, accept-park and the claim writers (refs #5830)`.

### Task 3: `control-mode` becomes `policyOnly`

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (`control-mode` row, line ~197, and the control-mode comment block at ~196)
- Modify: `plugin/bin/accept-park.js` (header comments ~51-55 and ~575 that describe the run's config.yml over policy.yml)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (the `policyOnly` bullet, line ~102)
- Modify: `docs/journeys/resolve-a-policy-key.md` (Step 3 red-flag list, line ~47, and its change-log list at the end)
- Test: `tests/resolve-policy-control-mode.test.js`, `tests/accept-park-cli.test.js`

**Interfaces:**
- Produces: `POLICY_KEYS` row `{ key: 'control-mode', ..., policyOnly: true }`; `resolvePolicyKeys(['control-mode'], { policyRaw, runConfigRaw })` ignores `runConfigRaw` (existing mechanism at `policy-schema.js:715`).

- [ ] **Step 1: Write the failing tests.** In `tests/resolve-policy-control-mode.test.js` beside `a policyOnly key ignores the --run overlay` (~line 266) add `control-mode ignores the --run overlay both ways`: run config `control-mode: off` over policy `control-mode: on` resolves `{ value: 'on', source: 'policy' }`, and run config `on` with policy absent resolves `{ value: 'off', source: 'default' }` (use that file's own helper shape). In `tests/accept-park-cli.test.js` add `#5830: parked --run keeps the project value when the run config says control-mode off` — policy `ON`, `config.yml` `control-mode: off`, `parked --record 7 --run <runDir>` with `throwingGh.gh` returns code 6 and stdout `unknown\n` (not the 5 / `not-parked` the overlay produced). Then rewrite the three tests that pin the old overlay: `"parked --run: the run's config.yml outranks policy.yml for control-mode"` (~1072) becomes `...never outranks...` asserting policy off + config on gives code 5 with and without `--run`; `control mode on in config.yml only still reads the globs` (~514) becomes a test asserting the globs are not read (control mode stays off: decision `consulted: false`); I1 at ~275 stays as is.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resolve-policy-control-mode.test.js tests/accept-park-cli.test.js`
Expected: FAIL — the new tests and the rewritten ones fail. This covers AC1.1: a test sets `control-mode: off` in a run `config.yml` and asserts `accept-park.js parked --run` still reads the project-level value.
- [ ] **Step 3: Add `policyOnly: true` to the `control-mode` row** and extend its comment: policyOnly because it is the single human-in-control switch and a run's own agent writes `config.yml` (#5830). Reword the two `accept-park.js` comments to say control mode is read from the main checkout's `policy.yml` alone, with `--run` still anchoring the AUTO lines. Add `control-mode` to the `policyOnly` bullet in `policy-schema-coverage.md` and to Step 3's red-flag list in the journey (with `#5830`).
- [ ] **Step 4: Run to verify green**, same command, then `node --test tests/policy-schema.test.js tests/policy.test.js tests/control-mode-hard-gates-conformance.test.js tests/hooks-pre-tool-use.test.js tests/bin-lib/console/control-mode-cli.test.js tests/bin-lib/issues/autonomy-control-mode.test.js tests/bin-lib/driver/merge.test.js` — Expected: PASS. A failure in one of these means that test set `control-mode` through a run `config.yml`; move the value to its `policy.yml` fixture (do not change assertions that are not about the overlay).
- [ ] **Step 5: Commit**: `Make control-mode policyOnly so a run config cannot switch the park gate off (refs #5830)`.
