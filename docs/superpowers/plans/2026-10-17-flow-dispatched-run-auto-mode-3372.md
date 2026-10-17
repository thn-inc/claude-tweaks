# Dispatch-bound /flow runs resolve to auto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:flow` Step 1 resolves a run whose anchored run dir carries `run-state.json` `dispatched: true` to `auto`, regardless of the `auto-mode` policy, below an explicit mode keyword.

**Architecture:** Prose-only change to the skill corpus plus one new `node --test` prose pin. Step 1's mode list gains rung 2 (dispatch binding); the Manifesto names the source; the shared contract, its card copy, the policy-schema row, the #3225 journey and the skill-graph edge carry the exception.

**Tech Stack:** Markdown skill files; `node --test` (`node:test`, `node:assert/strict`).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T195535-record-3372/work/3372-spec.md`

## Global Constraints

- Rung order is exactly: explicit keyword → dispatch binding → `auto-mode` policy → intrinsic `auto`.
- Fall-through cases named explicitly, none stops the run: `PIPELINE_RUN_DIR` unset; run dir fails the `$RUN_ROOT` anchoring check; `run-state.json` missing or unparseable; `dispatched` absent or not `true`.
- No `decisions.md` write at Step 1. The Manifesto (Step 3) names the source instead.
- `tests/auto-mode-scope-conformance.test.js` stays green: the policy-schema meaning cell must still match `` /`default-off`\s*→\s*`interactive`/ `` and still mention `/flow`.
- Every edited `plugin/skills/**/*.md` stays under 50 KB (`flow/SKILL.md` is 45,731 bytes at base; the addition is ~1 KB).
- Commit subjects `{Verb} {what} — {detail}`, body `refs #3372` (never `closes`/`fixes`), trailer `Claude-Session: https://claude.ai/code/session_0158obubrbV684svgERrnjUV`.

## Review Focus

- A dispatched agent running from inside its worktree passes a worktree-local `PIPELINE_RUN_DIR` (`[IL-127]` shadow): the read must print nothing. Probed at authoring time against `.claude/worktrees/dispatch-record-3372/.claude-tweaks/pipelines/…` → empty output.
- `PIPELINE_RUN_DIR` passed as the empty string (unset): must print nothing, not resolve `""` to cwd. Probed → empty output.
- Explicit `interactive` on a dispatch-bound run must still win — pinned by rung order (Task 1 test).
- An anchored, non-dispatched run (e.g. a `*-sweep-standalone` run dir): prints nothing. Probed → empty output.
- A moved rung (above rung 1) must turn the pin red — covered by Task 1's synthetic go-red test.

---

### Task 1: Step 1 dispatch-binding rung + Manifesto source

