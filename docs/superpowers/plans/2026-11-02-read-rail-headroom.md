# Read-Rail Headroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `plugin/skills/review/step3-lens-dispatch.md` and `plugin/skills/build/SKILL.md` each at least 2,000 B under the 52,500 B Read rail by moving one cohesive section of each into a lazy-loaded sub-file.

**Architecture:** Two pointer-stub splits. `build/SKILL.md`'s Spec Step 2.5 probe-and-triage procedure (read only when a spec has a `## Manual Steps` section or wholly operational Deliverables — most builds take the skip line) moves to `plugin/skills/build/manual-steps.md`. `step3-lens-dispatch.md`'s `## Post-fan-out untracked-file sweep` section (read after the fan-out, never before dispatch; already run from three places: the lens fan-out at `low`/`medium`, `step3-debate-and-refutation.md`'s closing step at `high`+, and Step 3.7's tiebreak re-run) moves to `plugin/skills/review/step3-fanout-sweep.md`, and every citer is retargeted to the new file directly.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T101852-record-4826/work/4826-spec.md` (record #4826)

## Global Constraints

- Read rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Target per AC1.1: each of the two files ≤ 50,500 B. Baselines at merge base `d5c6a1d70`: `step3-lens-dispatch.md` 52,386 B, `build/SKILL.md` 52,235 B.
- No byte pin in any test: `tests/skill-size-single-source.test.js` fails the suite if a test asserts a skill file's size outside `budgets.js` (decision 0024). AC1.1 is evidenced by a recorded `wc -c`, not a test.
- `build/SKILL.md` must keep exactly 7 `**On skip**` occurrences (`tests/build-skip-degrade-trace-adoption.test.js:84`) and keep the literal `**No Manual Steps section (skip):** write one \`SKIP\` entry` (same file, line 67). Do not write `**On skip**` in the stub.
- Pointer phrasing: a sub-file is cited as "read `{file}` in this skill's directory" — the form `plugin/bin/lib/skill-audit/load.js`'s citation extraction resolves.
- Moved prose is moved verbatim except for deictic references that change meaning across the file boundary (listed per task).
- `.claude/skills/shared-contract-extraction/SKILL.md` (quoted, applies to these pointer-stub splits): "**A pointer stub's read condition must cover every path that used to fall through to the moved text.** Inline text is read on every path that reaches that point in the file; a stub is read only when its stated condition holds. Key the condition on an event ("once the write call has run") and any path where that event never happens loses the moved text with no error. List the paths that reach the split point — including the ones that do nothing — and name each in the stub and in the sibling's header."
- Same skill, step 3: "retarget any test that pins the moved text itself (a byte-pinned snippet, a prose-literal assertion — not a prose-citation pin, which survives the stub untouched) to the new file per `skill-prose-conformance-tests`' "Retargeting existing pins" convention … Cross-reference `docs/plugin-structure.md`'s per-skill sub-file table as a registration site alongside step 4's `docs/skill-graph.md`."
- Commit subjects: `{Verb} {what} — {detail}`, body line `refs #4826` (never `closes`/`fixes`).

## Review Focus

