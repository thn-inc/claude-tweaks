# Flow Mixed-Execution Convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document how a spec built outside `/claude-tweaks:flow` rejoins a multi-spec run, and warn that closing the parent run before its consolidated wrap-up forfeits that wrap-up.

**Architecture:** One canonical `## Mixed execution (a spec built outside /flow)` section in `plugin/skills/flow/multi-spec.md`; a one-sentence pointer to it from `plugin/skills/wrap-up/SKILL.md`'s detect-from-context block; the wrap-up → `/flow` edge in `docs/skill-graph.md` extended to name it; one `node --test` prose-conformance suite pinning all three.

**Tech Stack:** Markdown skill prose; `node --test` (built-in `node:test` + `node:assert/strict`).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T215318-record-3033/work/3033-spec.md` (record #3033)

## Global Constraints

- Uses existing mechanics only — no new CLI, flag, step, or wrap-up mode.
- Skill references in instruction text use the fully qualified `/claude-tweaks:{skill}` form (CLAUDE.md Cross-references).
- `wrap-up/SKILL.md` gets exactly one sentence; do not restate the convention there (record Deliverable 3, Gotcha 4). Measure `wc -c plugin/skills/wrap-up/SKILL.md` before and after.
- Do not describe `close-run`'s `close-without-wrapup` advisory as a guard (record Gotcha 3).
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3033` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01BVy2D3grDpN7kAiPKwrry8`.
- Every regex that crosses a line uses `\r?\n`; token checks run over whitespace-collapsed text (`s.replace(/\s+/g, ' ')`) [IL-66].

## Premise correction (verified at build — logged `premise reversed:` in decisions.md)

The record's Deliverable 1/2(b) assumed a fresh `/claude-tweaks:flow #B test` "is its own single-spec run with its own wrap-up and Review Console". Traced against the shipped procedures, that is not what happens while the parent multi-spec run still holds B's claim (it does, from its own Step 2.8 group claim until its Shared teardown):

- **`PIPELINE_RUN_DIR` unset:** `flow/claim-targets.md` "Resolve this run's identity" mints a fresh run dir, then `claim-targets.js` classifies B's claim `'live'` under the parent's `runId` → exit 3, "Claim contested", the pipeline stops before Step 3.
- **`PIPELINE_RUN_DIR="{parent-run-dir}"`:** Step 2.8's skip-guard ("every named target's claim already shows `claim.runId === basename($PIPELINE_RUN_DIR)`") passes; Step 3's adoption case 1 (`flow/steps-and-gates.md`) adopts the parent dir, which carries `config.yml`. The tail then runs as a single-spec pipeline with no `MULTISPEC_*` variables — so a `wrap-up` in it would run `wrap-up/cleanup-procedures-execution.md` Section B (`close-run` + `archive-run`) on the parent dir, forfeiting the consolidated pass exactly as the incident did.

The convention therefore keeps every approved element (B rejoins at `test` via the resume/subset grammar; B's tail first with its merge left open; B recorded `not-run` via `hooks.js spec-status`; the parent's consolidated pass is the single merge; `close-run` last; the forfeit warning) but makes B's tail an explicit subset that stops before `wrap-up`, run against the parent dir. Consequences the section must name: (a) B's own learnings then route once, through the parent batch pass, whose merge-base-scoped diff already covers B's commits (`flow/multispec-batch-curation.md` Batch-scope reflect pass, item 1); (b) a `not-run` spec is excluded from the merge's issue list, its `Fixes` line becomes `Refs`, and its claim releases `never-started:` with grants kept (`flow/multispec-review-console.md` Shared teardown steps 2-4; `_shared/pr-checklist-refresh.md`), so B's record must be closed by hand after the merge.

## Review Focus

1. A reader running the tail without `PIPELINE_RUN_DIR` — the section must say it stops at Step 2.8 (claim contest), so the reader isn't surprised. Pinned by the `PIPELINE_RUN_DIR="{parent-run-dir}"` literal assertion (Task 1).
2. A reader including `wrap-up` in the tail — the section must say why not. Pinned by the exact step-list literal `test,review,polish` (Task 1).
3. B's record staying open with `auto:build` after the merge, re-dispatchable — the section must say to close it by hand. Pinned by the `close it by hand` assertion (Task 1).
4. An agent invoking a bare `/flow #` from the section — the Skill tool rejects it. Pinned by the no-bare-`/flow #` assertion (Task 1).
5. A standalone `/claude-tweaks:wrap-up` with two records on one branch falling back to conversation inference — the pointer must name the section. Pinned in Task 2.

