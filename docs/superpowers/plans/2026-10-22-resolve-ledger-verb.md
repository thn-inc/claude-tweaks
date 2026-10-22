# resolve-ledger Verb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-side `hooks.js resolve-ledger --run <dir>` verb that answers "which ledger is this run's?" through `resolveLedgerPath`, and repoint the ledger readers outside wrap-up at it so they stop restating the probe-and-fallback prose.

**Architecture:** `bin/lib/wrap-up/ledger-write.js` gains two pure functions: `describeRunLedgers` (wraps `resolveLedgerPath`, adds the other runs' `docs/plans/` ledgers) and `formatLedgerReport` (renders the verb's stdout). `bin/hooks.js` gains a `resolve-ledger` branch beside `delete-ledger`, using the same run-arg resolution. `_shared/ledger-format.md`'s resolution rule is rewritten around the verb's four reports, and the readers cite it.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T100958-record-3897/work/3897-spec.md`

Scope keywords: value.unattributedFiles

## Scope sweep classification

The first authoring draft swept `resolveLedgerPath, unattributedFiles, delete-ledger`. Every hit outside this plan is a consumer this change leaves untouched by construction: `resolveLedgerPath`'s return shape and `delete-ledger`'s behaviour are unchanged, and wrap-up keeps `pack.ledger`.
- `plugin/bin/lib/wrap-up/{pack,ledger-ownership}.js`, `plugin/bin/{stage-item,wrap-up-engine}.js`: callers of the unchanged resolver or probe.
- `plugin/skills/wrap-up/*` and `plugin/skills/flow/multispec-review-console.md`: wrap-up's pack consumers and `delete-ledger` callers. These are out of scope per Global Constraints.
- `tests/{delete-ledger-verb,multispec-ledger-deletion-order,wrap-up-ledger-delete-before-merge}.test.js`, `tests/bin-lib/wrap-up/{pack,finish-console-cli}.test.js`: pins on unchanged behaviour.
- `docs/journeys/{close-out-only-this-runs-ledger-3566,gather-the-wrap-up-fact-pack-1930}.md`: these describe wrap-up's pack, which is unchanged.
- `CHANGELOG.md`: release-please owns it.

The narrowed keyword `value.unattributedFiles` matches the restated reader handling this record removes. Its hits outside the plan are:
- `docs/journeys/find-this-runs-ledger-outside-wrap-up-3687.md`: added to Task 3, because it describes the readers' probe lookup this change replaces.
- `docs/superpowers/plans/2026-10-21-ledger-reader-ownership.md`: no change. It is #3687's own execution plan, a record of what that build did, and rewriting it would falsify that history.

## Global Constraints

- The four reports are exactly `found`, `none`, `ambiguous`, `unattributable` (spec Deliverable 1).
- The verb exits 0 on every outcome, like `delete-ledger` (spec Deliverable 1).
- `resolveLedgerPath`'s return shape is unchanged. `tests/bin-lib/wrap-up/ledger-write.test.js` asserts it with `deepStrictEqual` (lines 44, 62, 81, 90, 99, 139), so the other-run list is computed beside it, never added to it.
- Wrap-up's own pack consumers (`wrap-up/SKILL.md` Phase 3 re-count, `wrap-up/residue-sweep.md`) stay on `pack.ledger`, which is out of scope. They consume the pack's counts, and `tests/bin-lib/wrap-up/ledger-write.test.js:213-221` pins residue-sweep's `pack.ledger` keying (#3566). AC3.1's scan therefore covers `plugin/skills/**` outside `wrap-up/`.
- Size headroom: `plugin/skills/review/code-mode-steps.md` is 48,261 B against `RAIL_BYTES` 52,500 (92%, near the rail), so its edit adds at most ~60 B. `_shared/ledger-format.md` is 36,737 B and its edit should shrink it. `ledger/SKILL.md` is 14,294 B.

## Review Focus

1. **The run-dir `ledger.md` exists and the branch also owns a `docs/plans/` ledger** (an adopted pre-#3036 run). Expected: `found` names `{run-dir}/ledger.md`, and the `docs/plans/` file is listed as `other-run:` because there is one ledger per run. Pinned in Task 1.
2. **No `docs/plans/` directory at all.** Expected: `none` with no `other-run:` lines, not a crash. Pinned in Task 1.
3. **A path containing a space** (this repo lives under `Code Workspaces/`). Expected: each `this-run:`/`other-run:` line carries the full path verbatim. Pinned in Task 2.
4. **A branch that has already merged.** The merge base equals HEAD, so the run's own ledger reads as `other-run:`. This is documented in the rule, the same caveat #3687 stated, and is not tested.
5. **An omitted `--run` with several live candidate runs.** Expected: `renderCandidateRefusal` output plus `Ledger not resolved.`, with no report line, so the rule's "no report line" branch applies. Pinned in Task 2.

---

### Task 1: `describeRunLedgers` and `formatLedgerReport`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js` (add two functions and export them; update the header comment's "Used by" line)
- Test: `tests/bin-lib/wrap-up/ledger-write.test.js` (append)

**Interfaces:**
- Produces: `describeRunLedgers({ runDir, worktree, deps = {} }) -> { report: 'found'|'none'|'ambiguous'|'unattributable', ledgers: string[], others: string[], unattributed: string[], detail: string|null }`.
  - It calls `resolveLedgerPath({ runDir, worktree, deps })` with no `explicit`.
  - It lists `path.join(worktree, 'docs', 'plans')` through `deps.readdirSync || fs.readdirSync`, filtered to `*-ledger.md`. A throwing readdir is an empty list.
  - `ok` gives `found`, with `ledgers=[path]` and `others` = plans paths minus `path`.
  - `not-found` gives `none`, with `ledgers=[]` and `others` = all plans paths.
  - `ambiguous` gives `ambiguous`, with `ledgers=candidates` and `others` = plans paths minus candidates.
  - `unattributable` gives `unattributable`, with `ledgers=[]`, `others=[]`, `unattributed=candidates` and `detail` taken from resolve.
  - `detail` is `null` except on `unattributable`. Paths are `path.join` absolute, the same form `resolveLedgerPath` returns.
- Produces: `formatLedgerReport(view) -> string`, newline-terminated.
  - First line is `claude-tweaks: resolve-ledger: {report}`, or `claude-tweaks: resolve-ledger: unattributable ({detail})`.
  - Then one `this-run: {p}` line per `ledgers` entry, one `other-run: {p}` line per `others` entry, and one `unattributed: {p}` line per `unattributed` entry, in that order.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/wrap-up/ledger-write.test.js`, importing the two new names). Reuse the file's `ownedGit`/`ownershipDeps` helpers:
  - `AC1.1: describeRunLedgers returns {run-dir}/ledger.md as found, listing every docs/plans ledger as another run's`. Deps: `existsSync` true only for `/run/ledger.md`, `readdirSync` → `['a-ledger.md','x.md']`, and `git`/`resolveBase` throwing, which proves ownership is never consulted. Expect `{ report: 'found', ledgers: [path.join('/run','ledger.md')], others: [path.join('/wt','docs','plans','a-ledger.md')], unattributed: [], detail: null }`.
  - `AC2.1: an inherited docs/plans ledger is never this run's: report none, listed as other-run`. Deps: `ownershipDeps({ readdirSync: () => ['old-ledger.md'], git: ownedGit() })`. Expect `report: 'none'`, `ledgers: []`, `others: [path.join('/wt','docs','plans','old-ledger.md')]`.
  - `AC2.1: the owned ledger is found and the inherited ones are other-run`. Use `['a-old-ledger.md','b-mine-ledger.md']`, owned `b`. Expect `ledgers` = `[…b-mine…]` and `others` = `[…a-old…]`.
  - `ambiguous names every owned candidate as this-run, the rest as other-run`. Use `a-old`, `b-mine` and `c-mine`, with `b` and `c` owned. Expect `ledgers` `[b, c]` and `others` `[a]`.
  - `AC2.1: reports unattributable where resolveLedgerPath does, with no this-run or other-run entries`. Deps: `ownershipDeps({ readdirSync: () => ['a-ledger.md'], resolveBase: () => null })`. Expect `report: 'unattributable'`, `ledgers: []`, `others: []`, `unattributed: [path.join('/wt','docs','plans','a-ledger.md')]`, and `detail` matching `/merge base unavailable/`.
  - `no docs/plans directory: none with no other-run entries`. Deps: `existsSync: () => false` and `readdirSync` that throws ENOENT. Expect `{ report: 'none', ledgers: [], others: [], unattributed: [], detail: null }`.
  - `formatLedgerReport renders the report line then this-run, other-run, unattributed lines`. Assert the exact string for one found view (`'claude-tweaks: resolve-ledger: found\nthis-run: /r/ledger.md\nother-run: /w/docs/plans/a-ledger.md\n'`) and the first line of an unattributable view (`'claude-tweaks: resolve-ledger: unattributable (boom)'`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js`
Expected: FAIL. The new tests error with `describeRunLedgers is not a function`, and the pre-existing tests still pass.

- [ ] **Step 3: Implement both functions in `plugin/bin/lib/wrap-up/ledger-write.js`** with the Interfaces signatures, and add both to `module.exports`. Leave `resolveLedgerPath` itself unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/ledger-write.js tests/bin-lib/wrap-up/ledger-write.test.js
git commit -m "Add describeRunLedgers and formatLedgerReport — the read side of resolveLedgerPath, refs #3897"
```

### Task 2: `hooks.js resolve-ledger` verb and its docs registration

**Files:**
- Modify: `plugin/bin/hooks.js`. Add a `USAGE` entry `'resolve-ledger': 'resolve-ledger --run <dir>'`, a `KNOWN_FLAGS` entry `'resolve-ledger': ['--run']`, and a `cmd === 'resolve-ledger'` branch directly after the `delete-ledger` branch. Also add `resolve-ledger` to the verb list in the header comment at lines ~95-97.
- Create: `tests/resolve-ledger-verb.test.js`. Model it on `tests/delete-ledger-verb.test.js`, copying its `git`/`runHook`/`gitRoot`/`runDirFixture` helpers.
- Modify: `docs/hooks.md` line 19. "The thirteen subcommands that accept it — …" becomes fourteen, with `resolve-ledger` added after `delete-ledger`.
- Modify: `docs/plugin-structure.md`. On line 17, add `resolve-ledger` to the subcommand list after `delete-ledger`, plus one clause: "resolve-ledger --run <dir> (#3897) is its read-only twin: prints this run's ledger (`found`/`none`/`ambiguous`/`unattributable`, then `this-run:`/`other-run:`/`unattributed:` lines) for `_shared/ledger-format.md`'s resolution rule". Change "the thirteen that accept --run (…)" to fourteen and add `resolve-ledger`. The later "is a fourteenth" becomes "is a fifteenth" (sweep-shadow), "is a fifteenth" becomes "is a sixteenth" (adopt-run-dir), and "where the other thirteen's --run never is" becomes "fourteen's". On line 24, family (5)'s "Consumed by … `delete-ledger` subcommand" gains "and `resolve-ledger` subcommands (describeRunLedgers/formatLedgerReport)".

**Interfaces:**
- Consumes: `describeRunLedgers`, `formatLedgerReport` (Task 1).
- Produces: the CLI contract `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-ledger --run "{run-dir}"`. It prints `formatLedgerReport` output and exits 0. Refusals print delete-ledger's own messages with "ledger not resolved" in place of "ledger not deleted":
  - `claude-tweaks: --run path rejected: {x} — ledger not resolved`
  - `renderCandidateRefusal('resolve-ledger', candidates)` followed by `\nLedger not resolved.`
  - `claude-tweaks: no pipeline run dir found — ledger not resolved`
- The branch resolves the run with `resolveRunArg(argv.slice(3), process.cwd(), process.env, { unambiguousOnly: true, callerIdentity })` and `reportWorktreeLocalFallback`, as `delete-ledger` does. The worktree is `ctxLib.readRunState(runDir)?.worktree || process.cwd()`.

- [ ] **Step 1: Write the failing tests** in `tests/resolve-ledger-verb.test.js`. Make `gitRoot` create its temp dir under a parent whose name contains a space (`fs.mkdtempSync(path.join(os.tmpdir(), 'ct resolve ledger '))`), which covers Review Focus 3.
  - `AC1.1: resolve-ledger returns {run-dir}/ledger.md even with no materialized header (records unresolved)`. The run dir holds only `run-state.json` and `ledger.md`, with no `work/` header. Assert stdout starts with `claude-tweaks: resolve-ledger: found\n` and includes `this-run: ${path.join(runDir,'ledger.md')}\n`, and exit code 0.
  - `AC2.1: an inherited ledger committed on main is reported as other-run, never this-run`. Commit `docs/plans/2026-08-14-old-ledger.md` on `main`, then `checkout -b feature`. Assert `resolve-ledger: none`, `other-run: …old-ledger.md`, and that `this-run:` does not match.
  - `AC2.1: an untracked owned ledger beside an inherited one: found + other-run`.
  - `two owned ledgers report ambiguous, naming both as this-run`.
  - `no --run exits 0 with "no pipeline run dir found — ledger not resolved"`.
  - `resolve-ledger leaves every ledger on disk`. After a `found` run, the ledger file still exists.
  - The `--help` case is covered automatically by `tests/hooks-help-guard.test.js`, which iterates `Object.keys(USAGE)` and checks every `cmd === '…'` branch has a USAGE entry. Do not duplicate it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/resolve-ledger-verb.test.js`
Expected: FAIL. No assertion line matches, because hooks.js does not yet dispatch `resolve-ledger`.

- [ ] **Step 3: Implement the `resolve-ledger` branch, `USAGE`/`KNOWN_FLAGS` entries and header comment in `plugin/bin/hooks.js`, then make the two docs edits listed under Files.**

- [ ] **Step 4: Run the tests to verify they pass, along with the guard suites that enumerate verbs**

Run: `node --test tests/resolve-ledger-verb.test.js tests/delete-ledger-verb.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js`
Expected: PASS.

Renumbering verification has three forms, and each must show only the new values:
- `git grep -n -e "thirteen" -- docs/hooks.md docs/plugin-structure.md` (expect no hits that name the `--run` list)
- `git grep -n -e "fourteenth" -e "fifteenth" -e "sixteenth" -- docs/plugin-structure.md` (expect sweep-shadow=fifteenth, adopt-run-dir=sixteenth)
- `git grep -n -F "resolve-ledger" -- docs/hooks.md docs/plugin-structure.md` (expect a hit in both files)

- [ ] **Step 5: Real-input probe.** Run the verb against this build's own run dir:

Run: `node plugin/bin/hooks.js resolve-ledger --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-22T100958-record-3897"`

Expected output:
- `claude-tweaks: resolve-ledger: found`
- `this-run: …/docs/plans/2026-10-22-resolve-ledger-verb-ledger.md`
- exactly three `other-run:` lines, for the `2026-10-20-*-ledger.md` files inherited from `main`

Independent count: `git ls-tree --name-only origin/main docs/plans/` should list exactly 3 `*-ledger.md` names. Record both outputs in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/resolve-ledger-verb.test.js docs/hooks.md docs/plugin-structure.md
git commit -m "Add hooks.js resolve-ledger — read-side twin of delete-ledger, refs #3897"
```

### Task 3: Repoint the resolution rule and its readers at the verb

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md` line 23 (the **Resolution rule** paragraph, rewritten as one paragraph)
- Modify: `plugin/skills/ledger/SKILL.md` lines 116 and 133. Line 65 stays byte-identical because it is pinned by `tests/flow-ledger-creation-timing-conformance.test.js:66`. Line 126 already only cites the rule.
- Modify: `plugin/skills/review/code-mode-steps.md` line 82, adding at most ~60 B (near the rail). Keep the "No ledger file found for the spec's `{feature}`" heading and the SKIP line byte-identical, because they are pinned by `tests/pr-early-run-lifecycle-step1-logging-conformance.test.js:58-61`.
- Modify: `docs/journeys/find-this-runs-ledger-outside-wrap-up-3687.md`
  - Add `plugin/bin/hooks.js` to its `files:` frontmatter.
  - Set its **Entry point** to the `hooks.js resolve-ledger --run "{run-dir}"` command and its four reports.
  - Rewrite Step 1's Action/Should feel/Should understand/Red flags around `this-run:`/`other-run:` lines and the `unattributable`/no-report-line reader fallback, replacing `value.files`/`value.unattributedFiles`.
  - In Step 4's Action, replace "If the probe fails" with "On `unattributable` or no report line".
  - Add one Origin bullet: "Repointed at `hooks.js resolve-ledger` during #3897."
- Test: `tests/ledger-reader-ownership-conformance.test.js` (rewrite)

**Interfaces:**
- Consumes: the CLI contract from Task 2.

- [ ] **Step 1: Rewrite the conformance test (red first).** Update the header comment to cite #3897. Remove `GLOB_RE`, `ALLOWED_RE`, `sentences`, `assertNoBareGlob`, `assertRuleIsProbeFirst` and their go-red tests, because the verb now decides what the sentence scan approximated. Export `{ read }` only. Add:
  - `assertRuleNamesVerb(text)`. It asserts that `text.includes('hooks.js" resolve-ledger --run "{run-dir}"')`, that each of `` `found` ``, `` `none` ``, `` `ambiguous` `` and `` `unattributable` `` appears, and that `/`other-run:` lines are other runs' ledgers — never read, flipped, or deleted as this run's/`, `/\*\*Fallback, for a reader only:\*\*/` and `/a caller that flips or deletes ledger rows or files never takes this fallback/` all match. It also asserts that `/value\.files|unattributedFiles|--print ledger/` does not match.
  - `test('AC2.1: ledger-format.md resolves this run\'s ledger through hooks.js resolve-ledger', …)` calls `assertRuleNamesVerb(read('_shared/ledger-format.md'))`.
  - The go-red control `test('go-red: the #3687 probe-based rule fails assertRuleNamesVerb', …)` runs `assertRuleNamesVerb` on a frozen `flat(...)` copy of today's line-23 opening sentence, from `**Resolution rule…(#3687):**` through `…and read its \`value.files\`.`, and expects it to throw.
  - `assertNoProbeRestatement(files)`, where `files` is `{rel: text}`. It throws naming each `rel` whose text matches `/value\.files|unattributedFiles|--print ledger/`.
  - `test('AC3.1: no ledger reader in plugin/skills outside wrap-up/ restates the probe\'s value.files / unattributedFiles handling', …)` walks `plugin/skills/**/*.md` (recursive `fs.readdirSync`), excludes `wrap-up/` (Global Constraints), and calls `assertNoProbeRestatement`.
  - Its go-red control runs `assertNoProbeRestatement({ 'ledger/SKILL.md': flat("then list every other ledger file — the probe's `value.unattributedFiles`, or on the rule's fallback the remaining matches") })` and expects a throw.
  - `test('AC3.2: every reader cites the resolution rule', …)` loops over `READERS = ['ledger/SKILL.md', 'review/code-mode-steps.md', 'wrap-up/auto-merge-short-circuit.md']` and asserts each includes `RULE_CITE`.
  - Keep the two `auto-merge short-circuit` tests verbatim.
  - Replace the two `ledger resolve` tests with `/on `none`, report `No ledger found for this run` rather than resolving another run's/` and `/on `unattributable` or no report line, report the verb's output and stop: the gate flips rows, so it never takes the rule's fallback/`.
  - Add `/list its `this-run:` ledger first, marked as this run's, then each `other-run:` ledger, marked as another run's/` for line 116.
  - Add `assert.match(read('review/code-mode-steps.md'), /hooks\.js resolve-ledger/)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ledger-reader-ownership-conformance.test.js`
Expected: FAIL after Step 1 rewrites the file (it passes today). `assertRuleNamesVerb` throws on the live `ledger-format.md`, and AC3.1 throws naming `_shared/ledger-format.md` and `ledger/SKILL.md`.

- [ ] **Step 3: Rewrite the prose.** Replace `ledger-format.md` line 23 with exactly this paragraph:

> **Resolution rule for a caller reading "the active ledger for this run" (#3687, #3897):** when a run dir resolves (`$PIPELINE_RUN_DIR` or the most-recent-matching run), run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-ledger --run "{run-dir}"` — `{run-dir}` is the run dir just resolved, never a bare `$PIPELINE_RUN_DIR` that an inferred run leaves unset. It resolves through `bin/lib/wrap-up/ledger-write.js`'s `resolveLedgerPath`, as `hooks.js delete-ledger` and `finish-console` do, and its first line names one of four reports: `found` — the `this-run:` line is this run's ledger (`{run-dir}/ledger.md` when it exists, checked first and needing no record or merge base, else the one `docs/plans/` ledger this branch owns against the merge base or holds untracked); `none` — this run has no ledger yet, not a cue to look further; `ambiguous` — the `this-run:` lines are every `docs/plans/` ledger this branch owns: a reader reads them all, and a caller that flips or deletes passes the one it means as `--ledger`; `unattributable` — ownership could not be computed (no merge base, or git failed), and the `unattributed:` lines may be another run's. `other-run:` lines are other runs' ledgers — never read, flipped, or deleted as this run's (once the branch has merged, its own ledger reads as one of them). **Fallback, for a reader only:** on `unattributable`, or output with no report line (the verb refused its `--run`), read the `docs/plans/*-ledger.md` glob, knowing it also matches other runs' ledgers; a caller with no run dir at all uses that glob only, since there is no run to attribute ownership to. When a run dir resolves, a caller that flips or deletes ledger rows or files never takes this fallback: it stops, as `resolveLedgerPath` fails closed, since acting on an inherited ledger destroys another run's record. An append (a new row, or Create's already-exists check) takes the fallback as written.

Rewrite `ledger/SKILL.md` line 116 to: "1. Find the ledgers: when a run dir resolves for this invocation (`$PIPELINE_RUN_DIR`, or the most-recent-matching run), resolve this run's own per `_shared/ledger-format.md`'s resolution rule and list its `this-run:` ledger first, marked as this run's, then each `other-run:` ledger, marked as another run's — never as this run's; on the rule's reader fallback, list the glob's matches as ledgers this run cannot attribute. With no run dir at all, the `docs/plans/*-ledger.md` glob is the complete listing (the rule's no-run-dir fallback)."

In line 133, replace the clause from "— when the rule finds none" to "never takes the rule's fallback." with: "— on `none`, report `No ledger found for this run` rather than resolving another run's; on `ambiguous`, list the `this-run:` ledgers and ask which one; on `unattributable` or no report line, report the verb's output and stop: the gate flips rows, so it never takes the rule's fallback."

In `review/code-mode-steps.md` line 82, change "(per `_shared/ledger-format.md`'s resolution rule)" to "(per `_shared/ledger-format.md`'s resolution rule — `hooks.js resolve-ledger`)".

- [ ] **Step 4: Run the tests to verify they pass, with every suite that pins these files**

Run: `node --test tests/ledger-reader-ownership-conformance.test.js tests/flow-ledger-creation-timing-conformance.test.js tests/pr-early-run-lifecycle-step1-logging-conformance.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/deferral-gate-conformance.test.js tests/absence-grep-control-check-prose.test.js tests/flow-claim-preflight.test.js tests/staged-patch-contract.test.js tests/ledger-pipe-escape-rule-conformance.test.js tests/deferred-live-verification-ac-class.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/wrap-up/pack.test.js`
Expected: PASS.

Then check size: `wc -c plugin/skills/review/code-mode-steps.md plugin/skills/_shared/ledger-format.md`. Expect code-mode-steps ≤ 48,330 B and ledger-format below its pre-change 36,737 B.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md plugin/skills/review/code-mode-steps.md tests/ledger-reader-ownership-conformance.test.js docs/journeys/find-this-runs-ledger-outside-wrap-up-3687.md
git commit -m "Repoint the ledger resolution rule and its readers at hooks.js resolve-ledger, refs #3897"
```

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 (run-dir `ledger.md` returned even when records unresolved) | Task 1 `AC1.1` test, Task 2 `AC1.1` test |
| AC2.1 (never returns an inherited ledger as this run's, and reports unattributable where resolveLedgerPath does) | Task 1 `AC2.1` tests, Task 2 `AC2.1` tests, Task 3 `AC2.1` rule pin |
| AC3.1 (no reader outside wrap-up/ restates `value.files`/`unattributedFiles`) | Task 3 `AC3.1` scan and go-red control |
| AC3.2 (each reader cites the rule) | Task 3 `AC3.2` test |
| AC4.1 (`npm test` passes) | Common Step 5 full suite (`verify.js`) |