**Files:**
- Create: `tests/flow-dispatched-run-auto-mode.test.js`
- Modify: `plugin/skills/flow/SKILL.md` (Step 1 item 1's mode list, lines 116-119)
- Modify: `plugin/skills/flow/manifesto.md` (`## Source values` table, ~line 127-135)

**Interfaces:**
- Produces: test helpers `step1(text)`, `rungs(section) -> [{n, text}]`, `kind(text) -> 'keyword'|'dispatch'|'policy'|'intrinsic'|null` in the new test file; Task 2 appends tests to the same file using a local `read(...parts)` helper.

- [ ] **Step 1: Write the failing test** (covers AC1.1, AC2.1, AC2.2, AC3.1, AC3.2, AC4.1, AC6.2) — `tests/flow-dispatched-run-auto-mode.test.js`, live-file reads (the prose is the contract — `skill-prose-conformance-tests` declared-contract carve-out), CRLF-normalized, following `tests/dispatch-flow-explicit-auto-mode.test.js`'s shape:
  - `step1(text)`: slice from `### Step 1: Validate Input` to `### Step 2:`; throw if either is missing.
  - `rungs(section)`: lines after the line containing `**Resolve the mode**`, collecting `/^   (\d+)\. (.*)$/` matches until the first line matching `/^\d+\. /` (Step 1's next top-level item).
  - `kind(t)`: `keyword` if `/^Explicit mode keyword/`; `dispatch` if `/^\*\*Dispatch binding → `auto`\*\*/`; `policy` if `/^`auto-mode` policy/`; `intrinsic` if `/^\*\*Intrinsic default → `auto`\.\*\*/`; else `null`.
  - Test `synthetic: kind order flags a missing or misplaced dispatch rung` — fixture A (keyword, policy, intrinsic) maps to `['keyword','policy','intrinsic']` ≠ expected; fixture B (dispatch line first, then keyword, policy, intrinsic) maps to `['dispatch','keyword','policy','intrinsic']` ≠ expected. Expected = `['keyword','dispatch','policy','intrinsic']`.
  - Test `flow/SKILL.md Step 1 lists the four mode rungs in order`: `rungs(...).map(r => kind(r.text))` deepStrictEqual expected; `.map(r => r.n)` deepStrictEqual `['1','2','3','4']`.
  - Test `the dispatch-binding rung names its source, anchoring, and every fall-through case`: rung 2 text matches each of `` /`run-state\.json`/ ``, `` /`dispatched: true`/ ``, `` /`\$RUN_ROOT`/ ``, `` /`_shared\/pipeline-run-dir\.md`/ ``, `` /`PIPELINE_RUN_DIR` unset/ ``, `` /fails the `\$RUN_ROOT` anchoring check/ ``, `` /missing or unparseable `run-state\.json`/ ``, `` /`dispatched` absent or not `true`/ ``, `/falls through to rung 3/`, `/never stops the run/`, `` /Log nothing to `decisions\.md` here/ ``.
  - Test `manifesto.md names the dispatch binding as the Mode source`: a line starting `` | `dispatch` | `` exists exactly once and contains `auto (dispatched run)` and `source: dispatch binding`.

- [ ] **Step 2: Run test to verify it fails** (covers AC6.1 — base `flow/SKILL.md` has no rung, so this run is the reverted-rung proof)

Run: `node --test tests/flow-dispatched-run-auto-mode.test.js`
Expected: FAIL (live order is `['keyword','policy','intrinsic']`; no `` | `dispatch` | `` row)

- [ ] **Step 3: Insert rung 2 in `plugin/skills/flow/SKILL.md` Step 1 and renumber the policy/intrinsic rungs to 3/4.** Insert after the `1. Explicit mode keyword …` line, exact text:

```
   2. **Dispatch binding → `auto`** (#3372). When `$PIPELINE_RUN_DIR` is set, resolves under `$RUN_ROOT` (`_shared/pipeline-run-dir.md`'s anchoring check, the rule Step 3's adoption applies, `[IL-127]`), and its `run-state.json` parses with `dispatched: true` (stamped by `/claude-tweaks:dispatch`'s `record-worktree --dispatch`), the mode is `auto` — whatever the `auto-mode` policy says. One fail-open read prints `dispatched` or nothing: `node -e 'try{const r=process.argv[2];if(r){const t=require(process.argv[1]+"/bin/lib/stage-item/write.js").resolveTarget({runDir:r});if(t.ok&&JSON.parse(require("fs").readFileSync(t.dir+"/run-state.json","utf8")).dispatched===true)console.log("dispatched")}}catch{}' "${CLAUDE_PLUGIN_ROOT}" "$PIPELINE_RUN_DIR"`. Any other outcome falls through to rung 3 unchanged and never stops the run: `PIPELINE_RUN_DIR` unset, a run dir that fails the `$RUN_ROOT` anchoring check, a missing or unparseable `run-state.json`, or `dispatched` absent or not `true`. Log nothing to `decisions.md` here — Step 3's adoption check tolerates only claim-log lines before the Manifesto, so the Manifesto's Mode row names this source instead (`manifesto.md`'s Source values).
```

Then `2. \`auto-mode\` policy` → `3.`; `3. **Intrinsic default → \`auto\`.**` → `4.`, and change its tail "auto unless a param or `auto-mode: default-off` lowers it." to "auto unless a param or `auto-mode: default-off` lowers it (never on a dispatch-bound run — rung 2)." The `node -e` was run once at authoring time against the live run dir (prints `dispatched`), a worktree-local shadow, `""`, and a non-dispatched sweep run (all print nothing).

- [ ] **Step 4: Add the `dispatch` source row to `plugin/skills/flow/manifesto.md`'s `## Source values` table** (after the `` `policy` `` row), exact text:

```
| `dispatch` | Mode only — `SKILL.md` Step 1's dispatch-binding rung (`run-state.json` `dispatched: true`). Render the Mode row's Recommended as `auto (dispatched run)` and log `AUTO {time} — Manifesto: mode auto (source: dispatch binding, run-state.json dispatched: true). Reversibility: n/a.` |
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/flow-dispatched-run-auto-mode.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
git add tests/flow-dispatched-run-auto-mode.test.js plugin/skills/flow/SKILL.md plugin/skills/flow/manifesto.md
git commit -m "Add /flow Step 1 dispatch-binding mode rung — a dispatched run resolves auto under auto-mode: default-off"
```
(body `refs #3372` + Claude-Session trailer)

### Task 2: Carry the exception through the contract, card, policy row, journey and skill graph

**Files:**
- Modify: `plugin/skills/_shared/auto-mode-contract.md:44` (`interactive` row) and `:46` (Default note)
- Modify: `plugin/skills/_shared/auto-mode-card.md:12` (`interactive` row — mirror of the contract row)
- Modify: `plugin/skills/_shared/policy-schema.md:111` (`auto-mode` row, meaning cell)
- Modify: `docs/journeys/recover-from-a-dispatch-config-deny-3225.md` (lines 55 and 58, and its update-history list ~line 73)
- Modify: `docs/skill-graph.md:237` (`record-worktree --dispatch` row)
- Test: `tests/flow-dispatched-run-auto-mode.test.js` (append)

**Interfaces:**
- Consumes: the test file from Task 1.

- [ ] **Step 1: Append failing tests** (covers AC5.1, AC5.2)
  - `auto-mode-contract.md interactive row and Default note state the dispatched-run exception`: the one line starting `` | `interactive` | `` contains `` `dispatched: true` `` and matches `` /an explicit `interactive` arg still wins/ ``; the line starting `**Default note:**` contains `` `default-off` ``, `` `dispatched: true` `` and matches `/an explicit mode keyword still outranks the binding/`.
  - `auto-mode-card.md interactive row mirrors the exception`: its `` | `interactive` | `` line contains `` `dispatched: true` ``.
  - `policy-schema.md auto-mode meaning cell states the exception`: split the `` | `auto-mode` | `` row on `/(?<!\\)\|/`, cell 5 contains `` `dispatched: true` `` and still matches `` /`default-off`\s*→\s*`interactive`/ ``.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-dispatched-run-auto-mode.test.js`
Expected: FAIL (the 3 new tests)

- [ ] **Step 3: Edit the contract.** `interactive` row "When set" cell becomes: ``Explicit `interactive` arg, or `auto-mode: default-off` in `.claude-tweaks/policy.yml` — except a `/flow` run whose run dir is bound `dispatched: true` (`run-state.json`), which resolves `auto`; an explicit `interactive` arg still wins there``. Append to the Default note: `` Exception (#3372): `default-off` does not lower a `/flow` run whose anchored run dir's `run-state.json` is bound `dispatched: true` — that run resolves `auto` (`flow/SKILL.md` Step 1's dispatch-binding rung), a mechanical backstop beside dispatch's explicit `auto` token; an explicit mode keyword still outranks the binding. ``

- [ ] **Step 4: Mirror the contract's `interactive` row cell into `auto-mode-card.md:12`** (same text).

- [ ] **Step 5: Edit `policy-schema.md`'s `auto-mode` meaning cell**: after `` `default-off` → `interactive` `` insert `` (never for a `/flow` run whose run dir is bound `dispatched: true`, which resolves `auto`) ``.

- [ ] **Step 6: Journey + skill graph.** Journey line 55: replace "Without it, the call would resolve to `interactive`, which skips Step 3 entirely, and the remedy above could never be satisfied." with "Without it, `/flow` Step 1's dispatch-binding rung (#3372) still resolves the run to `auto`, because its `run-state.json` carries `dispatched: true`." Journey line 58 red flag becomes: "a dispatched call that still resolves to `interactive`. Only an explicit `interactive` token can do that now (#3372); it skips the Manifesto, and every commit stays denied." Add a history bullet after line 73: "- Updated during build of #3372: `/flow` Step 1 treats a run bound `dispatched: true` as `auto` regardless of `auto-mode`, so a dispatched agent that drops the `auto` token no longer lands here. Pinned by `tests/flow-dispatched-run-auto-mode.test.js`." Skill-graph row 237: append "Since #3372 `/flow` Step 1 also reads the same `dispatched: true` marker as a mode-resolution rung (dispatch-bound → `auto`), so renaming or dropping that field must update the rung and `tests/flow-dispatched-run-auto-mode.test.js`."

- [ ] **Step 7: Run tests** (AC7.1's full `npm test` runs centrally at Common Step 5)

Run: `node --test tests/flow-dispatched-run-auto-mode.test.js tests/auto-mode-scope-conformance.test.js tests/dispatch-flow-explicit-auto-mode.test.js tests/auto-mode-flow-two-stop-budget.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/_shared/auto-mode-contract.md plugin/skills/_shared/auto-mode-card.md plugin/skills/_shared/policy-schema.md docs/journeys/recover-from-a-dispatch-config-deny-3225.md docs/skill-graph.md tests/flow-dispatched-run-auto-mode.test.js
git commit -m "State the dispatched-run auto exception in the auto-mode contract, policy row and journey"
```
(body `refs #3372` + Claude-Session trailer)