---

### Task 1: Canonical Mixed execution section in `flow/multi-spec.md`

**Files:**
- Create: `tests/flow-mixed-execution-convention.test.js`
- Modify: `plugin/skills/flow/multi-spec.md` — insert the new section immediately before the `## Artifact-overwrite completion check (#786)` heading (i.e. right after the `## Failure handling (default vs \`keep-going\`)` section)

**Interfaces:**
- Produces (in the test file, reused by Task 2): `read(rel)` → file text; `collapse(s)` → whitespace-collapsed string; `sectionBetween(text, startRe, endRe)` → the slice from the start match to the end match, or `null` when the start anchor is absent; throws (via `assert`) when the start anchor is present but the end anchor is not.

- [ ] **Step 1: Write the failing test**

`tests/flow-mixed-execution-convention.test.js` — header comment: pins #3033's Mixed execution convention; reads live prose because these new sections are the declared contract; go-red proven by frozen pre-change excerpts / per-token doctored controls [IL-105].

Helpers:
- `const ROOT = path.resolve(__dirname, '..')`, `read(rel)` via `fs.readFileSync(path.join(ROOT, rel), 'utf8')`.
- `collapse = (s) => s.replace(/\s+/g, ' ')`.
- `sectionBetween(text, startRe, endRe)`: `const m = startRe.exec(text); if (!m) return null; const rest = text.slice(m.index); const e = endRe.exec(rest.slice(m[0].length)); assert.ok(e, 'end anchor missing — slice would widen to the rest of the file'); return rest.slice(0, m[0].length + e.index);`
- `mixedSection(text)` = `sectionBetween(text, /^## Mixed execution \(a spec built outside \/flow\)\r?$/m, /^## /m)`.
- `const MULTI_SPEC_PRE` — frozen string literal: the exact current text of `plugin/skills/flow/multi-spec.md` from `## Failure handling (default vs \`keep-going\`)` through the `## Artifact-overwrite completion check (#786)` heading line (copy it with `sed -n` from the file before editing; it must contain both headings).

Tests (one claim each):
1. `multi-spec.md has the Mixed execution section` — `assert.ok(mixedSection(live))`; control: `assert.strictEqual(mixedSection(MULTI_SPEC_PRE), null)`.
2. One test per pinned token over `collapse(section)`, each followed by a doctored control that removes only that token from the collapsed live section (`.split(needle).join('')` for strings, `.replace(new RegExp(re.source, 'g'), '')` for regexes) and asserts no match:
   - regex `/PIPELINE_RUN_DIR="\{parent-run-dir\}" \/claude-tweaks:flow #\{B\} test,review,polish/`
   - string `steps-and-gates.md`
   - string `not-run`
   - regex `/spec-status --run "\{parent-run-dir\}" --spec \{B\} --status not-run/`
   - string `MULTISPEC_CURATION_DEFER`
   - string `close-run`
   - string `close it by hand`
3. `section uses the fully qualified /claude-tweaks:flow form` — `assert.doesNotMatch(section, /(^|[^:\w-])\/flow #/m)`; control: `assert.match('run `/flow #{B} test`', /(^|[^:\w-])\/flow #/m)`.
4. `section never calls close-without-wrapup a guard` — `assert.ok(!collapse(section).includes('close-without-wrapup'))`.
5. `the documented spec-status call, extracted and run, records B not-run` (extract-and-run, per the skill-prose-conformance-tests skill): extract the inline code span from the section with `/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" spec-status[^`]*)`/` (assert found — "extraction pattern is out of sync"), substitute `{parent-run-dir}` → the fixture run dir and `{B}` → `160`, run it under `execFileSync('bash', ['-c', script], { cwd: run })` with `CLAUDE_PLUGIN_ROOT` prefixed as in `tests/multispec-not-run-callsite.test.js`. Fixture: `gitRepo()` from `tests/helpers/git-fixtures.js`, run dir `{repo}/.claude-tweaks/pipelines/2026-10-17T000000-spec-157-160/` holding an empty `decisions.md` and a `manifest.yml` with specs 157 `running` and 160 `pending` (same YAML shape that test writes). Assert via `readManifest` (`plugin/bin/lib/flow/manifest`) that 160 is `not-run` and 157 is still `running`.

