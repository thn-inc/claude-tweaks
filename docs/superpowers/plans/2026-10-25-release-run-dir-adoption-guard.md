# Release Run-Dir Adoption Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/claude-tweaks:release` Step 0's inline `node -e` adoption guard into `hooks.js resolve-run-dir`'s step 2. Every `--spec-slug` caller then refuses a terminal, `release-standalone` or unreadable run directory, and a guard crash can no longer fall through to adoption.

**Architecture:** `run-dir-resolve.js` gains one exported predicate, `adoptionRefusal(dir)`. It reads `run-state.json` once and returns why step 2 must not adopt the directory, or `null`. `newestMatch` skips every directory with a non-null refusal and moves on to the next-newest match, the way it already skips a dead one (#1962). Step 1 (`PIPELINE_RUN_DIR`) is unchanged, so a directory a parent pipeline hands down is still never refused. Release Step 0 collapses to the resolver call plus its existing standalone mint, the same shape as `wrap-up/SKILL.md`'s.

**Tech Stack:** Node 18+ CommonJS (`plugin/bin/lib/hooks/`), `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T144531-record-4151/work/4151-spec.md` (record #4151)

## Global Constraints

- Adoption refusal lives in `resolve-run-dir`'s step 2 (`plugin/bin/lib/hooks/run-dir-resolve.js`), so every `--spec-slug` caller gets it.
- An unreadable or unparseable `run-state.json` means "refuse adoption", never "adopt".
- `release/SKILL.md` contains no inline `node -e` adoption probe.
- An *absent* `run-state.json` is still adoptable. It is the bare mkdir-only mint shape (`/dispatch` Step 4, `flow/claim-targets.md`), and #1962's `isDeadRunDir` contract keeps it adoptable.
- Step 1's `PIPELINE_RUN_DIR` directory is never subject to the refusal: #3898 AC4.1's inherited-directory exemption is preserved structurally, because step 1 returns before step 2 runs.
- Terminal = any string `status` outside `run-integrity.js`'s `NON_TERMINAL` (`active`, `interrupted`). A missing or non-string `status` is not terminal, which is the same predicate the retired probe used.
- `run-dir-resolve.js` must not `require('./run-integrity')` at module top level. The chain `context.js → run-dir-resolve.js → run-integrity.js → context.js` would be a load-time cycle. Read `NON_TERMINAL` with a lazy `require` inside the function.
- Commit messages: `{Verb} {what} — {detail}`, with `refs #4151`, never `closes`/`fixes`, ending with the line `Claude-Session: https://claude.ai/code/session_01WHZKSKSJSRRccHhdLJgrru`.
- `plugin/skills/release/SKILL.md` is 49,911 B against the 52,500 B rail (`plugin/bin/lib/skill-audit/budgets.js`). This change must shrink it, which removing two long `node -e` lines does. Record the `wc -c` result in the commit body.

## Review Focus

- A `run-state.json` that is valid JSON but not an object (`null`, `[]`, `"x"`) must be refused like unparseable text, not adopted and not a crash. Pinned in Task 1.
- A `run-state.json` path that exists but cannot be read (a directory named `run-state.json`, giving `EISDIR`) must be refused, not treated as absent. Pinned in Task 1.
- A refused newest match must not hide an older adoptable match: step 2 falls through to it (the same as #1962's dead-skip). Pinned in Task 1.
- The release mint line must never adopt: an adoptable (absent-state) `release` directory present at mint time must not be returned by the mint and then overwritten by the `printf` stamp. Pinned in Task 2 (the mint go-red re-inserts `--spec-slug`).
- A run directory name containing a shell metacharacter (`'`) must still round-trip through the fence. Pinned in Task 2 (the `o'brien` row).

---

### Task 1: `resolve-run-dir` step 2 refuses terminal, release-standalone and unreadable directories

**Files:**
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js` (add `adoptionRefusal` near `isDeadRunDir` at :82-98; `newestMatch` :116-128 uses it; export it at :287)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` (the "No flags: steps 1-2 only" bullet, ~line 25)
- Modify: `plugin/skills/_shared/run-dir-resolution.md` (resolution-order step 2, line 15)
- Test: `tests/hooks-run-dir-resolve.test.js` (append)

**Interfaces:**
- Produces: `adoptionRefusal(dir: string): null | 'unreadable-run-state' | 'release-standalone' | 'terminal' | 'dead'`, exported from `run-dir-resolve.js`. `newestMatch` adopts a candidate only when this returns `null`. Check order: unreadable, then `createdBy === 'release-standalone'`, then terminal status, then dead (the existing `isDeadRunDir` logic, `interrupted` or an `active` run whose stamped worktree is gone). `isDeadRunDir`'s own exported behavior is unchanged, so a malformed file is still "not dead". Its comment gains one sentence saying step 2 refuses that case through `adoptionRefusal` instead.
- Consumes: `NON_TERMINAL` from `./run-integrity` (lazy `require`, see Global Constraints).

- [ ] **Step 1: Write the failing tests** (append to `tests/hooks-run-dir-resolve.test.js`, reusing its `gitRepo`/`mkRunDir`/`writeRunState`; import `adoptionRefusal` alongside `isDeadRunDir`)
  - `'#4151 AC1.1: adoptionRefusal names each refusal reason'`. Each fixture is a fresh dir:
    - `{status:'clean'}` → `'terminal'`
    - `{status:'closed'}` → `'terminal'`
    - `{status:'active',createdBy:'release-standalone'}` → `'release-standalone'`
    - `{createdBy:'release-standalone'}` → `'release-standalone'`
    - raw text `'{not json'` → `'unreadable-run-state'`
    - raw `'null'` → `'unreadable-run-state'`
    - raw `'[]'` → `'unreadable-run-state'`
    - `run-state.json` created as a *directory* (EISDIR) → `'unreadable-run-state'`
    - `{status:'interrupted'}` → `'dead'`
    - `{status:'active'}` → `null`
    - `{}` → `null`
    - `{status:5}` → `null`
    - `{status:'active',createdBy:'flow'}` → `null`
    - no file at all → `null`
  - `'#4151 AC1.1: --spec-slug release never returns a terminal release dir'`: the only dir is `2026-10-01T100000-release-standalone` with `{status:'clean',createdBy:'release-standalone'}`. `resolve({cwd:main, env:{}, specSlug:'release'})` → `ok:false`, `reason:'unresolved'`.
  - `'#4151 AC1.1: --spec-slug release never returns an active release-standalone dir'`: the same with `{status:'active',createdBy:'release-standalone'}` → `ok:false`.
  - `'#4151 AC1.1: --spec-slug release never returns a dir whose run-state.json cannot be parsed'`: `2026-10-01T100000-release` with raw `'{not json'` → `ok:false`.
  - `'#4151: a refused newest match falls through to an older adoptable one'`: older `2026-01-01T000000-record-77` (no run-state) and newer `2026-06-01T000000-record-77` `{status:'clean'}`. `resolve({specSlug:'record-77'})` → `ok:true`, `path === older`.
  - `'#4151: step 1 PIPELINE_RUN_DIR is never refused, even when terminal and release-standalone'`: dir `2026-10-02T100000-supplied` with `{status:'clean',createdBy:'release-standalone'}`. `resolve({cwd:main, env:{PIPELINE_RUN_DIR:dir}, specSlug:'release'})` → `ok:true`, `path` realpath-equals `dir`.
  - `'#4151: --create --standalone with --spec-slug mints fresh past a refused match'`: a clean `2026-01-01T000000-record-88`. `resolve({specSlug:'record-88', standalone:'record-88', create:true, now:new Date('2026-06-01T12:00:00Z')})` → `created:true`, basename `2026-06-01T120000-record-88-standalone`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-run-dir-resolve.test.js`
Expected: FAIL. `adoptionRefusal` is not a function, and the terminal, release-standalone and unparseable resolve cases return `ok:true`.

- [ ] **Step 3: Implement `adoptionRefusal(dir)` in `run-dir-resolve.js` and use it in `newestMatch`**

Read `run-state.json` with `fs.readFileSync`. On `ENOENT` return `null`. Any other read error, a `JSON.parse` failure, or a parsed value that is not a plain object (`null`, an array, a primitive) returns `'unreadable-run-state'`. Factor the body of `isDeadRunDir` into a `deadState(state)` helper so `adoptionRefusal` reuses the already-parsed state, and keep `isDeadRunDir(dir)` as `deadState(readRunStateSafe(dir))`. The header comment cites #4151 and #3898 and states why an unreadable file refuses (a crash must never read as "adopt"). `newestMatch`'s loop condition becomes `adoptionRefusal(dir) === null`. Update its comment, which currently names only #1962's dead skip.

- [ ] **Step 4: Run the tests to verify they pass, and prove they discriminate**

Run: `node --test tests/hooks-run-dir-resolve.test.js`
Expected: PASS, every test.
Then, temporarily, change `newestMatch` back to `if (!isDeadRunDir(dir)) return dir;`, re-run, confirm the three `#4151 AC1.1: --spec-slug release ...` tests and the fall-through test go red, and restore. Quote the red output in the report. Do not commit the revert.

- [ ] **Step 5: Update the two `_shared` contracts**
  - `pipeline-run-dir.md`, the "No flags: steps 1-2 only" bullet. Append one sentence: step 2 never adopts a directory whose status is terminal, that carries `createdBy: "release-standalone"`, that is dead (`interrupted`, or `active` with its stamped worktree gone), or whose `run-state.json` exists but cannot be read as a JSON object. It skips such a directory for the next-newest match (`adoptionRefusal`, #1962/#4151). An absent `run-state.json` (a bare mint) is still adopted, and step 1's `PIPELINE_RUN_DIR` directory is never refused.
  - `run-dir-resolution.md`, resolution-order step 2. Append: "`resolve-run-dir` additionally refuses an unadoptable match (`_shared/pipeline-run-dir.md`'s No-flags bullet); the Bash snippet below keeps only the name match, which is one more reason call sites run the command, not the snippet."
  - Run `node --test tests/pipeline-run-dir-adoption-anchoring.test.js tests/hooks-resolve-run-dir-cli.test.js tests/hooks-archive-terminal.test.js tests/flow-resume-adoption-check.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/wrap-up-merge-mode-conformance.test.js tests/bin-lib/run-liveness/index.test.js`. Expected: PASS (baseline at HEAD 45e4b7c5e: these plus the two release/resolve suites were 172/172 green).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/run-dir-resolve.js tests/hooks-run-dir-resolve.test.js plugin/skills/_shared/pipeline-run-dir.md plugin/skills/_shared/run-dir-resolution.md
git commit -m "Refuse unadoptable run dirs in resolve-run-dir step 2 — terminal, release-standalone and unreadable run-state.json (refs #4151)"
```

### Task 2: Release Step 0 is the CLI call alone; conformance test moves to the new contract

**Files:**
- Modify: `plugin/skills/release/SKILL.md:55-74` (the Step 0 fence and the "Determine inherited-vs-created" paragraph)
- Modify: `tests/release-run-dir-lifecycle-conformance.test.js:26-342` (the Step 0 half. The Step 8 / disposition / roster half from :344 on is untouched)
- Modify: `docs/skill-graph.md:471` (the `bin/hooks.js archive-run` row of the `## release` table)
- Modify: `docs/journeys/release-a-version.md:54` (the Step 0 action line)

**Interfaces:**
- Consumes: Task 1's step-2 refusal, reached through the real `node plugin/bin/hooks.js resolve-run-dir` CLI that the fence runs.
- Produces: the new Step 0 fence, exactly:

```bash
RUN_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug release 2>/dev/null)
if [ -z "$RUN_DIR" ]; then
  # Steps 1-2 found nothing (step 2 itself refuses a terminal, release-standalone or unreadable directory, #4151),
  # or step 1's adoption-time anchoring check rejected a worktree-trapped PIPELINE_RUN_DIR ([IL-127]) — clear
  # PIPELINE_RUN_DIR for this second call so a rejected value is never re-consulted, then mint the standalone fallback.
  RUN_DIR=$(PIPELINE_RUN_DIR= node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --standalone release --create)
  printf '{"status":"active","createdBy":"release-standalone"}\n' > "$RUN_DIR/run-state.json"
fi
echo "$RUN_DIR"
```

- [ ] **Step 1: Rewrite the Step 0 half of the conformance test (failing against the current SKILL.md)**
  - Delete the probe-text machinery: `GUARD_LINE_PREFIX`, `extractGuard`, `runGuard`, `CREATED_BY_DISJUNCT`/`dropCreatedByDisjunct`, the three guard tests (`AC1.1: Step 0 guard classifies…`, its go-red, `AC2.1: …flipped predicate…`), `revertToEmptinessExemption`, `dropExemption` and their two go-red tests, and the twice-run go-red that uses `dropCreatedByDisjunct`. Keep the `PRE_CHANGE_STEP0`/`ADOPT_ANY` test unchanged.
  - Fence-level row table, `'#4151 AC1.1: the Step 0 fence adopts or refuses each step-2 run-state'`. Per row: a fresh `initRepo()` and one dir `.claude-tweaks/pipelines/2026-10-01T100000-release{suffix}` holding the row's `run-state.json` (or none). Run `resolveFence(STEP_ZERO)` with `PIPELINE_RUN_DIR` unset, and assert `adopt` → the single printed line realpath-equals the fixture; `refuse` → it does not, and the printed dir sits under the pipelines root. Rows (`{suffix}` empty unless noted):
    - `clean` refuse
    - `closed` refuse
    - `active` adopt
    - `interrupted` refuse
    - absent file adopt
    - `'not json'` refuse
    - `'null'` refuse
    - `{"status":"clean"}` in suffix `-o'brien-run` refuse
    - `{}` adopt
    - `{"status":5}` adopt
    - active+`release-standalone` refuse
    - interrupted+`release-standalone` refuse
    - active+`createdBy:"flow"` adopt
    - no-status+`release-standalone` refuse
  - `assertMintIsFresh` now seeds an *adoptable* dir (`2026-10-01T100000-release`, no `run-state.json`) instead of a finished one, and asserts the mint never returns it. The existing `AC1.1: Step 0 mint go-red: re-inserting --spec-slug…` test stays, with its expected message unchanged (`/re-adopted/`), and now goes red because step 2 adopts that dir.
  - End-to-end, PIPELINE_RUN_DIR-exempt, stale-PIPELINE_RUN_DIR and run-twice tests: keep them, but the fence now prints exactly **one** line. Drop every `refused:` line assertion and assert instead that the printed dir is not the prior dir and that exactly one new directory was minted.
  - `'#4151 AC2.1: Step 0 carries no inline node -e adoption probe'`: one function `assertNoInlineProbe(text)` = `assert.doesNotMatch(text, /node -e/)`, run on `STEP_ZERO`. Its go-red runs the same function on a frozen `PRE_CHANGE_GUARD` constant (the current line 60, copied verbatim) and expects it to throw.
  - Replace `REQUIRED`. Each regex matches exactly once in Step 0, which keeps `assertEachPatternGoesRed` valid:
    - `/the only directory never subject to step 2's adoption refusal/`
    - `/an archived run-id, falls through to step 2 and is checked like any step-2 directory\)/`
    - ``/except the `FAILED` lines `bookkeeping\.md` and `disposition\.md` hand-compose/`` (unchanged)
    - ``/status is terminal, or that carries `createdBy: "release-standalone"` whatever its status/``
    - ``/whose `run-state\.json` exists but cannot be read/``
    - `/the fallback then mints a fresh directory, and the run is \*\*created\*\*/`
    - `/neither terminal nor stamped by a release run/`
    - ``/it already skips an `interrupted` one/``
    - ``/carried `\{run-dir\}` path[\s\S]{0,200}mint a stray one/`` (unchanged)
    - ``/could hand back an existing directory, which the `printf` stamp would then overwrite/``

  Drop the `ENV_RUN_DIR` and `not adopted; minted` facts.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js`
Expected: FAIL after Step 1. The `#4151 AC2.1` probe test matches `node -e`, the fence prints a second `refused:` line, and the new `REQUIRED` facts are missing.

- [ ] **Step 3: Rewrite Step 0 in `release/SKILL.md`**
  - Replace the fence with the Interfaces block above.
  - Rewrite the "**Determine inherited-vs-created here, once.**" paragraph so it carries every new `REQUIRED` fact:
    - The resolver returned a directory → **inherited**. That directory is either the one `$PIPELINE_RUN_DIR` names (the only directory never subject to step 2's adoption refusal — a stale value, a missing directory or an archived run-id, falls through to step 2 and is checked like any step-2 directory), or a step-2 directory that is neither terminal nor stamped by a release run, whose `run-state.json` is `active` or absent.
    - `resolve-run-dir`'s step 2 refuses, and moves past, a directory whose status is terminal, or that carries `createdBy: "release-standalone"` whatever its status (#3898: a prior release run's own directory, which a later release must never reuse — one that stopped early is still `active`), or whose `run-state.json` exists but cannot be read (#4151). It already skips an `interrupted` one.
    - The fallback then mints a fresh directory, and the run is **created**.
    - The mint call omits `--spec-slug` on purpose: with it, `resolve-run-dir` re-runs step 2 and could hand back an existing directory, which the `printf` stamp would then overwrite.
    - Delete the `refused:` second-line sentence and the `AUTO … not adopted; minted {run-dir}` log-line sentence. Keep the trailing "Carry that verdict … never re-read it from disk later …" sentences verbatim.
  - Keep line 72's paragraph verbatim. Its "re-running it would now refuse this run's own directory and mint a stray one" is still true, because the resolver refuses a `release-standalone` dir.
  - Leave Step 8's "Step 0 refuses it" phrases (`:292`) and the Anti-Patterns row (`:363`) as they are. They stay true, since Step 0's resolver call is what refuses.
  - Run `wc -c plugin/skills/release/SKILL.md`. Expected: below 49,911.

- [ ] **Step 4: Run the test to verify it passes, and prove the new tests discriminate**

Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js tests/hooks-run-dir-resolve.test.js`
Expected: PASS.
Then, temporarily revert Task 1's `newestMatch` line to `if (!isDeadRunDir(dir)) return dir;`, re-run the release suite, confirm the `clean`/`closed`/`not json`/`release-standalone` rows of the `#4151 AC1.1` row table go red, and restore. Quote the red output. Do not commit the revert.

- [ ] **Step 5: Update the two docs that restate Step 0**
  - `docs/skill-graph.md:471`: "Step 0 refuses a step-2 directory that is terminal or carries…" becomes "Step 0's `resolve-run-dir --spec-slug release` call refuses (step 2, #4151) a directory that is terminal, carries…, or whose `run-state.json` cannot be read…". Keep the rest of the sentence.
  - `docs/journeys/release-a-version.md:54`: drop the "logs `Step 0: … not adopted; minted {new dir}`" clause. Say that the refusal now happens inside `resolve-run-dir`, which also refuses a directory whose state file is unreadable.
  - Grep `git grep -n -F -e "not adopted; minted" -e "REFUSED_DIR" -e "refused: {dir}" -- plugin tests docs ':!docs/superpowers/plans' ':!docs/plans'` → expected: no hits.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/release/SKILL.md tests/release-run-dir-lifecycle-conformance.test.js docs/skill-graph.md docs/journeys/release-a-version.md
git commit -m "Replace release Step 0's inline adoption probe with the resolve-run-dir call alone — the refusal now lives in step 2 (refs #4151)"
```

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 `#4151 AC1.1` resolver tests; Task 2 `#4151 AC1.1` fence row table |
| AC2.1 | Task 2 `#4151 AC2.1: Step 0 carries no inline node -e adoption probe` |
| AC3.1 | Task 2 Step 1 (the conformance test is rewritten to the new contract) |
| AC4.1 | Waived AC4.1: the full `npm test` is the build's Common Step 5 verification, not a task step |

## As-built deviations (build Common Step 4.5)

| # | Deviation | What the spec said | What was built | Classification |
|---|---|---|---|---|
| 1 | Wrap-up re-resolution migrated | Key Files: `run-dir-resolve.js`, `release/SKILL.md`, the conformance test | Also `wrap-up/SKILL.md`, `cleanup-procedures-execution.md`, `standalone-fast-path.md`, `curation-engine.md`, `summary-template.md`. Later wrap-up phases carry the Phase 1 run-dir path and never re-run the resolver. Without that, after `close-run` writes `status: clean`, step 2 would refuse the run's own directory. Found by the whole-branch review and fixed in `5d13f444a`. | Beneficial. Deliverable 1 ("so every caller gets it") requires every caller that re-resolves after a close to migrate in the same change. |
| 2 | Release Step 0 no longer names the refused directory | Silent | The `refused: {dir} (status …)` stdout line and the `Step 0: … not adopted; minted {run-dir}` log line are gone. A refusal now happens inside `resolve-run-dir`, so the CLI-only fence (Deliverable 3) cannot see which directory was refused. | Beneficial. This is a direct consequence of Deliverable 3, and the step-2 skip is pinned by tests. |
| 3 | Absent vs unreadable state | "Treat an unreadable or unparseable `run-state.json` as refuse adoption" | Only an existing-but-unreadable/unparseable/non-object file refuses. An absent file stays adoptable, because it is the bare mkdir-only mint shape `/dispatch` and `/flow` rely on (#1962). | Beneficial (a reading of the spec, not a contradiction). |
