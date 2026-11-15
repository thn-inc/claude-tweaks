# Settle 7 digest findings in docs (#4811) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the seven below-floor `docs` findings promoted from digest #1426. Two are fixed in place. Five are closed out with a recorded reason.

**Architecture:** Task 1 corrects one `docs/skill-graph.md` row and adds the graph row to the removal note in `plugin/skills/_shared/multi-agent-coordination.md`. Task 2 adds the missing `- **URL:**` line to each of the four steps in one journey. Task 3 makes no file edits. It re-checks the five registry-driven "not updated" flags against the flagged range and produces the disposition list the orchestrator posts on #4811.

**Tech Stack:** Markdown docs and skill prose; `node --test` via `npm test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T065743-record-4811/work/4811-spec.md` (materialized from GitHub issue #4811)

## Global Constraints

- Commit messages use `{Verb} {what} — {detail}`: imperative, no conventional-commit prefix, ending `refs #4811` (never `closes`/`fixes`).
- Scope: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Docs only: no `plugin/bin/**` changes, and no test files. No test pins any sentence edited here (`grep -rn "both verdicts side by side\|Remove that prefix" tests` finds nothing), and no test reads journey step bullets.
- Size: `plugin/skills/_shared/multi-agent-coordination.md` is 14,203 B against `RAIL_BYTES` 52,500 B. Task 1 adds about 90 B.
- Governing skills: none apply. The `.claude/skills/*` files that name `docs/skill-graph.md` or `_shared/multi-agent-coordination.md` (`review-console-section-addition`, `shared-contract-extraction`, `policy-key-addition`, `lib-module-split` and others) cite them as registration sites for adding a section, key, contract or module. This plan adds none of those. It corrects one row's wording and extends one removal note, and it moves no staged prefix between console sections.
- Waived AC2.1: already satisfied before this build, so no task changes #1426.
- AC2 ("each promoted entry line in #1426 carries this record's ref") already holds. All 7 lines, across digest comments 6540311142, 6544730256 and 6545562270, end `→ #4811`. No task touches #1426.

## Review Focus

1. The graph row must still name both prefixes. `/release`'s disposition (`plugin/skills/release/disposition.md:40`) and the Review Console (`plugin/bin/lib/console/resolve.js:110`) still read `review-debate-`. Dropping the prefix from the row would hide a live reader.
2. The removal note's new clause must name the graph row precisely enough that whoever retires the prefix finds it: the file, the `## release` section, and the row's target.
3. Journey URL lines must name a real entry location (a file and section that exist), not a web URL. This journey has no browser surface. Task 2 Step 2 checks each cited path exists.
4. Each of the five no-change dispositions must name the specific evidence relied on (file:line or the range commit), so a reader can re-check it without redoing the investigation.
5. The skill-graph table must keep its column count. A stray `|` inside the new cell would split it. Task 1 Step 2 checks the row's pipe count.

---

### Task 1: Correct the release → debate-and-refutation graph row and its removal note

**Role:** transcription

**Files:**
- Modify: `docs/skill-graph.md:495` (the `## release` table row whose target is `` `review/step3-debate-and-refutation.md` ``)
- Modify: `plugin/skills/_shared/multi-agent-coordination.md:156` (the last two sentences of the paragraph starting "These are `review/step3-debate-and-refutation.md`'s three lines")

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks use.

- [ ] **Step 1: Replace the graph row.** In `docs/skill-graph.md`, replace exactly this line:

```
| `review/step3-debate-and-refutation.md` | Step 8's disposition inventories `staged/review-contested-{n}.md` and `staged/review-debate-{n}.md` — both verdicts side by side — and routes each. |
```

with:

```
| `review/step3-debate-and-refutation.md` | Step 8's disposition inventories `staged/review-contested-{n}.md` — the one file this step writes, both verdicts side by side — and routes each. It still reads `staged/review-debate-{n}.md` too, an older run's file nothing writes now; `_shared/multi-agent-coordination.md`'s Decision-log entry format note says when that read is removed. |
```

- [ ] **Step 2: Check the row shape.**

Run: `grep -n "^| \`review/step3-debate-and-refutation.md\` |" docs/skill-graph.md | awk -F'|' '{print NF-1}'`
Expected: one line printing `3` (three pipes: two cells). Run once on the pre-edit text while authoring: printed `3`.

- [ ] **Step 3: Extend the removal note.** In `plugin/skills/_shared/multi-agent-coordination.md`, replace exactly:

```
Remove that prefix from both, and this sentence, once `.claude-tweaks/pipelines/` and its `archive/` hold no such file.
```

with:

```
Remove that prefix from both, the sentence naming it in `docs/skill-graph.md`'s `## release` row for `review/step3-debate-and-refutation.md`, and this sentence, once `.claude-tweaks/pipelines/` and its `archive/` hold no such file.
```

- [ ] **Step 4: Verify both edits landed (AC1.1 for the skill-graph finding).**

Run: `grep -c "the one file this step writes" docs/skill-graph.md` then `grep -c "docs/skill-graph.md\`'s \`## release\` row" plugin/skills/_shared/multi-agent-coordination.md`
Expected: `1` and `1`.

- [ ] **Step 5: Commit**

```bash
git add docs/skill-graph.md plugin/skills/_shared/multi-agent-coordination.md
git commit -m "Correct the release graph row for debate staging — review-debate- is legacy-read only, and the removal note now lists the graph row, refs #4811"
```

### Task 2: Add URL lines to the run-a-github-only-skill journey

**Role:** transcription

**Files:**
- Modify: `docs/journeys/run-a-github-only-skill-without-a-worktree-2727.md` (steps 1–4 under `## Steps`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Insert one `- **URL:**` bullet as the first bullet of each step**, directly above that step's `- **Action:**` line. Leave every other line untouched. Exact text:

  - Step 1 (`### 1. Read the scoped banner …`):
    `` - **URL:** the SessionStart banner (`plugin/bin/lib/hooks/session-start.js`) in a `worktree-always` main checkout. ``
  - Step 2 (`### 2. Check the skill's own note …`):
    `` - **URL:** the invoked skill's **Worktree** / **No worktree** note, which cites `_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree" paragraph. ``
  - Step 3 (`### 3. Run with no worktree …`):
    `` - **URL:** the invoked skill's own write steps, run from the main checkout (`gh`, the run directory, the `health-state` ref). ``
  - Step 4 (`### 4. Enter a worktree only at the first local write …`):
    `` - **URL:** `_shared/worktree-setup.md`'s `## Adopt-or-create` (for `/claude-tweaks:tidy`, `tidy/step-7-5-worktree-always.md`). ``

- [ ] **Step 2: Verify the count and the cited paths (AC1.1 for the journey finding).**

Run: `grep -c "^- \*\*URL:\*\*" docs/journeys/run-a-github-only-skill-without-a-worktree-2727.md`
Expected: `4`

Run: `ls plugin/bin/lib/hooks/session-start.js plugin/skills/_shared/worktree-setup.md plugin/skills/tidy/step-7-5-worktree-always.md`
Expected: all three listed, no "No such file".

Run: `grep -c "Forge-API-only invocations need no worktree" plugin/skills/_shared/worktree-setup.md`
Expected: `1` or more.

- [ ] **Step 3: Commit**

```bash
git add docs/journeys/run-a-github-only-skill-without-a-worktree-2727.md
git commit -m "Add URL lines to the github-only-skill journey — each step names its entry point, refs #4811"
```

### Task 3: Re-verify the five registry-flag close-outs (no file edits)

**Role:** judgment

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/donts.md`
- Modify: `docs/hooks.md`
- Modify: `docs/skill-authoring.md`
- Each is modified only if Step 2 finds a statement the range made false. The expected outcome is no edit.
- Read: `docs/REGISTRY.md` (Step 1, for each doc's Auto-detect pattern).

**Interfaces:**
- Produces: the disposition list below. The orchestrator posts it as one comment on #4811. The implementer commits nothing unless Step 2 finds a fix.
- AC evidence: the orchestrator writes the Step 1–2 command output to `$PIPELINE_RUN_DIR/evidence/registry-flag-closeouts.txt` (plain Bash redirect, absolute run-dir path, after `mkdir -p`). It then logs one `decisions.md` entry via `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {file}`, naming AC1 ("Each deliverable is fixed, or closed out with its reason recorded on this record") for the five flags, the command shape, and the five dispositions.

- [ ] **Step 1: Confirm each flag is a registry auto-detect hit.** Run `git diff --name-only v6.157.2 8951db932` and check that each doc's `docs/REGISTRY.md` Auto-detect pattern matches at least one changed path. That is the only reason each was flagged.
- [ ] **Step 2: Verify no statement went stale (AC1.1 for the five registry flags).** For each doc, read the range diff of its auto-detect paths (`git diff v6.157.2 8951db932 -- {paths}`). Grep the doc for every term those hunks changed: `demo:`, `accept:`, `resume`, `catch-up`, `case arm`, `esac`, `control-mode`, `parent-gate`, `acceptance-gap`. Confirm each disposition below. If a doc does carry a statement the range made false, fix it in place under the scope rule, commit it with `refs #4811`, and change that line's disposition to "fixed".
- [ ] **Step 3: Report the final list** (no commit unless Step 2 found a fix).

**Disposition list (expected result):**

- `README.md`: closed, no stale statement. A high-level overview that names no `/dispatch` forms and no `/build` steps. Its `demo:pending` lines (`README.md:87`, `:95`) still hold, because every writer still adds `demo:*` until #4613 (`plugin/skills/_shared/work-record.md:54`). #4588's `resume #N` and #4343's catch-up live in the skills and in `docs/getting-started.md`.
- `CLAUDE.md`: closed, no stale statement. It cites the `_shared` contracts it depends on (`autonomy-ceiling.md`, `github-write-transport.md`, `integration-model.md`, `issue-claims.md`, …) without restating any clause the range changed. The range added no Task-dispatch site to the Subagent Contract roster.
- `docs/donts.md`: closed, no stale statement. The `git-command.js` change in range (#4486, case-arm cwd join) touches no Don't. The file has no scanner case-arm rule.
- `docs/hooks.md`: closed, no stale statement. `docs/hooks.md:15` defers the cd-walk reading to `_shared/policy-schema-coverage.md`'s "Where a relative target resolves" paragraph, which #4486 updated in the same commit (`ab2f50978`). No repo doc still lists "a case arm whose pattern does not match" as a known gap.
- `docs/skill-authoring.md`: closed, no stale statement. The range's skill-prose changes were feature/fix content. No authoring convention (structure, frontmatter, interaction patterns, CSC, `${CLAUDE_PLUGIN_ROOT}`, untrusted text) changed. Project-skill guidance moved with its own `.claude/skills/*` files.

### Task 4: Final verification (run centrally by the orchestrator)

**Files:** none.

- [ ] **Step 1:** `/claude-tweaks:build` Common Step 5 runs the project's verification through `skills/test/verification.md` (the runner, i.e. `npm test`). Expected: runner exit 0 with a pass stamp verifying HEAD.