Name each test after the AC clause it covers: `AC1.1` (heading), `AC1.2` (tokens + steps-and-gates citation), `AC3.1` (fully qualified form); Task 2's tests are `AC1.3` (wrap-up pointer) and `AC1.4` (skill-graph). Every frozen-excerpt / doctored control is `AC2.1`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-mixed-execution-convention.test.js`
Expected: FAIL — `multi-spec.md has the Mixed execution section` and every token test fail (section absent); controls that run independently pass.

- [ ] **Step 3: Insert the section into `plugin/skills/flow/multi-spec.md`**

Insert this text verbatim (fixed copy — it is the deliverable), followed by one blank line, before `## Artifact-overwrite completion check (#786)`:

```markdown
## Mixed execution (a spec built outside /flow)

A multi-spec run can have a spec B implemented outside the pipeline — `superpowers:subagent-driven-development` run directly against a plan file, say — while its siblings run inside it. B rejoins with existing mechanics only, in this order:

1. **B's tail run, stopping before wrap-up.** `PIPELINE_RUN_DIR="{parent-run-dir}" /claude-tweaks:flow #{B} test,review,polish` — the explicit-subset form of `steps-and-gates.md`'s Step Arguments, rejoining at `test`. Both halves are load-bearing. Without `PIPELINE_RUN_DIR`, Step 2.8 (`claim-targets.md`) mints a fresh run directory and contests B's claim, which the parent still holds, so the call stops before Step 3. With it, Step 2.8's self-owned skip-guard passes and Step 3 adopts the parent directory (`steps-and-gates.md`'s adoption case 1) for a single-spec pipeline with no `MULTISPEC_*` variable set — a `wrap-up` there would `close-run` and archive the parent directory in its own cleanup, forfeiting step 3 below. Leaving `wrap-up` out also leaves B's merge decision open: the tail never reaches one.
2. **Record B `not-run`** through the manifest's only writer: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" spec-status --run "{parent-run-dir}" --spec {B} --status not-run --phase build`, so the consolidated console's Not run / Failed footer names it. A `not-run` spec stays off the merge's issue list, its `Fixes` line becomes `Refs`, and its claim releases `never-started:` with its grants kept (`multispec-review-console.md`'s Shared teardown) — B's commits ship in the merge, but B's record does not close on it. Close it by hand once the merge lands, before a `/claude-tweaks:dispatch` firing can select it again.
3. **The parent's consolidated pass is the run's single merge** — `multispec-batch-curation.md`, then `multispec-review-console.md`, whose terminal decision is the merge: "Approve all + merge" under `integration-model: pr-first`, or "Approve all, leave PR open" to hand it to a human. The batch pass scopes its diff from the merge-base with the integration branch, so B's commits on the shared branch fall inside it and B's learnings route once, here — the second reason the tail stops before `wrap-up`, whose own Reflect and curation would route them again.
4. **`close-run` on the parent comes last.**