- A `high`+ review following `step3-debate-and-refutation.md`'s closing step must land on the sweep procedure, not a stub that sends it back — the debate file cites `step3-fanout-sweep.md` directly (Task 2 test `citers name step3-fanout-sweep.md`).
- A `low`-tier review that dispatched no lens (both 3b/3c skipped for prose-only diffs) still reaches the stub: its read condition is "before returning to Step 3 Routing", an event every path hits (Task 2 test `stub read condition`).
- A record with no `## Manual Steps` section but wholly operational Deliverables (#2554) must still be routed into the sub-file, not to the skip line (Task 1 test `stub routes the wholly operational case`).
- `ledger/SKILL.md`'s Create callers list keeps pointing at the sentence that actually creates the ledger (Task 1 test `ledger cites manual-steps.md`).
- `docs/plugin-structure.md`'s build row must list `manual-steps.md` or `tests/build-dispatch-subfile-table-completeness.test.js` goes red (Task 1 Step 4 runs it).

---

### Task 1: Move build Spec Step 2.5's triage into `manual-steps.md`

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/skills/build/manual-steps.md`
- Modify: `plugin/skills/build/SKILL.md:96-117` (Spec Step 2.5 body)
- Modify: `plugin/skills/ledger/SKILL.md:54` (Create's caller list cites `build/SKILL.md` Spec Step 2.5's "If the ledger doesn't exist, create it")
- Modify: `plugin/skills/build/operational-checklist.md:42` (Common Step 5.5 says "apply the Step 2.5 triage (auto-executable / auth-gap / truly manual)" — a second reader of the moved triage, reached by builds that took the skip line)
- Modify: `docs/plugin-structure.md:106` (build row: file list + one description clause)
- Test: `tests/build-manual-steps-split-conformance.test.js` (new)
- No change (classified): `plugin/skills/build/build-options.md` line 39's "(Step 2.5 auto-executable-command confirmation)" and `plugin/skills/specify/spec-template.md` line 217's "Classified at build start (Step 2.5)" still name the step correctly.

**Moved-prose pins (grep `tests/` and `plugin/` for the moved block's phrases — `Auth-gap`, `Truly manual`, `wholly operational`, `CLI/API check`, `user-declined`, `If the ledger doesn't exist, create it`):** no test pins any of them; the plugin hits outside the moved file are `ledger/SKILL.md:54` and `operational-checklist.md:42`'s "the Step 2.5 triage" (both listed above — `operational-checklist.md:58-59`'s own `**Auth-gap items**`/`**Truly manual items**` bullets are its ledger-format rules, not a citation, and stay). `tests/build-skip-degrade-trace-adoption.test.js` pins only the skip line, which stays in SKILL.md.

**Interfaces:**
- Produces: `plugin/skills/build/manual-steps.md`, heading `# Spec Step 2.5 — Classify and Seed Manual Steps`, holding (verbatim from SKILL.md) the "If the spec has a "Manual Steps" section…" paragraph, the `**No Manual Steps section, but every \`## Deliverables\` item is operational (#2554).**` paragraph, the Parallel execution note, the three-step probe list with the Auto-executable / Auth-gap / Truly manual triage bullets (incl. the `ops=confirm` token rule), "If the ledger doesn't exist, create it using the ledger skill's create operation.", and the `**Anti-pattern:**` paragraph. A short header under the title states who reads it: `/build` Spec Step 2.5, when the spec has a `## Manual Steps` section or every `## Deliverables` item is operational (the skip path stays in SKILL.md); and Common Step 5.5 (`operational-checklist.md`), which applies the same triage to its operational findings on every build that reaches it.

- [ ] **Step 1: Write the failing test** `tests/build-manual-steps-split-conformance.test.js`, style of `tests/build-already-shipped-exit.test.js` (`readText` from `./helpers/read-skill`). One factored `missing(texts)` function returns the list of failed facts; the positive test asserts it is `[]`, and go-red controls run the same function on mutated text.
  - `AC2.1: stub routes the Manual Steps case` — the `### Spec Step 2.5` section of SKILL.md (slice to `### Spec Step 3`) matches /read `manual-steps\.md` in this skill's directory/ (lowercase `read`, as the stub is written) and /## Manual Steps/.
  - `Step 5.5 cites manual-steps.md` — `operational-checklist.md` matches /read `manual-steps\.md` in this skill's directory and apply its triage/ and no longer includes `apply the Step 2.5 triage`.
  - `stub routes the wholly operational case` — the same section matches /every `## Deliverables` item is operational/ and /\(#2554\)/.
  - `skip line stays` — the same section matches /\*\*No Manual Steps section \(skip\):\*\* write one `SKIP` entry/.
  - `triage moved` — the same section does not include `**Auth-gap**`, `**Truly manual**`, or `**Anti-pattern:** Seeding the entire Manual Steps section`; `manual-steps.md` includes all three, plus `(reason-not-auto: user-declined)`, `**\`ops=confirm\` token:**`, and `If the ledger doesn't exist, create it using the ledger skill's create operation.`
  - `ledger cites manual-steps.md` — `plugin/skills/ledger/SKILL.md` matches /`build\/manual-steps\.md`'s "If the ledger doesn't exist, create it"/.
  - Go-red controls: (a) SKILL.md text with the `read \`manual-steps.md\` in this skill's directory` phrase removed → `missing()` non-empty; (b) `manual-steps.md` text with the `**Auth-gap**` bullet removed → `missing()` non-empty; (c) `operational-checklist.md` text with its `read \`manual-steps.md\` in this skill's directory and apply its triage` phrase reverted to `apply the Step 2.5 triage` → `missing()` non-empty. Each control first asserts the replacement changed the text.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-manual-steps-split-conformance.test.js`
Expected: FAIL (manual-steps.md does not exist; ENOENT or the "read `manual-steps.md`" match fails)

- [ ] **Step 3: Make the split**
  - Create `manual-steps.md` per Interfaces, the moved paragraphs byte-for-byte. Deictic fixes in the moved text: "the same probe-then-triage procedure below" stays (the procedure still follows it in the new file); "fall through to the ordinary per-step SKIP/execute behavior below instead" → "fall through to the ordinary per-step SKIP/execute behavior in `SKILL.md` instead".
  - Replace SKILL.md's Spec Step 2.5 body (from "If the spec has a "Manual Steps" section" through the `**Anti-pattern:**` paragraph) with exactly this text, keeping the existing `**No Manual Steps section (skip):** …` paragraph after it unchanged:

    ```markdown
    When the spec has a `## Manual Steps` section, or has none but every `## Deliverables` item is operational (#2554) — dispatching a deploy workflow, triggering a job through an API, applying infrastructure, verifying a live result, with no source file changes — read `manual-steps.md` in this skill's directory and follow it: it probes each item for a CLI and credentials, then executes, seeds, or escalates it. Otherwise — no Manual Steps section, and at least one Deliverable touches the codebase — take the skip line below.
    ```
  - `operational-checklist.md:42`: "Then, for each finding below, apply the Step 2.5 triage (auto-executable / auth-gap / truly manual):" → "Then, for each finding below, read `manual-steps.md` in this skill's directory and apply its triage (auto-executable / auth-gap / truly manual):".
  - `ledger/SKILL.md:54`: replace `` `build/SKILL.md` Spec Step 2.5's "If the ledger doesn't exist, create it" still does `` with `` `build/manual-steps.md`'s "If the ledger doesn't exist, create it" still does — Spec Step 2.5's triage ``.
  - `docs/plugin-structure.md:106` build row: append `, manual-steps.md` to the file list (after `plan-review.md`) and append to the description `; manual-steps.md holds Spec Step 2.5's Manual Steps probe-and-triage procedure (CLI/credential probes, auto-executable / auth-gap / truly-manual triage, the `ops=confirm` rule, the #2554 wholly-operational case), read only when the spec has a Manual Steps section or wholly operational Deliverables — SKILL.md keeps the read condition and the skip line, moved out for Read-rail headroom (#4826)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-manual-steps-split-conformance.test.js tests/build-skip-degrade-trace-adoption.test.js tests/build-dispatch-subfile-table-completeness.test.js`
Expected: PASS (all tests)

Run: `wc -c plugin/skills/build/SKILL.md`
Expected: ≤ 50,500 (≈ 48,900 B)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/manual-steps.md plugin/skills/build/SKILL.md plugin/skills/build/operational-checklist.md plugin/skills/ledger/SKILL.md docs/plugin-structure.md tests/build-manual-steps-split-conformance.test.js
git commit -m "Move build Spec Step 2.5 triage into manual-steps.md — Read-rail headroom" -m "refs #4826"
```

---

### Task 2: Move review's post-fan-out sweep into `step3-fanout-sweep.md`

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/skills/review/step3-fanout-sweep.md`
- Modify: `plugin/skills/review/step3-lens-dispatch.md:160-177` (the `## Post-fan-out untracked-file sweep` section)
- Modify: `plugin/skills/review/step3-debate-and-refutation.md:152` (closing-step paragraph)
- Modify: `plugin/skills/review/step3-tiebreak.md:33`
- Modify: `plugin/skills/review/step3-cross-lens-corroboration.md:20`
- Modify: `plugin/skills/review/step3-routing.md:158`
- Modify: `plugin/skills/review/review-summary-template.md:14-105` (lines 14 and 105 only)
- Modify: `docs/skill-graph.md:532` ("The post-fan-out sweep's leftover-listener check (`step3-lens-dispatch.md`)")
- Modify: `docs/plugin-structure.md:109` (review row)
- Modify (retarget pins): `tests/multi-agent-coordination.test.js:19,1477-1501`, `tests/review-lens-no-suites-conformance.test.js:127-135`, `tests/review-tiebreak-step-conformance.test.js:1039,1145-1158`, `tests/bin-lib/review-context/prose.test.js:101-106`
- Test: `tests/review-fanout-sweep-split-conformance.test.js` (new)
- Waived `docs/journeys/keep-review-lenses-from-running-suites-3001.md`, `docs/journeys/run-a-review-from-a-worktree-isolated-session-2956.md`: they name "the post-fan-out sweep" without a file path; no change.
- Waived `tests/review-lens-shell-discipline-conformance.test.js`, `tests/review-tiebreak-step-conformance.test.js:563`: they use `'## Post-fan-out sweep'` only as the end anchor of the debate file's Gap-Sweep section, whose heading stays.

**Moved-prose pins** (`git grep -n -F` over `tests` and `plugin` for `## Post-fan-out untracked-file sweep`, `Review fan-out left`, `Leftover-listener check`, `Agent-scratch cleanup check`, `untracked-files=all`, `Fan-out leftovers`, `post-fan-out sweep`): the four test files under Modify (retarget pins) above, plus the plugin citers listed under Modify. `REVIEW_SKILL` in `tests/multi-agent-coordination.test.js:19` concatenates `SKILL.md`, `step3-lens-dispatch.md`, `step3-debate-and-refutation.md` — add `step3-fanout-sweep.md` to that list so the sweep-shape test keeps finding its text.

**Interfaces:**
- Produces: `plugin/skills/review/step3-fanout-sweep.md`, heading `# Post-fan-out untracked-file sweep — /claude-tweaks:review`, holding the moved section's four parts verbatim (the when-to-run paragraph, the Procedure paragraph with its three bullets and the never-delete paragraph, `**Leftover-listener check.**` with its bullets and never-kill paragraph, `**Agent-scratch cleanup check.**`). A header paragraph under the title names its three readers (the paths that used to reach the inline section): `step3-lens-dispatch.md`'s stub, before Step 3 Routing at every tier; `step3-debate-and-refutation.md`'s closing step at `high`+; `step3-tiebreak.md`'s re-run after its last wave.
- The `## Post-fan-out untracked-file sweep` heading survives only as the stub heading in `step3-lens-dispatch.md`; the new file's H1 title starts `# Post-fan-out untracked-file sweep`.

- [ ] **Step 1: Write the failing test** `tests/review-fanout-sweep-split-conformance.test.js`, same style as Task 1's test, one factored `missing(texts)` function:
  - `AC2.1: stub read condition` — `step3-lens-dispatch.md` has a line starting `## Post-fan-out untracked-file sweep` followed by a paragraph matching /Before returning to Step 3 Routing/ and /read `step3-fanout-sweep\.md` in this skill's directory/; the file no longer includes `**Leftover-listener check.**` or `**Agent-scratch cleanup check.**`.
  - `sweep moved` — `step3-fanout-sweep.md` includes `**Leftover-listener check.**`, `**Agent-scratch cleanup check.**`, `git status --porcelain --untracked-files=all`, and `STAGED {HH:MM:SS} — Review fan-out left {n} untracked file(s): {paths}. Not deleted. Reversibility: n/a.`
  - `citers name step3-fanout-sweep.md` — each of `step3-debate-and-refutation.md` (its `## Post-fan-out sweep (this file's own closing step)` section), `step3-tiebreak.md`, `step3-cross-lens-corroboration.md`, `step3-routing.md` (the `**Post-dispatch diff audit (mandatory).**` paragraph), `review-summary-template.md` includes `` `step3-fanout-sweep.md` ``; and none of those five files includes any of the old citation literals `` `step3-lens-dispatch.md`'s Post-fan-out ``, `` `step3-lens-dispatch.md`'s post-fan-out ``, ``sweep (`step3-lens-dispatch.md`)``, or `` `step3-lens-dispatch.md` defines the post-fan-out `` (exact substrings — a looser regex would match the debate file's new "…sweep procedure, and `step3-lens-dispatch.md`'s `build` call…" sentence).
  - Go-red controls: (a) the stub's `read \`step3-fanout-sweep.md\`` sentence removed → non-empty; (b) the tiebreak citation reverted to `` `step3-lens-dispatch.md`'s Post-fan-out untracked-file sweep `` → non-empty.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-fanout-sweep-split-conformance.test.js`
Expected: FAIL (step3-fanout-sweep.md does not exist)

- [ ] **Step 3: Make the split**
  - Create `step3-fanout-sweep.md` per Interfaces. Deictic fixes in the moved text: "comparing against the pre-dispatch listing captured above (`{ctx-dir}/pre-dispatch-status.txt`)" → "comparing against the pre-dispatch listing `step3-lens-dispatch.md`'s `build` call captured (`{ctx-dir}/pre-dispatch-status.txt`)"; "this file's own Step 3 reproduction/single-read dispatch is the only fan-out" → "`step3-lens-dispatch.md`'s own Step 3 reproduction/single-read dispatch is the only fan-out"; "skip running it here **only if" → "skip running it from `step3-lens-dispatch.md`'s stub **only if"; "run the sweep here instead rather than skipping it silently" → "run the sweep from that stub instead rather than skipping it silently". "The `{ctx-dir}` exclusion above", "an untracked leftover above", "the untracked-file diff above" stay (still above, within the new file).
  - Replace `step3-lens-dispatch.md`'s whole section body (lines 162-177) with one line under the kept `## Post-fan-out untracked-file sweep` heading:

    ```markdown
    Before returning to Step 3 Routing — at every tier, whether or not a lens was dispatched, and at `medium` after the cross-lens corroboration pass — read `step3-fanout-sweep.md` in this skill's directory: it decides whether the sweep runs now or at `step3-debate-and-refutation.md`'s closing step, and holds the untracked-file, leftover-listener, and agent-scratch checks.
    ```
  - Retarget citers (minimal edits, rest of each sentence unchanged):
    - `step3-debate-and-refutation.md:152`: "`step3-lens-dispatch.md` defines the post-fan-out untracked-file sweep procedure, and its `build` call writes" → "`step3-fanout-sweep.md` defines the post-fan-out untracked-file sweep procedure, and `step3-lens-dispatch.md`'s `build` call writes"; "that file's own sweep only runs itself at `low`/`medium` tier" → "the lens fan-out only runs the sweep itself at `low`/`medium` tier".
    - `step3-tiebreak.md:33`: "`step3-lens-dispatch.md`'s Post-fan-out untracked-file sweep" → "`step3-fanout-sweep.md`'s post-fan-out untracked-file sweep".
    - `step3-cross-lens-corroboration.md:20`: "(`step3-lens-dispatch.md`)" → "(`step3-fanout-sweep.md`)".
    - `step3-routing.md:158`: "the post-fan-out untracked-file sweep (`step3-lens-dispatch.md`)" → "the post-fan-out untracked-file sweep (`step3-fanout-sweep.md`)".
    - `review-summary-template.md:14`: "post-fan-out sweep (`step3-lens-dispatch.md`)" → "post-fan-out sweep (`step3-fanout-sweep.md`)"; line 105: "`step3-lens-dispatch.md`'s post-fan-out sweep" → "`step3-fanout-sweep.md`'s post-fan-out sweep".
    - `docs/skill-graph.md:532`: "(`step3-lens-dispatch.md`)" after "leftover-listener check" → "(`step3-fanout-sweep.md`)".
    - `docs/plugin-structure.md:109` review row: insert `step3-fanout-sweep.md` after `step3-lens-dispatch.md` in the file list, and after the clause ending "and the 3a-3f lens definitions;" insert " the post-fan-out untracked-file sweep (`step3-fanout-sweep.md` — the untracked-file diff, leftover-listener check, and agent-scratch cleanup check, read before Step 3 Routing and re-run by Step 3.7; moved out of step3-lens-dispatch.md for Read-rail headroom, #4826);".
  - Retarget test pins:
    - `tests/multi-agent-coordination.test.js:19`: add `'step3-fanout-sweep.md'` to the `REVIEW_SKILL` file list; rename the test at 1477 to `step3-fanout-sweep.md defines the post-fan-out untracked-file sweep (#2022, #4826)` and change its first assertion to match /^# Post-fan-out untracked-file sweep — \/claude-tweaks:review$/m (the new file's H1 — a bare /# Post-fan-out…/ would still match the stub's `## ` heading in step3-lens-dispatch.md and prove nothing); update the message strings that say "step3-lens-dispatch.md must define …" to name `step3-fanout-sweep.md`.
    - `tests/review-lens-no-suites-conformance.test.js:128`: `section(read('review', 'step3-lens-dispatch.md'), '## Post-fan-out untracked-file sweep')` → `read('review', 'step3-fanout-sweep.md')` (the whole file is the sweep).
    - `tests/review-tiebreak-step-conformance.test.js:1039`: regex → /After the last wave, re-run `step3-fanout-sweep\.md`'s post-fan-out untracked-file sweep against the same pre-dispatch listing/; lines 1145-1158: `SWEEP_HEADING` → `'# Post-fan-out untracked-file sweep'` checked against `readText` of `plugin/skills/review/step3-fanout-sweep.md` (add a `SWEEP` path constant beside `STEP3`), test names "the cited post-fan-out sweep file's heading exists" / "… can go red"; the go-red strip replaces that heading line.
    - `tests/bin-lib/review-context/prose.test.js:101-106`: read the cleanup line from `step3-fanout-sweep.md` (add a `FANOUT_SWEEP` constant beside `LENS_DISPATCH`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-fanout-sweep-split-conformance.test.js tests/multi-agent-coordination.test.js tests/review-lens-no-suites-conformance.test.js tests/review-tiebreak-step-conformance.test.js tests/bin-lib/review-context/prose.test.js tests/review-lens-shell-discipline-conformance.test.js tests/review-dispatched-reviewer-degrade-conformance.test.js`
Expected: PASS (all tests)

Run: `git grep -n -F "step3-lens-dispatch.md\`'s Post-fan-out" -- plugin docs ":!docs/plans" ":!docs/superpowers/plans"`
Expected: no output (exit 1). `tests/` is deliberately out of scope: the new test's go-red control carries the old literal. Control (run at authoring, exclusions per #4579): `git grep -n -F "step3-lens-dispatch.md\`'s Post-fan-out" d5c6a1d70 -- plugin docs tests` printed exactly `d5c6a1d70:plugin/skills/review/step3-tiebreak.md:33:After the last wave, re-run …`.

Run: `wc -c plugin/skills/review/step3-lens-dispatch.md`
Expected: ≤ 50,500 (≈ 48,500 B)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-fanout-sweep.md plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/step3-debate-and-refutation.md plugin/skills/review/step3-tiebreak.md plugin/skills/review/step3-cross-lens-corroboration.md plugin/skills/review/step3-routing.md plugin/skills/review/review-summary-template.md docs/skill-graph.md docs/plugin-structure.md tests/multi-agent-coordination.test.js tests/review-lens-no-suites-conformance.test.js tests/review-tiebreak-step-conformance.test.js tests/bin-lib/review-context/prose.test.js tests/review-fanout-sweep-split-conformance.test.js
git commit -m "Move review post-fan-out sweep into step3-fanout-sweep.md — Read-rail headroom" -m "refs #4826"
```

---

### Task 3: Record AC1.1 evidence

**Role:** transcription

**Files:**
- Waived `plugin/skills/review/step3-lens-dispatch.md`, `plugin/skills/build/SKILL.md`: read only (measured by `wc -c`).

Waived AC1.1: a byte pin outside `budgets.js` is forbidden (`tests/skill-size-single-source.test.js`, decision 0024) — evidenced by this task's recorded `wc -c` instead.

AC2.1's full `npm test` pass is `/build` Common Step 5's verification run through `verify.js`; Tasks 1-2 cover its conformance-suite half.

- [ ] **Step 1: Capture the measurement** (run dir is `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T101852-record-4826`, written `{run}` here — always spelled out literally in commands):

Run: `mkdir -p "{run}/evidence"`, then `wc -c plugin/skills/review/step3-lens-dispatch.md plugin/skills/build/SKILL.md > "{run}/evidence/ac1-wc.txt"`
Expected: both counts ≤ 50,500.

- [ ] **Step 2: Log it** — Write a one-line text file in the session temp dir with the Write tool: `AC1.1 (each file at least 2,000 B under 52,500): wc -c plugin/skills/review/step3-lens-dispatch.md plugin/skills/build/SKILL.md → {N1} / {N2} B, both ≤ 50,500 — pass 2/2; full output {run}/evidence/ac1-wc.txt`, then run `node "{plugin-root}/bin/log-decision.js" --run "{run}" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}" --reversibility n/a`.
Expected: one `- AUTO … AC evidence …` line printed.