**Never close the parent first.** Every spec that ran under `MULTISPEC_CURATION_DEFER=1` and `MULTISPEC_REVIEW_DEFER=1` skipped its per-spec Reflect, curation engine and Review Console (`wrap-up/SKILL.md`'s Multi-spec defer branches), and nothing but the consolidated pass performs them. `close-run` on the parent before that pass forfeits all three for every such spec, and nothing in `close-run` checks whether the pass ran.
```

Note the test's literal for "close it by hand" is lower-case; the prose says "Close it by hand" at a sentence start — make the test assertion case-insensitive for that one token (`/close it by hand/i`, doctored control removes it with the `i` flag), copying the casing from this replacement text, not memory.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/flow-mixed-execution-convention.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Prove go-red against `origin/main` without editing the tree**

Run: `git show origin/main:plugin/skills/flow/multi-spec.md | grep -c -F '## Mixed execution'`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add tests/flow-mixed-execution-convention.test.js plugin/skills/flow/multi-spec.md
git commit -m "Document the mixed-execution convention in flow/multi-spec.md — a spec built outside /flow rejoins before the parent's consolidated pass

refs #3033

Claude-Session: https://claude.ai/code/session_01BVy2D3grDpN7kAiPKwrry8"
```

### Task 2: wrap-up pointer and skill-graph edge

**Files:**
- Modify: `plugin/skills/wrap-up/SKILL.md` — inside `#### If no arguments, detect from context:`, a new paragraph (one sentence) between item 3 (`3. Check for a materialized header …`) and the `| Type | Characteristics | Primary Focus |` table
- Modify: `docs/skill-graph.md` — the `| \`/flow\` | Invoked BY \`/flow\` as the pipeline's final step; …` row in the `## wrap-up` section: append one sentence before the row's closing ` |`
- Test: `tests/flow-mixed-execution-convention.test.js` (created by Task 1; append)

**Interfaces:**
- Consumes: `read`, `collapse`, `sectionBetween` from Task 1.

- [ ] **Step 1: Add the failing tests**

- `detectBlock(text)` = `sectionBetween(text, /^#### If no arguments, detect from context:\r?$/m, /^\| Type \|/m)`.
- `WRAPUP_PRE` — frozen literal: the exact current text from `#### If no arguments, detect from context:` through the `| Type | Characteristics | Primary Focus |` line (copy with `sed -n` before editing).
- Test `wrap-up detect-from-context block points at the Mixed execution section`: `assert.match(collapse(detectBlock(live)), /multi-spec\.md`?'s "Mixed execution" section/)`; control: same pattern `doesNotMatch` `collapse(detectBlock(WRAPUP_PRE))`.
- `flowRow(text)`: `const sec = sectionBetween(text, /^## wrap-up\r?$/m, /^## Provenance\r?$/m); return sec.split(/\r?\n/).find((l) => l.startsWith('| `/flow` |'));` — assert the row is found.
- `GRAPH_PRE` — frozen literal: `'## wrap-up\n\n' + {the exact current `/flow` row line} + '\n\n## Provenance\n'`.
- Test `skill-graph wrap-up → /flow edge names the mixed-execution convention`: `assert.match(flowRow(liveGraph), /Mixed execution convention/)`; control: `doesNotMatch` `flowRow(GRAPH_PRE)`.

- [ ] **Step 2: Run to verify the two new tests fail**

Run: `node --test tests/flow-mixed-execution-convention.test.js`
Expected: FAIL on exactly the two new tests.

- [ ] **Step 3: Edit both files**

`plugin/skills/wrap-up/SKILL.md` — insert after item 3, as its own paragraph (blank line before and after), verbatim:

```markdown
Two records sharing one branch, or a record whose multi-spec run is already closed, is a spec built outside `/flow` — follow `skills/flow/multi-spec.md`'s "Mixed execution" section instead of inferring the work from the conversation.
```

`docs/skill-graph.md` — append to the `/flow` row's Relationship cell, before the closing ` |`, verbatim:

```markdown
 A spec built outside `/flow` rejoins a multi-spec run through `flow/multi-spec.md`'s Mixed execution convention (#3033): its tail run stops before `wrap-up`, the parent's consolidated pass is its only wrap-up and the run's single merge, and `close-run` comes last — `wrap-up/SKILL.md`'s detect-from-context block points there.
```

- [ ] **Step 4: Run the suite and measure the wrap-up file**

Run: `node --test tests/flow-mixed-execution-convention.test.js`
Expected: PASS, all tests.
Run: `wc -c plugin/skills/wrap-up/SKILL.md`
Expected: 36379 + the one sentence (~240 bytes).

- [ ] **Step 5: Prove go-red against `origin/main`**

Run: `git show origin/main:plugin/skills/wrap-up/SKILL.md | grep -c -F 'Mixed execution'` → `0`
Run: `git show origin/main:docs/skill-graph.md | grep -c -F 'Mixed execution'` → `0`
(AC2.1 — together with Task 1 Step 5 and every in-suite control.)

AC4.1 (`npm test` passes, incl. the context-cost gates for `wrap-up/SKILL.md` and `flow/multi-spec.md`) is verified centrally by `/build` Common Step 5 after both tasks — implementers run only the targeted suite plus `node --test tests/bin-lib/skill-audit/context-cost.test.js`.

- [ ] **Step 6: Commit**

```bash
git add tests/flow-mixed-execution-convention.test.js plugin/skills/wrap-up/SKILL.md docs/skill-graph.md
git commit -m "Point wrap-up and the skill graph at the mixed-execution convention — no conversation-inference fallback for a spec built outside /flow

refs #3033

Claude-Session: https://claude.ai/code/session_01BVy2D3grDpN7kAiPKwrry8"
```
